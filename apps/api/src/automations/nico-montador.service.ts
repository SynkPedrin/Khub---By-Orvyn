import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigRequiredException } from '../config/config.service';
import { AI_PROVIDER, type AIProvider } from '../ai/provider.contract';
import { CATALOGO, TIPOS_NO, ehGatilho, ramosFixosDoNo, validarConfig, type Aresta, type Grafo, type No, type TipoNo } from './catalogo';
import { WorkflowsService } from './workflows.service';

/**
 * MODO SIMPLES — a NICO monta a automação a partir de uma conversa.
 *
 * O modelo NÃO desenha o grafo: devolve um PLANO (gatilho + passos, com
 * sub-listas só nos nós de saídas nomeadas). O servidor valida cada passo
 * contra o catálogo (mesmo Zod do editor), monta o grafo com layout
 * automático e grava como RASCUNHO. Publicar continua sendo decisão humana
 * (human-in-the-loop: a NICO nunca liga um fluxo sozinha).
 *
 * O teste usa o mesmo `WorkflowsService.testar`: execução marcada como teste,
 * mensagens só no número de teste, resto simulado (ver ExecutorService.emTeste).
 */

/** Nós que a NICO pode usar: os que não exigem ids que ela não conhece. */
const TIPOS_PERMITIDOS = new Set<TipoNo>([
  'gatilho.contato_criado', 'gatilho.tag_adicionada', 'gatilho.negocio_criado', 'gatilho.etapa_mudou',
  'gatilho.negocio_status', 'gatilho.mensagem_recebida', 'gatilho.agendamento_criado', 'gatilho.agendamento_confirmado',
  'gatilho.faltou', 'gatilho.agendamento_cancelado', 'gatilho.lembrete_agendamento', 'gatilho.pagamento_recebido',
  'controle.esperar', 'controle.esperar_resposta', 'controle.condicao', 'controle.encerrar',
  'acao.enviar_sms', 'acao.enviar_email', 'acao.notificar_equipe', 'acao.adicionar_tag', 'acao.remover_tag',
  'acao.criar_oportunidade', 'acao.mover_etapa', 'acao.criar_tarefa', 'acao.criar_nota', 'acao.ia',
].filter((t) => (TIPOS_NO as readonly string[]).includes(t)) as TipoNo[]);

/** Formato da config de cada nó, em linguagem que o modelo segue. */
const FORMATO: Partial<Record<TipoNo, string>> = {
  'gatilho.contato_criado': '{} ou {"origem":"Meta Lead Ads"}',
  'gatilho.tag_adicionada': '{"tag":"nome-da-tag"}',
  'gatilho.negocio_criado': '{} ou {"stageId":"<id de etapa>"}',
  'gatilho.etapa_mudou': '{} ou {"stageId":"<id de etapa>"}',
  'gatilho.negocio_status': '{} ou {"status":"ganho"|"perdido"}',
  'gatilho.mensagem_recebida': '{"canal":"WhatsApp"} ou {"canal":"WhatsApp","contem":"palavra"}',
  'gatilho.pagamento_recebido': '{} ou {"valorMinimo":100}',
  'controle.esperar': '{"duracao":2,"unidade":"segundos"|"minutos"|"horas"|"dias"}',
  'controle.esperar_resposta': '{"duracao":1,"unidade":"minutos"|"horas"|"dias"} — saídas: "resposta" e "timeout"',
  'controle.condicao': '{"ramos":[{"id":"sim","rotulo":"Sim","juncao":"AND","regras":[{"campo":"contato.tags","operador":"contem","valor":"vip"}]},{"id":"nao","rotulo":"Não","juncao":"NONE","regras":[]}]} — saídas: os ids dos ramos',
  'controle.encerrar': '{} ou {"motivo":"texto"}',
  'acao.enviar_sms': '{"texto":"Oi {{contato.nome}}, ..."} (WhatsApp, até 1000 caracteres)',
  'acao.enviar_email': '{"assunto":"...","corpo":"..."}',
  'acao.notificar_equipe': '{"telefone":"5511999999999","texto":"Novo lead: {{contato.nome}}"}',
  'acao.adicionar_tag': '{"tag":"nome"}',
  'acao.remover_tag': '{"tag":"nome"}',
  'acao.criar_oportunidade': '{"titulo":"{{contato.nome}}","stageId":"<id de etapa>","valor":0}',
  'acao.mover_etapa': '{"stageId":"<id de etapa>"}',
  'acao.criar_tarefa': '{"titulo":"Ligar para {{contato.nome}}","prioridade":"baixa"|"media"|"alta","emDias":1}',
  'acao.criar_nota': '{"corpo":"texto"}',
  'acao.ia': '{"tarefa":"classificar"|"pontuar"|"resumir"|"responder"|"extrair","instrucao":"...","salvarEm":"nome"}',
};

