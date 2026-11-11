import { Injectable, Logger } from '@nestjs/common';
import type { RealtimeEvent } from '@khub/types';
import { PrismaService } from '../prisma/prisma.service';
import { RunsService } from './runs.service';
import { grafoSchema, validarConfig, type Grafo, type No, type TipoNo } from './catalogo';
import type { Contexto } from './executor.service';
import type { GatilhoJob } from '../events/domain-events.service';
import { MAPA_AGENDA, contextoAgendamento, ehEventoAgenda, ehGatilhoAgenda, filtroAgendaBate } from './agendamento-contexto';
import { EVENTO_DOMINIO_PARA_ESPERA } from './eventos-espera';
import { contatoDoRegistro, negocioDoRegistro } from './contexto';

const brl = (v: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** Evento de domínio → tipo de gatilho. Evento fora daqui não aciona nada. */
const MAPA: Partial<Record<RealtimeEvent, TipoNo>> = {
  'contact.created': 'gatilho.contato_criado',
  'deal.moved': 'gatilho.etapa_mudou',
  'deal.created': 'gatilho.negocio_criado',
  'deal.status_changed': 'gatilho.negocio_status',
  'message.created': 'gatilho.mensagem_recebida',
  'contact.tagged': 'gatilho.tag_adicionada',
  // Agenda (migration 054): appointment.* → gatilho.agendamento_* / faltou / lembrete
  ...MAPA_AGENDA,
  // Q3.2: formulário (publicado pela Q4.1) e cobrança paga (trigger da db/057)
  'form.submitted': 'gatilho.formulario_enviado',
  'payment.received': 'gatilho.pagamento_recebido',
};

/**
 * Normaliza um termo de filtro para comparação tolerante: minúsculas, sem
 * acento e sem espaço/hífen/sublinhado — "Meta Ads" == "metaads" == "meta-ads",
 * "Indicação" == "indicacao". Usado na origem do contato e no canal (BUG-029).
 */
export function normalizarTermo(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s\-_]+/g, '');
}

/** Valores de `canal` no gatilho "Mensagem recebida" que significam "qualquer canal". */
const QUALQUER_CANAL = new Set(['*', 'qualquer', 'todos']);

/**
 * Casa evento de domínio com workflows ativos e abre a execução.
 *
 * Roda no worker da fila `automation-triggers` — o CRM só publicou o evento e
 * seguiu a vida. É isto que mantém `crm` sem saber que automações existem.
 */
@Injectable()
export class TriggersService {
  private readonly log = new Logger('Automations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
  ) {}

  async processar(job: GatilhoJob): Promise<void> {
    const tipo = MAPA[job.evento];
    if (!tipo) return;

    // Mensagem enviada por nós não é "mensagem recebida" — senão o fluxo
    // responderia à própria resposta, em loop.
    if (tipo === 'gatilho.mensagem_recebida' && job.dados.de !== 'contato') return;

    // O contato falou: antes de abrir fluxo novo, acorda quem esperava por ele
    // ("Esperar resposta") e para quem tem `pararNoReply`. Ordem importa — quem
    // já respondeu não deve receber o follow-up automático.
    let contatoDaMensagem: string | null = null;
    if (tipo === 'gatilho.mensagem_recebida') {
      contatoDaMensagem = await this.contatoDaConversa(job);
      // Leva o TEXTO da resposta: a condição seguinte ("resposta contém Google") precisa dele.
      if (contatoDaMensagem) await this.runs.avisarResposta(job.tenantId, contatoDaMensagem, { id: String(job.dados.id ?? ''), texto: String(job.dados.texto ?? '') });
    }

    // Q3.1: metas e "Esperar até" (evento) dos runs JÁ abertos do contato —
    // independe de haver fluxo novo com este gatilho.
    const espera = EVENTO_DOMINIO_PARA_ESPERA[job.evento];
    if (espera) {
      const contactId = job.evento === 'message.created' ? contatoDaMensagem : await this.contatoDoEvento(job);
      if (contactId) await this.runs.avisarEvento(job.tenantId, contactId, espera, job.dados);
    }

    const ativos = await this.workflowsAtivos(job.tenantId, tipo);
    if (!ativos.length) return;

    const contexto = await this.montarContexto(job);
    if (!contexto) return;

    for (const wf of ativos) {
      const grafo = grafoSchema.parse(wf.grafo);
      const gatilho = grafo.nos.find((n) => n.id === wf.noGatilhoId);
      if (!gatilho || !this.filtroBate(gatilho, job, contexto)) continue;

      await this.runs.iniciar({
        tenantId: job.tenantId,
        workflowId: wf.workflowId,
        versionId: wf.versionId,
        gatilho: tipo,
        grafo,
        noInicial: gatilho.id,
        contexto: { ...contexto, gatilho: job.dados },
        // mesmo evento + mesmo workflow = uma execução só
        dedupeKey: `${job.dedupeKey}:${gatilho.id}`,
      });
    }
  }

