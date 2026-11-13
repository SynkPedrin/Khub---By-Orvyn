import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Agent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AGENT_LLM, type AgentLlm } from '../../ai/provider.contract';
import { IntelligenceCoreService, type AgenteEfetivo, type ResultadoCore } from '../intelligence/intelligence-core.service';
import { ProfileService, perfilVazio, type PerfilContexto } from '../intelligence/profile.service';
import { MemoryService, type ContextoMemoria } from '../intelligence/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { efetivoDeSnapshot, snapshotDoAgente, VersioningService } from '../versioning/versioning.service';
import { traceDoResultado } from '../intelligence/trace';
import type { FatoAtual } from '../engines/profile-policy';

export interface Persona {
  id: string;
  nome: string;
  descricao: string;
  mensagensIniciais: string[];
  perfilSemente?: Record<string, string>;
  resumoAnterior?: string;
}

/** Perfis de cliente para treinar o agente antes de ativar. */
export const PERSONAS: Persona[] = [
  { id: 'livre', nome: 'Conversa livre', descricao: 'Você escreve como o cliente.', mensagensIniciais: [] },
  { id: 'interessado', nome: 'Lead interessado', descricao: 'Viu um anúncio e quer entender o serviço.', mensagensIniciais: ['Oi! Vi o anúncio de vocês e queria saber mais sobre o tratamento'] },
  { id: 'indeciso', nome: 'Cliente indeciso', descricao: 'Tem interesse mas não decide; compara e adia.', mensagensIniciais: ['então… não sei se é pra mim', 'vou pensar melhor e qualquer coisa eu volto'] },
  { id: 'objecao_preco', nome: 'Objeção de preço', descricao: 'Acha caro e pede desconto.', mensagensIniciais: ['quanto custa?', 'nossa, achei bem caro. tem desconto?'] },
  { id: 'reclamacao', nome: 'Reclamação', descricao: 'Está insatisfeito com um atendimento anterior.', mensagensIniciais: ['Estou muito chateada, ninguém me retornou sobre o meu agendamento. Péssimo atendimento!'] },
  { id: 'curtas', nome: 'Mensagens curtas', descricao: 'Escreve pouco, monossilábico.', mensagensIniciais: ['oi', 'qnt', '?'] },
  { id: 'longa', nome: 'Mensagem longa', descricao: 'Conta a história inteira de uma vez.', mensagensIniciais: ['Boa tarde. Há uns seis meses comecei a perceber queda de cabelo, principalmente na parte da frente, e já tentei vários shampoos e vitaminas que vi na internet, mas nada resolveu. Minha mãe também teve isso. Queria saber se vocês tratam esse tipo de problema, quanto tempo leva para ver resultado, se precisa de exame antes e quanto custa a primeira consulta, porque estou um pouco preocupado e queria resolver logo.'] },
  { id: 'digitacao', nome: 'Erros de digitação', descricao: 'Escreve com erros e abreviações.', mensagensIniciais: ['oi qero sabe o preso do tratamentu pra kda', 'vcs atende sabadu?'] },
  { id: 'interrupcao', nome: 'Interrupções', descricao: 'Manda várias mensagens seguidas, mudando de assunto.', mensagensIniciais: ['oi', 'queria marcar uma avaliação', 'ah, e vocês aceitam convênio?'] },
  {
    id: 'retorno',
    nome: 'Histórico anterior',
    descricao: 'Lead que conversou há dois dias, objetou preço e sumiu.',
    mensagensIniciais: ['oi, voltei. ainda tô pensando naquele tratamento'],
    perfilSemente: { problema_principal: 'queda de cabelo', objecoes: 'preco', temperatura: 'morna', servico_interesse: 'tratamento capilar' },
    resumoAnterior: 'Há dois dias o contato relatou queda de cabelo há 6 meses, perguntou o preço da avaliação e achou caro. Disse que ia pensar e parou de responder.',
  },
];

interface MensagemSim {
  de: 'contato' | 'ia';
  texto: string;
  em: string;
}