interface PassoPlano {
  tipo: string;
  rotulo?: string;
  config?: Record<string, unknown>;
  ramos?: Record<string, PassoPlano[]>;
}
const passoSchema: z.ZodType<PassoPlano> = z.lazy(() =>
  z.object({
    tipo: z.string(),
    rotulo: z.string().max(80).optional(),
    config: z.record(z.unknown()).optional(),
    ramos: z.record(z.array(passoSchema)).optional(),
  }),
);
const planoSchema = z.object({
  nome: z.string().max(160).default('Automação da NICO'),
  resumo: z.string().max(800).default(''),
  gatilho: z.object({ tipo: z.string(), config: z.record(z.unknown()).optional() }).nullable().optional(),
  passos: z.array(passoSchema).max(40).default([]),
  perguntas: z.array(z.string().max(300)).max(5).default([]),
});
type Plano = z.infer<typeof planoSchema>;

export interface MensagemConversa { autor: 'usuario' | 'nico'; texto: string }

export interface PassoLegivel { tipo: string; categoria: 'gatilho' | 'controle' | 'acao'; nome: string; detalhe: string; nivel: number; ramo?: string }

export type RespostaMontar =
  | { tipo: 'pergunta'; perguntas: string[]; resumo: string }
  | { tipo: 'pronto'; workflowId: string; nome: string; resumo: string; passos: PassoLegivel[] };

const ESPACO_Y = 150;
const ESPACO_X = 300;