  /** Workflows ativos do tenant cujo grafo publicado tem um gatilho deste tipo. */
  private async workflowsAtivos(tenantId: string, tipo: TipoNo) {
    const wfs = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflow.findMany({
        where: { status: 'ativo', versaoAtivaId: { not: null } },
        select: { id: true, versaoAtivaId: true, versaoAtiva: { select: { id: true, grafo: true } } },
      }),
    );
    const saida: { workflowId: string; versionId: string; grafo: unknown; noGatilhoId: string }[] = [];
    for (const wf of wfs) {
      if (!wf.versaoAtiva) continue;
      const grafo = grafoSchema.safeParse(wf.versaoAtiva.grafo);
      if (!grafo.success) continue;
      for (const no of grafo.data.nos.filter((n) => n.tipo === tipo)) {
        saida.push({ workflowId: wf.id, versionId: wf.versaoAtiva.id, grafo: wf.versaoAtiva.grafo, noGatilhoId: no.id });
      }
    }
    return saida;
  }

  /** Contato de um evento de domínio (fora mensagem, que vem da conversa). */
  private async contatoDoEvento(job: GatilhoJob): Promise<string | null> {
    const d = job.dados;
    if (job.evento === 'contact.tagged') return typeof d.id === 'string' ? d.id : null;
    if (typeof d.contactId === 'string' && d.contactId) return d.contactId;
    const dealId = job.evento === 'deal.moved' || job.evento === 'deal.status_changed' ? d.id : job.evento === 'payment.received' ? d.dealId : null;
    if (typeof dealId !== 'string' || !dealId) return null;
    return this.prisma.withTenant(job.tenantId, async (tx) => {
      const deal = await tx.deal.findUnique({ where: { id: dealId }, select: { contactId: true } });
      return deal?.contactId ?? null;
    });
  }

  private async contatoDaConversa(job: GatilhoJob): Promise<string | null> {
    return this.prisma.withTenant(job.tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: job.dados.conversationId as string }, select: { contactId: true } });
      return conv?.contactId ?? null;
    });
  }

  /**
   * Gatilho por webhook (`gatilho.webhook`): payload externo → contato → run.
   * A rota é pública; o tenant/workflow vêm do roteamento pela chave da URL
   * (migration 011), nunca do corpo — o corpo é de quem chama.
   */
  async processarWebhook(tenantId: string, workflowId: string, payload: Record<string, unknown>, eventId?: string): Promise<{ ok: boolean; motivo?: string; runId?: string }> {
    const wf = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflow.findUnique({ where: { id: workflowId }, include: { versaoAtiva: { select: { id: true, grafo: true } } } }),
    );
    if (!wf?.versaoAtiva || wf.status !== 'ativo') return { ok: false, motivo: 'workflow inativo' };

    const grafo = grafoSchema.parse(wf.versaoAtiva.grafo);
    const gatilho = grafo.nos.find((n) => n.tipo === 'gatilho.webhook');
    if (!gatilho) return { ok: false, motivo: 'workflow sem gatilho de webhook' };

    // O grafo publicado guarda a config crua: aplica os defaults do catálogo (identificarPor/campo/seNaoAchar),
    // senão um gatilho criado sem eles (API, blueprint, Nyro) estoura TypeError e o evento fica em retry sem aviso.
    const conferida = validarConfig('gatilho.webhook', gatilho.config);
    if (!conferida.ok) return { ok: false, motivo: `gatilho de webhook inválido: ${conferida.erro}` };
    const cfg = conferida.dados as { identificarPor: 'email' | 'telefone'; campo: string; seNaoAchar: 'criar' | 'ignorar' };
    const valor = String(this.doCaminho(payload, cfg.campo) ?? '').trim();
    if (!valor) return { ok: false, motivo: `payload sem o campo "${cfg.campo}"` };

    const contato = await this.acharOuCriarContato(tenantId, cfg, valor, payload);
    if (!contato) return { ok: false, motivo: 'contato não encontrado (configurado para ignorar)' };

    const r = await this.runs.iniciar({
      tenantId, workflowId, versionId: wf.versaoAtiva.id, gatilho: 'gatilho.webhook',
      grafo, noInicial: gatilho.id,
      contexto: { contato, gatilho: payload },
      dedupeKey: `webhook:${workflowId}:${eventId ?? valor}`,
    });
    return 'runId' in r ? { ok: true, runId: r.runId } : { ok: true, motivo: 'contato não reentra neste fluxo' };
  }

  /** `dados.cliente.email` → valor aninhado do payload recebido. */
  private doCaminho(obj: Record<string, unknown>, caminho: string): unknown {
    return caminho.split('.').reduce<unknown>((acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined), obj);
  }

  private async acharOuCriarContato(tenantId: string, cfg: { identificarPor: 'email' | 'telefone'; seNaoAchar: 'criar' | 'ignorar' }, valor: string, payload: Record<string, unknown>) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = cfg.identificarPor === 'email'
        ? { email: { equals: valor, mode: 'insensitive' as const } }
        : { telefone: { contains: valor.replace(/\D/g, '').slice(-8) } };
      let c = await tx.contact.findFirst({ where });

      if (!c) {
        if (cfg.seNaoAchar === 'ignorar') return null;
        const nome = String(payload.nome ?? payload.name ?? valor);
        c = await tx.contact.create({
          data: {
            tenantId, nome,
            email: cfg.identificarPor === 'email' ? valor : null,
            telefone: cfg.identificarPor === 'telefone' ? valor : null,
            tag: 'Lead', camposCustom: payload as never, ultimoContatoAt: new Date(),
          },
        });
        await tx.activity.create({ data: { tenantId, actor: 'Webhook', acao: `novo contato via webhook: "${nome}"`, tone: 'success', contactId: c.id } });
      }
      return contatoDoRegistro(c);
    });
  }

  /** Filtro configurado no próprio gatilho (etapa X, tag Y, texto contém Z). */
  private filtroBate(gatilho: No, job: GatilhoJob, ctx: Contexto): boolean {
    const cfg = gatilho.config as Record<string, string | undefined>;
    switch (gatilho.tipo as TipoNo) {
      case 'gatilho.etapa_mudou':
        return !cfg.stageId || cfg.stageId === (job.dados.stageId as string);
      case 'gatilho.tag_adicionada':
        return !cfg.tag || cfg.tag.toLowerCase() === String(job.dados.tag ?? '').toLowerCase();
      case 'gatilho.mensagem_recebida':
        return this.canalBate(cfg.canal, ctx.mensagem?.canal)
          && (!cfg.contem || String(job.dados.texto ?? '').toLowerCase().includes(cfg.contem.toLowerCase()));
      case 'gatilho.contato_criado':
        return !cfg.origem?.trim() || normalizarTermo(cfg.origem) === normalizarTermo(job.dados.origem);
      case 'gatilho.negocio_criado':
        return !cfg.stageId || cfg.stageId === (job.dados.stageId as string);
      case 'gatilho.negocio_status':
        return !cfg.status || cfg.status === String(job.dados.status ?? '');
      case 'gatilho.formulario_enviado':
        return !cfg.formId || cfg.formId === String(job.dados.formId ?? '');
      case 'gatilho.pagamento_recebido': {
        const minimo = Number((gatilho.config as { valorMinimo?: unknown }).valorMinimo ?? 0);
        return !minimo || Number(job.dados.valorCentavos ?? 0) / 100 >= minimo;
      }
      default:
        // Agenda: filtro opcional por tipo de compromisso e por responsável.
        if (ehGatilhoAgenda(gatilho.tipo)) return filtroAgendaBate(cfg, job.dados);
        return false;
    }
  }

  /**
   * Canal configurado no gatilho × canal da conversa (Q1.2). Sem `canal` na
   * config vale o padrão do catálogo (WhatsApp) — é o que a paleta promete;
   * `qualquer`/`todos`/`*` aceita todos. Canal da conversa desconhecido (evento
   * sem conversa resolvida) não filtra: sem dado, não descarta.
   */
  private canalBate(cfgCanal: string | undefined, canalConversa: string | undefined): boolean {
    if (!canalConversa) return true;
    const alvo = normalizarTermo(cfgCanal?.trim() || 'WhatsApp');
    if (QUALQUER_CANAL.has(alvo)) return true;
    return alvo === normalizarTermo(canalConversa);
  }

  /**
   * Monta o contexto a partir do banco — não do payload do evento. O evento diz
   * "quem"; o estado atual do contato/negócio vem da fonte da verdade.
   */
  private async montarContexto(job: GatilhoJob): Promise<Contexto | null> {
    const contactId = this.acharContactId(job);
    const dealId = job.evento === 'deal.moved' || job.evento === 'deal.status_changed'
      ? (job.dados.id as string)
      : job.evento === 'payment.received' && typeof job.dados.dealId === 'string' ? job.dados.dealId : undefined;

    return this.prisma.withTenant(job.tenantId, async (tx) => {
      const ctx: Contexto = {};

      let idContato = contactId;
      if (!idContato && dealId) {
        const d = await tx.deal.findUnique({ where: { id: dealId }, select: { contactId: true } });
        idContato = d?.contactId ?? undefined;
      }
      if (job.evento === 'message.created') {
        const conv = await tx.conversation.findUnique({ where: { id: job.dados.conversationId as string }, select: { contactId: true, canal: true } });
        idContato = conv?.contactId ?? undefined;
        ctx.mensagem = { id: job.dados.id as string, texto: job.dados.texto as string, de: job.dados.de as string, ...(conv?.canal ? { canal: conv.canal } : {}) };
      }
      // Agenda: o estado atual do compromisso (não o do evento) + o contato dele.
      // Data/hora no fuso da conta, para {{agendamento.data}} / {{agendamento.hora}}.
      if (ehEventoAgenda(job.evento)) {
        const ag = await tx.agendaCompromisso.findUnique({ where: { id: job.dados.id as string } });
        if (!ag) return null;
        const tenant = await tx.tenant.findUnique({ where: { id: job.tenantId }, select: { settings: true } });
        const fuso = (tenant?.settings as Record<string, unknown> | null)?.timezone;
        ctx.agendamento = contextoAgendamento(ag, fuso);
        idContato = ag.contactId ?? undefined;
      }

      // Formulário (Q3.2): `{{formulario.<campo>}}` com as respostas + o id.
      if (job.evento === 'form.submitted') {
        const respostas = job.dados.respostas && typeof job.dados.respostas === 'object' && !Array.isArray(job.dados.respostas)
          ? (job.dados.respostas as Record<string, unknown>) : {};
        ctx.formulario = { ...respostas, id: String(job.dados.formId ?? '') };
      }
      // Pagamento (Q3.2): a cobrança como está AGORA no banco (não o payload).
      if (job.evento === 'payment.received') {
        const cob = await tx.financeiroCobranca.findUnique({ where: { id: job.dados.id as string } });
        if (!cob || cob.status !== 'paga') return null;
        const valor = cob.valorCentavos / 100;
        ctx.pagamento = {
          id: cob.id, valor, valorFormatado: brl(valor), valorCentavos: cob.valorCentavos, moeda: cob.moeda,
          descricao: cob.descricao, pagoEm: (cob.pagoEm ?? new Date()).toISOString(),
        };
        if (!idContato && cob.contactId) idContato = cob.contactId;
      }
      if (!idContato && (job.evento === 'form.submitted' || job.evento === 'payment.received') && typeof job.dados.contactId === 'string') {
        idContato = job.dados.contactId;
      }

      if (idContato) {
        const c = await tx.contact.findUnique({ where: { id: idContato } });
        if (c) ctx.contato = contatoDoRegistro(c);
      }
      if (dealId) {
        const d = await tx.deal.findUnique({ where: { id: dealId } });
        if (d) ctx.negocio = negocioDoRegistro(d);
      }

      // Sem contato não há a quem automatizar: melhor não abrir run do que abrir
      // uma que vai falhar no primeiro nó de ação.
      if (!ctx.contato && !ctx.negocio) return null;
      return ctx;
    });
  }

  private acharContactId(job: GatilhoJob): string | undefined {
    if (job.evento === 'contact.created' || job.evento === 'contact.tagged') return job.dados.id as string;
    return undefined;
  }
}