/**
 * AGENT SIMULATOR (docs/AI_AGENT_ARCHITECTURE.md §13)
 *
 * Usa o MESMO Intelligence Core do atendimento, com `simulacao: true`:
 * leitura real (base de conhecimento, perfil/memória de um contato escolhido),
 * escrita só descrita. Nada é enviado no WhatsApp e nenhuma ação de produção
 * roda. O painel técnico mostra o trace estruturado (sem raciocínio privado).
 * O perfil "aprendido" na simulação vive só na sessão.
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm,
    private readonly core: IntelligenceCoreService,
    private readonly perfis: ProfileService,
    private readonly memoria: MemoryService,
    private readonly conhecimento: KnowledgeService,
    private readonly versoes: VersioningService,
  ) {}

  personas() {
    return PERSONAS.map(({ id, nome, descricao, mensagensIniciais }) => ({ id, nome, descricao, mensagensIniciais }));
  }

  async criar(tenantId: string, agentId: string, identityId: string, i: { perfil?: string; contactId?: string | null; usarRascunho?: boolean }) {
    const persona = PERSONAS.find((p) => p.id === (i.perfil ?? 'livre'));
    if (!persona) throw new BadRequestException('perfil de simulação inválido');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true, status: true } });
      if (!a || a.status === 'arquivado') throw new NotFoundException('agente inexistente');
      if (i.contactId && !(await tx.contact.findUnique({ where: { id: i.contactId }, select: { id: true } }))) throw new NotFoundException('contato inexistente');
      return tx.agentSimulation.create({
        data: { tenantId, agentId, perfil: persona.id, createdBy: identityId || null, traces: [{ tipo: 'sessao', contactId: i.contactId ?? null, usarRascunho: i.usarRascunho ?? true }] as Prisma.InputJsonValue },
      });
    });
  }

  async listar(tenantId: string, agentId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.agentSimulation.findMany({ where: { agentId }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, perfil: true, createdAt: true, updatedAt: true, custoUsd: true, mensagens: true } }));
  }

  async obter(tenantId: string, id: string) {
    const s = await this.prisma.withTenant(tenantId, (tx) => tx.agentSimulation.findUnique({ where: { id } }));
    if (!s) throw new NotFoundException('simulação inexistente');
    return s;
  }

  async remover(tenantId: string, id: string) {
    await this.prisma.withTenant(tenantId, (tx) => tx.agentSimulation.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /** Agente para simular: rascunho (o que está sendo editado) ou versão publicada. */
  async efetivoPara(tenantId: string, a: Agent, usarRascunho: boolean): Promise<AgenteEfetivo> {
    if (usarRascunho) return efetivoDeSnapshot(a.id, snapshotDoAgente(a), null);
    return this.prisma.withTenant(tenantId, (tx) => this.versoes.efetivo(tx, a));
  }

  /**
   * Um turno: 1+ mensagens do contato (várias = interrupção/rajada) → core.
   * Devolve a resposta fragmentada e o trace técnico completo.
   */
  async turno(tenantId: string, simId: string, mensagens: string[]) {
    const limpas = mensagens.map((m) => m.trim()).filter(Boolean).slice(0, 5);
    if (!limpas.length) throw new BadRequestException('envie ao menos uma mensagem');
    const sim = await this.obter(tenantId, simId);
    const traces = (sim.traces as unknown as Record<string, unknown>[]) ?? [];
    const sessao = (traces.find((t) => t.tipo === 'sessao') ?? {}) as { contactId?: string | null; usarRascunho?: boolean };
    const persona = PERSONAS.find((p) => p.id === sim.perfil) ?? PERSONAS[0];
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => ({
      agente: await tx.agent.findUnique({ where: { id: sim.agentId } }),
      tenant: await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true, subespecialidade: true } }),
      intencoes: await tx.agentIntentCategory.findMany({ where: { ativo: true }, select: { chave: true, nome: true, descricao: true, exemplos: true } }),
      contato: sessao.contactId ? await tx.contact.findUnique({ where: { id: sessao.contactId }, select: { nome: true } }) : null,
    }));
    if (!ctx.agente) throw new NotFoundException('agente inexistente');
    const efetivo = await this.efetivoPara(tenantId, ctx.agente, sessao.usarRascunho ?? true);

    const agora = new Date().toISOString();
    const historicoSim: MensagemSim[] = [...((sim.mensagens as unknown as MensagemSim[]) ?? []), ...limpas.map((t) => ({ de: 'contato' as const, texto: t, em: agora }))];
    const perfil = await this.perfilDaSessao(tenantId, sessao.contactId ?? null, persona, traces);
    const memoria: ContextoMemoria = sessao.contactId
      ? await this.memoria.contexto(tenantId, null, sessao.contactId, efetivo.config.memoria)
      : { resumoConversa: persona.resumoAnterior ?? null, longoPrazo: [], operacional: [] };
    const documentIds = await this.conhecimento.documentosDoAgente(tenantId, sim.agentId, efetivo.config.conhecimento);

    const t0 = Date.now();
    const r = await this.core.processar({
      tenantId,
      agente: efetivo,
      empresa: ctx.tenant?.nome ?? 'a empresa',
      nicho: ctx.tenant?.nicho ?? null,
      subespecialidade: ctx.tenant?.subespecialidade ?? null,
      conversationId: null,
      contactId: sessao.contactId ?? null,
      contatoNome: ctx.contato?.nome ?? null,
      messageId: null,
      runId: null,
      historico: historicoSim.map((m) => ({ autorTipo: m.de === 'contato' ? 'contato' : 'ia', corpo: m.texto })),
      perfil,
      memoria,
      intencoesExtras: ctx.intencoes,
      regrasJaDisparadas: new Set(traces.flatMap((t) => ((t.regras as { disparadas?: { regraId: string }[] } | undefined)?.disparadas ?? []).map((d) => d.regraId))),
      documentIds,
      simulacao: true,
      origem: 'simulador',
    });
    const blocos = r.fragmentacao.blocos;
    const respostas: MensagemSim[] = blocos.map((b) => ({ de: 'ia', texto: b.texto, em: new Date().toISOString() }));
    const trace = {
      tipo: 'turno',
      recebido: limpas,
      ...traceDoResultado(r),
      resposta: r.texto,
      blocos,
      tokens: { entrada: r.tokensEntrada, saida: r.tokensSaida },
      custoUsd: r.custoUsd,
      execucaoMs: Date.now() - t0,
      versao: efetivo.versionId ? 'publicada' : 'rascunho',
      perfilDepois: Object.fromEntries([...perfil.fatos.entries()].map(([k, f]) => [k, { valor: f.valor, origem: f.origem, status: f.status, confianca: f.confianca }])),
    };
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentSimulation.update({
        where: { id: simId },
        data: {
          mensagens: [...historicoSim, ...respostas] as unknown as Prisma.InputJsonValue,
          traces: [...traces, trace] as unknown as Prisma.InputJsonValue,
          custoUsd: new Prisma.Decimal((Number(sim.custoUsd) + r.custoUsd).toFixed(6)),
          updatedAt: new Date(),
        },
      }),
    );
    return { resposta: respostas, trace, decisao: r.decisao, iaConfigurada: this.core.iaDisponivel() };
  }

  /** Perfil da sessão: contato real (leitura) ou semente da persona + o que a simulação já extraiu. */
  private async perfilDaSessao(tenantId: string, contactId: string | null, persona: Persona, traces: Record<string, unknown>[]): Promise<PerfilContexto> {
    const perfil = contactId ? await this.perfis.carregar(tenantId, contactId) : perfilVazio();
    if (!contactId && persona.perfilSemente) {
      for (const [campo, valor] of Object.entries(persona.perfilSemente)) perfil.fatos.set(campo, { campo, valor, origem: 'declarado', confianca: 0.9, status: 'confirmado', atualizadoEm: new Date() });
    }
    const ultimo = [...traces].reverse().find((t) => t.tipo === 'turno')?.perfilDepois as Record<string, { valor: unknown; origem: FatoAtual['origem']; status: FatoAtual['status']; confianca: number }> | undefined;
    if (ultimo) for (const [campo, f] of Object.entries(ultimo)) perfil.fatos.set(campo, { campo, ...f, atualizadoEm: new Date() });
    return perfil;
  }

  /** Cliente automático: a IA escreve a próxima mensagem no papel da persona. */
  async gerarMensagemCliente(tenantId: string, simId: string): Promise<{ mensagem: string }> {
    this.llm.exigirCredencial();
    const sim = await this.obter(tenantId, simId);
    const persona = PERSONAS.find((p) => p.id === sim.perfil) ?? PERSONAS[0];
    const msgs = ((sim.mensagens as unknown as MensagemSim[]) ?? []).slice(-12);
    const agente = await this.prisma.withTenant(tenantId, (tx) => tx.agent.findUnique({ where: { id: sim.agentId }, select: { modelo: true } }));
    const r = await this.llm.conversar({
      modelo: agente?.modelo ?? 'claude-haiku-5-5',
      system: `Você interpreta um CLIENTE de WhatsApp para testar um agente de atendimento. Perfil: ${persona.nome} — ${persona.descricao}. Escreva SÓ a próxima mensagem do cliente, curta e realista, em português do Brasil, sem aspas. Mantenha a coerência com a conversa.`,
      mensagens: [{ role: 'user', content: msgs.length ? msgs.map((m) => `${m.de === 'contato' ? 'CLIENTE' : 'AGENTE'}: ${m.texto}`).join('\n') : '(a conversa ainda não começou: escreva a primeira mensagem)' }],
      maxTokens: 2048,
      effort: 'low',
      timeoutMs: 30_000,
    });
    return { mensagem: r.texto.trim().slice(0, 1000) };
  }

  /** Vira cenário de regressão a partir das mensagens do contato desta simulação. */
  mensagensParaCenario(sim: { mensagens: unknown }): { de: 'contato' | 'ia'; texto: string }[] {
    const ms = ((sim.mensagens as MensagemSim[]) ?? []).map((m) => ({ de: m.de, texto: m.texto }));
    while (ms.length && ms[ms.length - 1].de !== 'contato') ms.pop();
    if (!ms.length) throw new BadRequestException('a simulação precisa ter mensagem do contato');
    return ms.slice(-30);
  }
}

export type { ResultadoCore };
