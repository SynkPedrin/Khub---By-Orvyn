import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AI_PROVIDER, type AIProvider } from '../ai/provider.contract';
import { AtendimentoService } from '../crm/messaging/atendimento.service';
import { VersioningService } from './versioning/versioning.service';
import { promptEstavel } from './intelligence/prompt';

/**
 * STUDIO DO AGENTE — a tela "ver funcionando na prática" (cockpit de 3
 * painéis): conversa ao vivo, fluxo operacional (trace real dos runs) e
 * efeitos no CRM/agenda. Aqui também moram o assistente de prompt da NICO,
 * a análise de qualidade do prompt e o teste ao vivo no WhatsApp.
 */

export interface AssistentePromptInput {
  nome?: string;
  foco: string;
  descricao: string;
  instrucoesAtuais?: string;
}

export interface AnalisePromptInput {
  nome?: string;
  foco?: string;
  instrucoes: string;
  tom?: string;
  conhecimentoAtivo?: boolean;
}

const analiseSchema = z.object({
  nota: z.number().min(0).max(100),
  faltando: z.array(z.string()).max(8),
  sugestoes: z.array(z.string()).max(8),
});
export type AnalisePrompt = z.infer<typeof analiseSchema>;

const rascunhoSchema = z.object({
  instrucoes: z.string().min(40),
  tom: z.string().max(40).optional(),
  personalidade: z.string().max(400).optional(),
});

const SYSTEM_ASSISTENTE = `Você é a NICO, especialista em criar agentes de IA de atendimento para WhatsApp.
Escreva o SYSTEM PROMPT do agente em português do Brasil, pronto para uso, na voz de quem atende clientes de pequenos negócios.
Regras do prompt que você escreve:
- Começa definindo quem o agente é e o objetivo dele (o foco informado).
- Inclui: como cumprimentar, o que perguntar para qualificar, o que NUNCA fazer (inventar preço/horário, prometer o que não sabe), quando transferir para humano, formato das respostas (curtas, estilo WhatsApp, sem markdown).
- Se o usuário já escreveu algo, MELHORE mantendo a intenção dele — não jogue fora.
- Nada de placeholders como [NOME DA EMPRESA]: onde faltar dado, escreva a regra ("se não souber o valor, diga que confirma com a equipe").
Responda SÓ com JSON válido: {"instrucoes": "...", "tom": "cordial|formal|direto|descontraido", "personalidade": "uma frase"}`;

const SYSTEM_ANALISE = `Você é a NICO auditando o system prompt de um agente de IA de atendimento no WhatsApp.
Avalie se o agente CONSEGUE trabalhar sozinho com o que está escrito. Foque no que falta para o foco informado:
- Agente vendedor sem preços/condições → falta crítica ("sem valores informados, ela não vai funcionar corretamente").
- Agente de agendamento sem serviços/duração/horários → falta crítica.
- Sem regra de transferência para humano, sem tom definido, sem limite do que não fazer → aponta.
- Se a base de conhecimento estiver desligada e o prompt depender de informação específica do negócio → aponta.
nota: 0-100 (80+ = pronto pra produção; 50-79 = funciona mas frágil; <50 = vai falhar).
Responda SÓ com JSON válido: {"nota": 0, "faltando": ["..."], "sugestoes": ["..."]}`;