@Injectable()
export class NicoMontadorService {
  private readonly log = new Logger('NicoMontador');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    @Inject(AI_PROVIDER) private readonly llm: AIProvider,
  ) {}

  /**
   * Conversa → automação em rascunho. Se faltar informação essencial, devolve
   * as perguntas da NICO em vez de inventar. Com `workflowId`, reescreve o
   * rascunho daquele fluxo (a versão publicada não muda).
   */
  async montar(tenantId: string, identityId: string, conversa: MensagemConversa[], workflowId?: string): Promise<RespostaMontar> {
    if (!this.llm.configured()) throw new ConfigRequiredException('anthropic', this.llm.missing());
    if (!conversa.some((m) => m.autor === 'usuario' && m.texto.trim())) throw new BadRequestException('descreva o que a automação deve fazer');

    const dados = await this.dadosDoTenant(tenantId);
    const system = this.prompt(dados);
    const mensagens = conversa.slice(-12).map((m) => ({
      role: m.autor === 'usuario' ? ('user' as const) : ('assistant' as const),
      content: m.texto.slice(0, 3000),
    }));

    let erros: string[] = [];
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const extra = erros.length
        ? [{ role: 'user' as const, content: `O plano anterior tinha problemas. Corrija e devolva o JSON inteiro de novo:\n- ${erros.join('\n- ')}` }]
        : [];
      const r = await this.llm.generate({ papel: 'agente', system, mensagens: [...mensagens, ...extra], maxTokens: 3000, temperatura: 0.2 });
      const plano = this.lerPlano(r.texto);
      if (!plano) {
        erros = ['a resposta não era um JSON válido no formato pedido'];
        continue;
      }
      if (plano.perguntas.length && !plano.passos.length) {
        return { tipo: 'pergunta', perguntas: plano.perguntas, resumo: plano.resumo };
      }

      const montado = this.montarGrafo(plano, dados.stageIds);
      if ('erros' in montado) {
        erros = montado.erros;
        continue;
      }
      const problemas = this.workflows.validar(montado.grafo).map((p) => p.problema);
      if (problemas.length) {
        erros = problemas;
        continue;
      }

      const id = workflowId ?? (await this.workflows.criar(tenantId, identityId, { nome: plano.nome.slice(0, 160) || 'Automação da NICO', descricao: plano.resumo.slice(0, 500) || undefined })).id;
      await this.workflows.salvarRascunho(tenantId, id, montado.grafo);
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${tenantId}::uuid, 'nyro', ${identityId}, 'workflow.nico_montar', 'workflow', ${id})`,
      );
      return { tipo: 'pronto', workflowId: id, nome: plano.nome, resumo: plano.resumo, passos: montado.legivel };
    }
    this.log.warn(`NICO não conseguiu montar um plano válido: ${erros.join(' | ')}`);
    throw new BadRequestException({ title: 'A NICO não conseguiu montar o fluxo', problemas: erros.map((problema) => ({ problema })) });
  }

  /**
   * Teste real com dados reais: usa o contato escolhido ou o mais recente com
   * telefone. A execução é de TESTE (mensagens só no número de teste).
   */
  async testar(tenantId: string, workflowId: string, contactId?: string) {
    const contato = await this.prisma.withTenant(tenantId, (tx) =>
      contactId
        ? tx.contact.findUnique({ where: { id: contactId }, select: { id: true, nome: true, telefone: true } })
        : tx.contact.findFirst({ where: { telefone: { not: null } }, orderBy: { createdAt: 'desc' }, select: { id: true, nome: true, telefone: true } }),
    );
    if (!contato) throw new NotFoundException('nenhum contato para usar no teste: cadastre um contato antes');
    const r = await this.workflows.testar(tenantId, workflowId, contato.id);
    return { ...r, contato: { id: contato.id, nome: contato.nome } };
  }

  // ------------------------------------------------------------------ apoio

  private async dadosDoTenant(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const funis = await tx.pipeline.findMany({ select: { nome: true, stages: { select: { id: true, nome: true, ordem: true }, orderBy: { ordem: 'asc' } } }, take: 10 });
      const tags = await tx.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM contacts WHERE tenant_id = ${tenantId}::uuid LIMIT 60`;
      return {
        funis: funis.map((f) => ({ nome: f.nome, etapas: f.stages.map((s) => ({ id: s.id, nome: s.nome })) })),
        stageIds: new Set(funis.flatMap((f) => f.stages.map((s) => s.id))),
        tags: tags.map((t) => t.tag).filter(Boolean),
      };
    });
  }

  private prompt(dados: { funis: { nome: string; etapas: { id: string; nome: string }[] }[]; tags: string[] }): string {
    const nos = CATALOGO.filter((m) => TIPOS_PERMITIDOS.has(m.tipo))
      .map((m) => `- ${m.tipo} — ${m.nome}: ${m.descricao}\n  config: ${FORMATO[m.tipo] ?? '{}'}`)
      .join('\n');
    const funis = dados.funis.length
      ? dados.funis.map((f) => `- Funil "${f.nome}": ${f.etapas.map((e) => `${e.nome} (stageId ${e.id})`).join(', ')}`).join('\n')
      : '- (nenhum funil criado: não use nós que pedem stageId)';
    return `Você é a NICO, a agente do KHUB que monta automações de CRM a partir do que o usuário descreve, em português do Brasil.

Responda SOMENTE com um JSON, sem texto antes ou depois, neste formato:
{"nome":"nome curto","resumo":"1 a 3 frases do que o fluxo faz, para o usuário","gatilho":{"tipo":"gatilho.x","config":{}},"passos":[{"tipo":"...","rotulo":"nome curto do passo","config":{}}],"perguntas":[]}

Regras:
- Use SÓ os tipos listados. "gatilho" é obrigatório e único; "passos" roda em ordem, de cima para baixo.
- Nós com saídas nomeadas (controle.esperar_resposta → "resposta" e "timeout"; controle.condicao → os ids dos ramos) levam os passos de cada saída em "ramos": {"resposta":[...],"timeout":[...]}, e NÃO têm passos depois deles na mesma lista.
- Mensagens personalizadas com {{contato.nome}}, {{contato.empresa}}, {{contato.telefone}}, {{contato.email}}. Escreva mensagens prontas, naturais e curtas.
- stageId só da lista de funis abaixo, nunca invente id. Use as tags que já existem quando fizer sentido.
- Se faltar algo ESSENCIAL (ex.: o que dispara o fluxo), devolva "passos": [] e até 3 perguntas objetivas em "perguntas". Se der para decidir com bom senso, decida e explique no resumo.
- Nunca ative ou publique nada: você só monta o rascunho.

Tipos disponíveis:
${nos}

Funis e etapas do cliente:
${funis}

Tags que já existem: ${dados.tags.length ? dados.tags.join(', ') : '(nenhuma)'}`;
  }

  private lerPlano(texto: string): Plano | null {
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return null;
    try {
      const r = planoSchema.safeParse(JSON.parse(texto.slice(ini, fim + 1)));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }

  /** Plano → grafo validado + versão legível para o chat. */
  private montarGrafo(plano: Plano, stageIds: Set<string>): { grafo: Grafo; legivel: PassoLegivel[] } | { erros: string[] } {
    const erros: string[] = [];
    const nos: No[] = [];
    const arestas: Aresta[] = [];
    const legivel: PassoLegivel[] = [];
    let seq = 0;
    const novoId = (p: string) => `${p}${++seq}`;

    const meta = (tipo: string) => CATALOGO.find((m) => m.tipo === tipo);
    const checarNo = (tipo: string, config: Record<string, unknown>, onde: string): Record<string, unknown> | null => {
      if (!TIPOS_PERMITIDOS.has(tipo as TipoNo)) {
        erros.push(`${onde}: tipo "${tipo}" não existe ou não pode ser usado`);
        return null;
      }
      const v = validarConfig(tipo as TipoNo, config);
      if (!v.ok) {
        erros.push(`${onde} (${tipo}): ${v.erro}`);
        return null;
      }
      const stage = (config as { stageId?: unknown }).stageId;
      if (typeof stage === 'string' && !stageIds.has(stage)) erros.push(`${onde} (${tipo}): stageId "${stage}" não existe; use um da lista`);
      return v.dados as Record<string, unknown>;
    };

    const g = plano.gatilho;
    if (!g || !ehGatilho(g.tipo)) return { erros: ['o fluxo precisa de um gatilho válido em "gatilho"'] };
    const cfgG = checarNo(g.tipo, g.config ?? {}, 'gatilho');
    const gatilhoId = novoId('g');
    nos.push({ id: gatilhoId, tipo: g.tipo as TipoNo, rotulo: meta(g.tipo)?.nome, posicao: { x: 0, y: 0 }, config: cfgG ?? {} });
    legivel.push({ tipo: g.tipo, categoria: 'gatilho', nome: meta(g.tipo)?.nome ?? g.tipo, detalhe: this.detalhe(g.tipo, cfgG ?? {}), nivel: 0 });

    // Encadeia uma lista de passos a partir de (origem, ramo). Devolve a largura usada (para o layout).
    const encadear = (passos: PassoPlano[], origem: string, ramoOrigem: string | undefined, x: number, y: number, nivel: number, rotuloRamo?: string): void => {
      let de = origem;
      let ramo = ramoOrigem;
      let yAtual = y;
      for (const [i, p] of passos.entries()) {
        const onde = `passo "${p.rotulo ?? p.tipo}"`;
        if (ehGatilho(p.tipo)) {
          erros.push(`${onde}: gatilho só pode aparecer em "gatilho"`);
          continue;
        }
        const cfg = checarNo(p.tipo, p.config ?? {}, onde) ?? {};
        const id = novoId('n');
        nos.push({ id, tipo: p.tipo as TipoNo, rotulo: p.rotulo?.slice(0, 80) || meta(p.tipo)?.nome, posicao: { x, y: yAtual }, config: cfg });
        arestas.push({ id: novoId('e'), de, para: id, ...(ramo ? { ramo } : {}) });
        legivel.push({ tipo: p.tipo, categoria: meta(p.tipo)?.categoria ?? 'acao', nome: p.rotulo || meta(p.tipo)?.nome || p.tipo, detalhe: this.detalhe(p.tipo, cfg), nivel, ...(i === 0 && rotuloRamo ? { ramo: rotuloRamo } : {}) });

        const saidas = this.saidasDo({ tipo: p.tipo, config: cfg });
        if (saidas) {
          if (i < passos.length - 1) erros.push(`${onde}: tem saídas nomeadas, os passos seguintes vão dentro de "ramos"`);
          const larguraTotal = (saidas.length - 1) * ESPACO_X;
          saidas.forEach((s, k) => {
            const filhos = p.ramos?.[s.id] ?? [];
            const xRamo = x - larguraTotal / 2 + k * ESPACO_X;
            // Ramo vazio termina de propósito: o validador exige destino em toda saída.
            encadear(filhos.length ? filhos : [{ tipo: 'controle.encerrar', rotulo: 'Encerrar', config: {} }], id, s.id, xRamo, yAtual + ESPACO_Y, nivel + 1, s.rotulo);
          });
          return;
        }
        de = id;
        ramo = undefined;
        yAtual += ESPACO_Y;
      }
    };
    encadear(plano.passos, gatilhoId, undefined, 0, ESPACO_Y, 0);

    if (!plano.passos.length) erros.push('o fluxo não faz nada: inclua ao menos uma ação em "passos"');
    return erros.length ? { erros } : { grafo: { nos, arestas }, legivel };
  }

  private saidasDo(no: { tipo: string; config: Record<string, unknown> }): { id: string; rotulo: string }[] | null {
    const fixos = ramosFixosDoNo(no);
    if (fixos) return [...fixos];
    if (no.tipo === 'controle.condicao') {
      const ramos = (no.config as { ramos?: { id: string; rotulo?: string }[] }).ramos ?? [];
      return ramos.map((r) => ({ id: r.id, rotulo: r.rotulo ?? r.id }));
    }
    return null;
  }

  /** Uma linha do que o passo faz, para o chat. */
  private detalhe(tipo: string, c: Record<string, unknown>): string {
    switch (tipo) {
      case 'acao.enviar_sms': return String(c.texto ?? '');
      case 'acao.enviar_email': return `Assunto: ${String(c.assunto ?? '')}`;
      case 'acao.notificar_equipe': return String(c.texto ?? '');
      case 'acao.adicionar_tag':
      case 'acao.remover_tag':
      case 'gatilho.tag_adicionada': return `#${String(c.tag ?? '')}`;
      case 'controle.esperar':
      case 'controle.esperar_resposta': return `${String(c.duracao)} ${String(c.unidade)}`;
      case 'acao.criar_tarefa':
      case 'acao.criar_oportunidade': return String(c.titulo ?? '');
      case 'acao.ia': return String(c.instrucao ?? '');
      case 'gatilho.mensagem_recebida': return c.contem ? `contém "${String(c.contem)}"` : String(c.canal ?? 'WhatsApp');
      default: return CATALOGO.find((m) => m.tipo === tipo)?.descricao ?? '';
    }
  }
}