@Injectable()
export class AgentStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly atendimento: AtendimentoService,
    private readonly versoes: VersioningService,
    @Inject(AI_PROVIDER) private readonly llm: AIProvider,
  ) {}

  iaConfigurada(): boolean {
    return this.llm.configured();
  }

  /** 501 config_required no MESMO formato do ConfigService — mas pelo provider de IA ativo (hoje: Ollama), não uma credencial fixa. */
  private exigirIa(): void {
    if (!this.llm.configured()) {
      throw new HttpException({ status: 'config_required', provider: this.llm.nome, missing: this.llm.missing(), title: 'IA não configurada' }, 501);
    }
  }

  /** Painel esquerdo: conversas que este agente está atendendo AGORA (ou atendeu). */
  async conversasDoAgente(tenantId: string, agentId: string, limite = 20) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.conversation.findMany({
        where: { agentId, atendimento: 'ia' },
        orderBy: { updatedAt: 'desc' },
        take: limite,
        include: {
          contact: { select: { id: true, nome: true, telefone: true, fotoUrl: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { corpo: true, autorTipo: true, createdAt: true } },
        },
      });
      return rows.map((c) => ({
        id: c.id,
        canal: c.canal,
        naoLidas: c.naoLidas,
        atualizadaEm: c.updatedAt.toISOString(),
        contato: c.contact ? { id: c.contact.id, nome: c.contact.nome, telefone: c.contact.telefone, fotoUrl: c.contact.fotoUrl } : null,
        ultima: c.messages[0] ? { texto: c.messages[0].corpo.slice(0, 140), de: c.messages[0].autorTipo, em: c.messages[0].createdAt.toISOString() } : null,
      }));
    });
  }

  /**
   * Painel central: runs recentes do agente com o trace REAL (intenção,
   * conhecimento, ferramentas, fragmentação, tempos) — o front monta o
   * "fluxo operacional" a partir daqui. Sem raciocínio privado: o trace já
   * nasce higienizado (agents/intelligence/trace.ts).
   */
  async atividadeDoAgente(tenantId: string, agentId: string, limite = 15) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // AgentRun não tem relação Prisma com Conversation — junta em duas queries.
      const runs = await tx.agentRun.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: limite,
      });
      const conversas = runs.length
        ? await tx.conversation.findMany({
            where: { id: { in: [...new Set(runs.map((r) => r.conversationId))] } },
            select: { id: true, contact: { select: { nome: true } } },
          })
        : [];
      const nomePorConversa = new Map(conversas.map((c) => [c.id, c.contact?.nome ?? 'Contato']));
      return runs.map((r) => ({
        id: r.id,
        conversaId: r.conversationId,
        contatoNome: nomePorConversa.get(r.conversationId) ?? 'Contato',
        status: r.status,
        motivo: r.motivo,
        intencao: r.intencao,
        confianca: r.confianca == null ? null : Number(r.confianca),
        trace: r.trace,
        modelo: r.modelo,
        latenciaMs: r.latenciaMs,
        criadoEm: r.createdAt.toISOString(),
        finalizadoEm: r.finishedAt?.toISOString() ?? null,
      }));
    });
  }

  /**
   * Teste ao vivo no WhatsApp: entrega a conversa do contato escolhido para
   * ESTE agente. A partir daí toda mensagem que o contato mandar é respondida
   * por ele (visível no Inbox). Cria a conversa se o contato ainda não tem
   * uma de WhatsApp — o teste começa quando o contato escrever.
   */
  async testarNoWhatsapp(tenantId: string, agentId: string, contactId: string, identityId: string) {
    const alvo = await this.prisma.withTenant(tenantId, async (tx) => {
      const contato = await tx.contact.findUnique({ where: { id: contactId, tenantId }, select: { id: true, nome: true, telefone: true } });
      if (!contato) throw new NotFoundException('contato não encontrado');
      let conv = await tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
      conv ??= await tx.conversation.create({
        data: { tenantId, contactId, nome: contato.nome, canal: 'WhatsApp' },
        select: { id: true },
      });
      return { conversaId: conv.id, contatoNome: contato.nome };
    });
    // Fora do withTenant de cima: devolverParaIa abre a própria transação.
    const estado = await this.atendimento.devolverParaIa(tenantId, alvo.conversaId, identityId, agentId);
    return { ...alvo, atendimento: estado.atendimento, agentId: estado.agentId };
  }

  /** NICO escreve (ou melhora) o system prompt a partir de foco + descrição curta. */
  async assistenteDePrompt(tenantId: string, input: AssistentePromptInput): Promise<{ instrucoes: string; tom?: string; personalidade?: string }> {
    this.exigirIa(); // 501 config_required — nunca inventar prompt sem IA
    const r = await this.llm.generate({
      papel: 'agente',
      system: SYSTEM_ASSISTENTE,
      mensagens: [{
        role: 'user',
        content: [
          `Foco do agente: ${input.foco}`,
          input.nome ? `Nome: ${input.nome}` : '',
          `Sobre o negócio e o que o agente deve fazer:\n${input.descricao}`,
          input.instrucoesAtuais ? `\nO usuário já escreveu isto (melhore, mantendo a intenção):\n${input.instrucoesAtuais}` : '',
        ].filter(Boolean).join('\n'),
      }],
      maxTokens: 1600,
      temperatura: 0.4,
    });
    const parsed = rascunhoSchema.safeParse(extrairJson(r.texto));
    if (!parsed.success) {
      // Sem JSON válido, o texto inteiro ainda é um prompt utilizável — não perde o trabalho.
      return { instrucoes: r.texto.trim().slice(0, 8000) };
    }
    return { instrucoes: parsed.data.instrucoes, tom: parsed.data.tom, personalidade: parsed.data.personalidade };
  }

  /** Medidor de qualidade: o que falta pro agente funcionar bem no foco dele. */
  async analisarPrompt(tenantId: string, input: AnalisePromptInput): Promise<AnalisePrompt> {
    this.exigirIa();
    return this.analisarTexto(input);
  }

  /**
   * Análise do agente SALVO: roda em cima do prompt efetivo (promptEstavel —
   * o mesmo texto que o runtime usa), não só das instruções livres. O foco
   * vem do objetivo principal configurado.
   */
  async analisarAgente(tenantId: string, agentId: string): Promise<AnalisePrompt> {
    this.exigirIa();
    const dados = await this.prisma.withTenant(tenantId, async (tx) => {
      const agente = await tx.agent.findUnique({ where: { id: agentId, tenantId } });
      if (!agente) throw new NotFoundException('agente não encontrado');
      const efetivo = await this.versoes.efetivo(tx, agente);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true } });
      const conhecimento = await tx.agentKnowledgeSource.count({ where: { agentId, tenantId, ativo: true } });
      return { efetivo, agente, tenant, conhecimento };
    });
    const prompt = promptEstavel(dados.efetivo, { empresa: dados.tenant?.nome ?? 'a empresa', nicho: dados.tenant?.nicho ?? null });
    return this.analisarTexto({
      nome: dados.agente.nome,
      foco: dados.efetivo.config.identidade.objetivoPrincipal || dados.agente.descricao || undefined,
      instrucoes: prompt,
      tom: dados.efetivo.tom,
      conhecimentoAtivo: dados.agente.conhecimentoAtivo && dados.conhecimento > 0,
    });
  }

  private async analisarTexto(input: AnalisePromptInput): Promise<AnalisePrompt> {
    const r = await this.llm.generate({
      papel: 'agente',
      system: SYSTEM_ANALISE,
      mensagens: [{
        role: 'user',
        content: [
          `Foco: ${input.foco ?? 'atendimento geral'}`,
          input.nome ? `Nome: ${input.nome}` : '',
          `Tom: ${input.tom ?? 'não definido'}`,
          `Base de conhecimento: ${input.conhecimentoAtivo ? 'ligada' : 'DESLIGADA'}`,
          `\nSystem prompt do agente:\n${input.instrucoes}`,
        ].join('\n'),
      }],
      maxTokens: 700,
      temperatura: 0.2,
    });
    const parsed = analiseSchema.safeParse(extrairJson(r.texto));
    if (!parsed.success) return { nota: 0, faltando: ['Não consegui analisar — tente de novo.'], sugestoes: [] };
    return parsed.data;
  }
}

/** O modelo às vezes embrulha o JSON em ```json … ``` — extrai o primeiro objeto balanceado. */
function extrairJson(texto: string): unknown {
  const inicio = texto.indexOf('{');
  if (inicio < 0) return null;
  let profundidade = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '{') profundidade++;
    if (texto[i] === '}') profundidade--;
    if (profundidade === 0) {
      try {
        return JSON.parse(texto.slice(inicio, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
