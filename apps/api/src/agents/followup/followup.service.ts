import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type AgentFollowup, type AgentFollowupRule } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AGENT_LLM, type AgentLlm } from '../../ai/provider.contract';
import { validarResposta } from '../../nyro/guardrails';
import { DeliveryService } from '../delivery/delivery.service';
import { fragmentarMensagem } from '../engines/message-chunker';
import { validarNaturalidade } from '../engines/response-validator';
import { valorTexto } from '../engines/profile-policy';
import {
  CATALOGO_ESTRATEGIAS,
  ESTRATEGIAS,
  escolherEstrategia,
  horarioDaTentativa,
  motivoParada,
  proximoHorarioPermitido,
  type Estrategia,
} from '../engines/followup-policy';
import { contextoDinamico, promptEstavel } from '../intelligence/prompt';
import { ProfileService, type PerfilContexto } from '../intelligence/profile.service';
import { MemoryService } from '../intelligence/memory.service';
import { VersioningService } from '../versioning/versioning.service';

/** Proatividade tem limite: sem resposta do contato há mais que isso, só reativação/perda reabrem. */
const MAX_DIAS_SEM_INBOUND = 90;

export interface RegraInput {
  ativo?: boolean;
  nome?: string;
  maxTentativas?: number;
  intervalosHoras?: number[];
  horarioInicio?: number;
  horarioFim?: number;
  diasSemana?: number[];
  fuso?: string;
  objetivo?: string;
  tom?: string;
  instrucoes?: string;
  pararSe?: string[];
  maxMensagensDia?: number;
  prioridade?: number;
}

/**
 * FOLLOW-UP INTELLIGENCE (docs/AI_AGENT_ARCHITECTURE.md §11)
 * ==========================================================
 *
 * Ciclo: após cada resposta do agente, agenda a tentativa 1 da estratégia
 * que melhor descreve o contato AGORA (objeção de preço ≠ orçamento enviado ≠
 * lead frio). O worker executa o vencido: reavalia as condições de parada,
 * respeita janela de horário/dias e o limite diário, GERA a mensagem a partir
 * do contexto real (perfil, resumo, últimas mensagens, objetivo da
 * estratégia), passa pelo guardrail e pela naturalidade, fragmenta e entrega
 * pela mesma fila do atendimento.
 *
 * Anti-duplicidade no BANCO: no máximo um follow-up agendado por contato e
 * agente (índice único parcial) e uma linha por (ciclo, tentativa).
 * Sem IA configurada não há mensagem genérica de fallback: a tentativa é
 * `pulado` com o motivo.
 */
@Injectable()
export class FollowupService {
  private readonly log = new Logger('AgentFollowup');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm,
    private readonly entregas: DeliveryService,
    private readonly perfis: ProfileService,
    private readonly memoria: MemoryService,
    private readonly versoes: VersioningService,
  ) {}

  // ------------------------------------------------------------------ regras

  /** Regras do agente: as 8 estratégias, gravadas ou com o padrão do catálogo. */
  async regras(tenantId: string, agentId: string) {
    const salvas = await this.prisma.withTenant(tenantId, (tx) => tx.agentFollowupRule.findMany({ where: { agentId } }));
    return ESTRATEGIAS.map((e) => {
      const s = salvas.find((r) => r.estrategia === e);
      const cat = CATALOGO_ESTRATEGIAS[e];
      return s
        ? { ...s, salva: true, catalogo: cat }
        : { id: null, agentId, estrategia: e, nome: cat.nome, ativo: false, maxTentativas: cat.tentativas, intervalosHoras: cat.intervalos, horarioInicio: 9, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo', objetivo: cat.objetivo, tom: '', instrucoes: cat.instrucoes, pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu'], maxMensagensDia: 1, prioridade: 5, salva: false, catalogo: cat };
    });
  }

  async salvarRegra(tenantId: string, agentId: string, estrategia: string, d: RegraInput) {
    if (!(ESTRATEGIAS as readonly string[]).includes(estrategia)) throw new BadRequestException('estratégia inválida');
    const cat = CATALOGO_ESTRATEGIAS[estrategia as Estrategia];
    if (d.fuso) {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: d.fuso });
      } catch {
        throw new BadRequestException('fuso horário inválido');
      }
    }
    if (d.intervalosHoras && (d.intervalosHoras.length === 0 || d.intervalosHoras.some((h) => !Number.isInteger(h) || h < 1 || h > 8760))) throw new BadRequestException('intervalos devem ser horas inteiras entre 1 e 8760');
    if (d.diasSemana && d.diasSemana.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) throw new BadRequestException('dias da semana entre 0 (domingo) e 6');
    if (d.pararSe && d.pararSe.some((p) => !['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'].includes(p))) throw new BadRequestException('condição de parada inválida');
    const dados = {
      ...(d.nome !== undefined ? { nome: d.nome.trim().slice(0, 80) || cat.nome } : {}),
      ...(d.ativo !== undefined ? { ativo: d.ativo } : {}),
      ...(d.maxTentativas !== undefined ? { maxTentativas: d.maxTentativas } : {}),
      ...(d.intervalosHoras !== undefined ? { intervalosHoras: d.intervalosHoras } : {}),
      ...(d.horarioInicio !== undefined ? { horarioInicio: d.horarioInicio } : {}),
      ...(d.horarioFim !== undefined ? { horarioFim: d.horarioFim } : {}),
      ...(d.diasSemana !== undefined ? { diasSemana: [...new Set(d.diasSemana)].sort() } : {}),
      ...(d.fuso !== undefined ? { fuso: d.fuso } : {}),
      ...(d.objetivo !== undefined ? { objetivo: d.objetivo.slice(0, 500) } : {}),
      ...(d.tom !== undefined ? { tom: d.tom.slice(0, 200) } : {}),
      ...(d.instrucoes !== undefined ? { instrucoes: d.instrucoes.slice(0, 2000) } : {}),
      ...(d.pararSe !== undefined ? { pararSe: [...new Set([...d.pararSe, 'optout'])] } : {}),
      ...(d.maxMensagensDia !== undefined ? { maxMensagensDia: d.maxMensagensDia } : {}),
      ...(d.prioridade !== undefined ? { prioridade: d.prioridade } : {}),
    };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true } });
      if (!a) throw new NotFoundException('agente inexistente');
      return tx.agentFollowupRule.upsert({
        where: { agentId_estrategia: { agentId, estrategia } },
        create: { tenantId, agentId, estrategia, nome: cat.nome, maxTentativas: cat.tentativas, intervalosHoras: cat.intervalos, objetivo: cat.objetivo, instrucoes: cat.instrucoes, ...dados },
        update: { ...dados, updatedAt: new Date() },
      });
    });
  }

  // ------------------------------------------------------------------ ciclo

  /**
   * Depois de uma resposta do agente: agenda (ou re-agenda) a tentativa 1 da
   * estratégia adequada. Um ciclo anterior ainda agendado é substituído — o
   * contexto mudou.
   */
  async agendarAposResposta(tenantId: string, i: { agentId: string; contactId: string | null; conversationId: string; intencao: string; objecoes: string[]; temperatura: string | null; perfil: PerfilContexto; forcarEstrategia?: string | null }): Promise<{ agendado: boolean; estrategia?: string; para?: Date; motivo?: string }> {
    if (!i.contactId) return { agendado: false, motivo: 'conversa sem contato' };
    const contactId = i.contactId;
    if (i.intencao === 'desinteresse' || i.intencao === 'cancelamento') {
      await this.cancelarAgendados(tenantId, contactId, `contato demonstrou ${i.intencao}`, i.agentId);
      return { agendado: false, motivo: `intenção ${i.intencao}` };
    }
    const dados = await this.prisma.withTenant(tenantId, async (tx) => ({
      regras: await tx.agentFollowupRule.findMany({ where: { agentId: i.agentId, ativo: true } }),
      deal: await tx.deal.findFirst({ where: { contactId }, orderBy: { updatedAt: 'desc' }, select: { status: true } }),
      compromisso: await tx.agendaCompromisso.findFirst({ where: { contactId, inicio: { gte: new Date() }, status: { in: ['agendado', 'confirmado'] } }, select: { id: true } }),
      contato: await tx.contact.findUnique({ where: { id: contactId }, select: { optedOutAt: true } }),
    }));
    if (!dados.regras.length) return { agendado: false, motivo: 'nenhuma estratégia de follow-up ativa' };
    if (dados.contato?.optedOutAt) return { agendado: false, motivo: 'contato optou por não receber mensagens' };
    if (i.perfil.convertido) return { agendado: false, motivo: 'contato já converteu' };
    const ativas = new Set(dados.regras.map((r) => r.estrategia as Estrategia));
    const objecoesPerfil = valorTexto(i.perfil.fatos.get('objecoes')?.valor).toLowerCase();
    const forcada = i.forcarEstrategia && ativas.has(i.forcarEstrategia as Estrategia) ? (i.forcarEstrategia as Estrategia) : null;
    const estrategia =
      forcada ??
      escolherEstrategia(
        {
          intencao: i.intencao,
          objecoes: [...i.objecoes, ...(objecoesPerfil.includes('preco') || objecoesPerfil.includes('preço') ? ['preco'] : [])],
          temperatura: i.temperatura,
          etapaPerdida: dados.deal?.status === 'perdido',
          orcamentoEnviado: i.intencao === 'orcamento' || i.intencao === 'negociacao',
          agendamentoPendente: i.intencao === 'agendamento' && !dados.compromisso,
        },
        ativas,
      );
    if (!estrategia) return { agendado: false, motivo: 'nenhuma estratégia aplicável está ativa' };
    const regra = dados.regras.find((r) => r.estrategia === estrategia)!;
    return this.iniciarCiclo(tenantId, regra, contactId, i.conversationId, { intencao: i.intencao, objecoes: i.objecoes, temperatura: i.temperatura });
  }

  private async iniciarCiclo(tenantId: string, regra: AgentFollowupRule, contactId: string, conversationId: string, contexto: Record<string, unknown>) {
    const referencia = new Date();
    const para = horarioDaTentativa(referencia, 1, regra);
    if (!para) return { agendado: false, motivo: 'regra sem dia/horário permitido' };
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.agentFollowup.updateMany({ where: { contactId, agentId: regra.agentId, status: 'agendado' }, data: { status: 'cancelado', motivo: 'substituído por novo contexto', updatedAt: new Date() } });
        await tx.agentFollowup.create({
          data: { tenantId, agentId: regra.agentId, ruleId: regra.id, contactId, conversationId, cicloId: randomUUID(), estrategia: regra.estrategia, tentativa: 1, agendadoPara: para, contexto: { ...contexto, referencia: referencia.toISOString() } as Prisma.InputJsonValue },
        });
      });
    } catch (e) {
      // Corrida com outro agendamento (índice único parcial): o outro vence.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { agendado: false, motivo: 'já existe follow-up em andamento' };
      throw e;
    }
    return { agendado: true, estrategia: regra.estrategia, para };
  }

  async cancelarAgendados(tenantId: string, contactId: string, motivo: string, agentId?: string): Promise<number> {
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentFollowup.updateMany({ where: { contactId, status: 'agendado', ...(agentId ? { agentId } : {}) }, data: { status: 'cancelado', motivo, updatedAt: new Date() } }),
    );
    return r.count;
  }

  /** Intervenção humana. */
  async cancelar(tenantId: string, id: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.agentFollowup.updateMany({ where: { id, status: 'agendado' }, data: { status: 'cancelado', motivo: `cancelado por humano (${identityId})`, updatedAt: new Date() } });
      if (!r.count) throw new BadRequestException('follow-up não está agendado');
      return { ok: true };
    });
  }

  async reagendar(tenantId: string, id: string, para: Date) {
    if (Number.isNaN(+para) || para.getTime() < Date.now()) throw new BadRequestException('data inválida ou no passado');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.agentFollowup.updateMany({ where: { id, status: 'agendado' }, data: { agendadoPara: para, updatedAt: new Date() } });
      if (!r.count) throw new BadRequestException('follow-up não está agendado');
      return { ok: true };
    });
  }

  /** Inicia manualmente um ciclo para um contato (botão no perfil). */
  async iniciarManual(tenantId: string, agentId: string, contactId: string, estrategia: string) {
    const d = await this.prisma.withTenant(tenantId, async (tx) => ({
      regra: await tx.agentFollowupRule.findUnique({ where: { agentId_estrategia: { agentId, estrategia } } }),
      conv: await tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, select: { id: true } }),
    }));
    if (!d.regra) throw new BadRequestException('configure e salve esta estratégia antes de usar');
    if (!d.conv) throw new BadRequestException('contato sem conversa de WhatsApp');
    return this.iniciarCiclo(tenantId, d.regra, contactId, d.conv.id, { manual: true });
  }

  async listar(tenantId: string, filtro: { agentId?: string; contactId?: string; status?: string; limit?: number }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const itens = await tx.agentFollowup.findMany({
        where: { ...(filtro.agentId ? { agentId: filtro.agentId } : {}), ...(filtro.contactId ? { contactId: filtro.contactId } : {}), ...(filtro.status ? { status: filtro.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: Math.min(filtro.limit ?? 100, 300),
      });
      const contatos = await tx.contact.findMany({ where: { id: { in: [...new Set(itens.map((i) => i.contactId))] } }, select: { id: true, nome: true } });
      const nomes = new Map(contatos.map((c) => [c.id, c.nome]));
      return itens.map((i) => ({ ...i, contatoNome: nomes.get(i.contactId) ?? null }));
    });
  }

  // ------------------------------------------------------------------ worker

  /** Executa os vencidos do tenant (chamado pela manutenção a cada minuto). */
  async processarVencidos(tenantId: string): Promise<{ processados: number }> {
    const vencidos = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentFollowup.findMany({ where: { status: 'agendado', agendadoPara: { lte: new Date() } }, orderBy: { agendadoPara: 'asc' }, take: 25, select: { id: true } }),
    );
    for (const v of vencidos) {
      await this.executar(tenantId, v.id).catch((e: Error) => this.log.error(`follow-up ${v.id} falhou: ${e.message}`));
    }
    return { processados: vencidos.length };
  }

  async executar(tenantId: string, id: string): Promise<string> {
    // Reserva (update condicional = um worker só).
    const fu = await this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.agentFollowup.updateMany({ where: { id, status: 'agendado' }, data: { status: 'gerando', updatedAt: new Date() } });
      return r.count ? tx.agentFollowup.findUnique({ where: { id } }) : null;
    });
    if (!fu) return 'ignorado';
    try {
      return await this.executarReservado(tenantId, fu);
    } catch (e) {
      await this.finalizar(tenantId, fu.id, 'falhou', (e as Error).message.slice(0, 300));
      throw e;
    }
  }

  private async executarReservado(tenantId: string, fu: AgentFollowup): Promise<string> {
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => ({
      regra: await tx.agentFollowupRule.findUnique({ where: { id: fu.ruleId } }),
      agente: await tx.agent.findUnique({ where: { id: fu.agentId } }),
      contato: await tx.contact.findUnique({ where: { id: fu.contactId }, select: { nome: true, optedOutAt: true, lastInboundAt: true } }),
      conv: await tx.conversation.findUnique({ where: { id: fu.conversationId }, select: { atendimento: true, assigneeId: true } }),
      compromisso: await tx.agendaCompromisso.findFirst({ where: { contactId: fu.contactId, createdAt: { gt: fu.createdAt }, status: { in: ['agendado', 'confirmado'] } }, select: { id: true } }),
      enviadosHoje: await tx.agentFollowup.count({ where: { contactId: fu.contactId, status: 'enviado', executadoEm: { gte: new Date(Date.now() - 24 * 3_600_000) } } }),
      tenant: await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true } }),
      historico: await tx.message.findMany({ where: { conversationId: fu.conversationId }, orderBy: { createdAt: 'desc' }, take: 14, select: { autorTipo: true, corpo: true } }),
    }));
    if (!ctx.regra || !ctx.regra.ativo) return this.finalizar(tenantId, fu.id, 'cancelado', 'estratégia desativada');
    if (!ctx.agente || ctx.agente.status !== 'ativo') return this.finalizar(tenantId, fu.id, 'cancelado', 'agente não está ativo');
    const perfil = await this.perfis.carregar(tenantId, fu.contactId);
    const referencia = new Date(String((fu.contexto as Record<string, unknown>).referencia ?? fu.createdAt.toISOString()));
    const parada = motivoParada(ctx.regra.pararSe, {
      respondeuDepois: !!ctx.contato?.lastInboundAt && ctx.contato.lastInboundAt > referencia,
      convertido: perfil.convertido,
      optout: !!ctx.contato?.optedOutAt,
      humanoAssumiu: ctx.conv?.atendimento === 'humano' && !!ctx.conv.assigneeId,
      agendou: !!ctx.compromisso,
      desinteresse: perfil.intencao === 'desinteresse',
    });
    if (parada) return this.finalizar(tenantId, fu.id, 'cancelado', parada);
    const diasSemInbound = ctx.contato?.lastInboundAt ? (Date.now() - ctx.contato.lastInboundAt.getTime()) / 86_400_000 : Infinity;
    if (diasSemInbound > MAX_DIAS_SEM_INBOUND && !['reativacao', 'oportunidade_perdida'].includes(fu.estrategia)) {
      return this.finalizar(tenantId, fu.id, 'cancelado', `sem mensagem do contato há mais de ${MAX_DIAS_SEM_INBOUND} dias`);
    }
    // Janela e limite diário: fora → re-agenda (não envia fora do permitido).
    const agoraOk = proximoHorarioPermitido(new Date(), ctx.regra);
    if (!agoraOk) return this.finalizar(tenantId, fu.id, 'cancelado', 'regra sem dia/horário permitido');
    if (ctx.enviadosHoje >= ctx.regra.maxMensagensDia || agoraOk.getTime() - Date.now() > 60_000) {
      const para = ctx.enviadosHoje >= ctx.regra.maxMensagensDia ? proximoHorarioPermitido(new Date(Date.now() + 24 * 3_600_000), ctx.regra) : agoraOk;
      await this.prisma.withTenant(tenantId, (tx) => tx.agentFollowup.update({ where: { id: fu.id }, data: { status: 'agendado', agendadoPara: para ?? agoraOk, motivo: ctx.enviadosHoje >= ctx.regra!.maxMensagensDia ? 'limite diário atingido: adiado' : 'fora da janela: adiado', updatedAt: new Date() } }));
      return 'adiado';
    }
    if (!this.llm.configured()) return this.finalizar(tenantId, fu.id, 'pulado', `IA não configurada (falta ${this.llm.missing().join(', ')})`);

    const efetivo = await this.prisma.withTenant(tenantId, (tx) => this.versoes.efetivo(tx, ctx.agente!));
    const memoria = await this.memoria.contexto(tenantId, fu.conversationId, fu.contactId, efetivo.config.memoria);
    const cat = CATALOGO_ESTRATEGIAS[fu.estrategia as Estrategia];
    const transcricao = ctx.historico.reverse().map((m) => `${m.autorTipo === 'contato' ? 'CONTATO' : m.autorTipo === 'ia' ? 'AGENTE' : 'EQUIPE'}: ${m.corpo.slice(0, 500)}`).join('\n');
    const system = [
      promptEstavel(efetivo, { empresa: ctx.tenant?.nome ?? 'a empresa', nicho: ctx.tenant?.nicho ?? null }),
      contextoDinamico({ contatoNome: ctx.contato?.nome ?? null, perfil, memoria, analise: null, instrucoesRegras: [], conhecimento: null, intencoesExtras: [] }),
      [
        `TAREFA: escrever a mensagem de FOLLOW-UP (tentativa ${fu.tentativa} de ${ctx.regra.maxTentativas}) — estratégia "${ctx.regra.nome}".`,
        `Objetivo: ${ctx.regra.objetivo || cat.objetivo}`,
        `Como fazer: ${ctx.regra.instrucoes || cat.instrucoes}`,
        ctx.regra.tom ? `Tom desta sequência: ${ctx.regra.tom}` : '',
        fu.tentativa > 1 ? 'Já houve tentativa anterior sem resposta: não repita a mesma abordagem nem a mesma frase.' : '',
        fu.tentativa === ctx.regra.maxTentativas ? 'É a última tentativa: deixe a porta aberta, sem pressão.' : '',
        'Use o contexto real do contato. Nada de mensagens genéricas como "só passando para saber". Não invente preço, condição ou horário.',
      ].filter(Boolean).join('\n'),
    ].join('\n\n');
    const r = await this.llm.conversar({
      modelo: efetivo.modelo,
      system,
      mensagens: [{ role: 'user', content: `<conversa_recente>\n${transcricao || '(sem mensagens)'}\n</conversa_recente>\nEscreva agora a mensagem de follow-up para o contato (só o texto da mensagem).` }],
      maxTokens: efetivo.config.inteligencia.maxTokens,
      effort: efetivo.config.inteligencia.effort,
      timeoutMs: efetivo.config.inteligencia.timeoutMs,
      fallbackRecusa: true,
    });
    if (r.pararPor === 'refusal' || !r.texto.trim()) return this.finalizar(tenantId, fu.id, 'pulado', 'o modelo não gerou mensagem');
    let texto = r.texto.trim();
    const g = validarResposta(texto, ctx.tenant?.nicho ?? null);
    if (!g.ok) texto = g.substituto ?? '';
    if (!texto) return this.finalizar(tenantId, fu.id, 'pulado', `guardrail: ${g.motivo ?? 'bloqueado'}`);
    const anteriores = ctx.historico.filter((m) => m.autorTipo === 'ia').slice(-4).map((m) => m.corpo);
    texto = validarNaturalidade(texto, { agenteNome: efetivo.nome, contatoNome: ctx.contato?.nome ?? null, jaFalouAntes: true, reapresentar: false, usarNome: efetivo.config.comunicacao.usarNome, emojis: efetivo.config.comunicacao.emojis, evitarRepeticao: true, anteriores }).texto;
    const frag = fragmentarMensagem(texto, { ...efetivo.config.comunicacao.fragmentacao, maxBlocos: Math.min(3, efetivo.config.comunicacao.fragmentacao.maxBlocos) });
    const seq = await this.entregas.enfileirar({ tenantId, agentId: fu.agentId, conversationId: fu.conversationId, followupId: fu.id, blocos: frag.blocos, chaveBase: `fu:${fu.id}` });
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentFollowup.update({ where: { id: fu.id }, data: { status: 'enviado', executadoEm: new Date(), mensagem: texto.slice(0, 4000), sequenciaId: seq.sequenciaId || null, motivo: null, updatedAt: new Date() } }),
    );
    await this.registrarUso(tenantId, efetivo.nome, r.modelo, r.uso);
    // Próxima tentativa do mesmo ciclo.
    if (fu.tentativa < ctx.regra.maxTentativas) {
      const para = horarioDaTentativa(new Date(), fu.tentativa + 1, ctx.regra);
      if (para) {
        await this.prisma
          .withTenant(tenantId, (tx) =>
            tx.agentFollowup.create({ data: { tenantId, agentId: fu.agentId, ruleId: fu.ruleId, contactId: fu.contactId, conversationId: fu.conversationId, cicloId: fu.cicloId, estrategia: fu.estrategia, tentativa: fu.tentativa + 1, agendadoPara: para, contexto: fu.contexto as Prisma.InputJsonValue } }),
          )
          .catch((e: Error) => this.log.warn(`não agendou a tentativa ${fu.tentativa + 1}: ${e.message}`));
      }
    }
    return 'enviado';
  }

  private async finalizar(tenantId: string, id: string, status: 'cancelado' | 'pulado' | 'falhou', motivo: string): Promise<string> {
    await this.prisma.withTenant(tenantId, (tx) => tx.agentFollowup.update({ where: { id }, data: { status, motivo: motivo.slice(0, 300), executadoEm: new Date(), updatedAt: new Date() } }));
    return status;
  }

  private async registrarUso(tenantId: string, agenteNome: string, modelo: string, uso: { entrada: number; saida: number; cache: number; custoUsd: number }) {
    await this.prisma
      .withTenant(tenantId, (tx) =>
        tx.aiUsageEvent.create({ data: { tenantId, conversationId: null, agente: `agente:${agenteNome}:followup`.slice(0, 120), modelo, tokensEntrada: uso.entrada, tokensSaida: uso.saida, tokensCache: uso.cache, custoUsd: new Prisma.Decimal(uso.custoUsd.toFixed(6)), latenciaMs: 0 } }),
      )
      .catch(() => undefined);
  }

  /**
   * Varreduras (1×/hora por tenant): reativação de clientes antigos e
   * oportunidades perdidas recentes. Só para agentes com a estratégia ATIVA.
   */
  async varrer(tenantId: string): Promise<{ agendados: number }> {
    const regras = await this.prisma.withTenant(tenantId, (tx) => tx.agentFollowupRule.findMany({ where: { ativo: true, estrategia: { in: ['reativacao', 'oportunidade_perdida'] } } }));
    let agendados = 0;
    for (const regra of regras) {
      const candidatos = await this.prisma.withTenant(tenantId, async (tx) => {
        const recentes = await tx.agentFollowup.findMany({ where: { agentId: regra.agentId, estrategia: regra.estrategia, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, select: { contactId: true } });
        const excluir = recentes.map((r) => r.contactId);
        if (regra.estrategia === 'reativacao') {
          const limite = new Date(Date.now() - (regra.intervalosHoras[0] ?? 720) * 3_600_000);
          const ps = await tx.agentCustomerProfile.findMany({ where: { convertidoEm: { not: null }, ultimaInteracaoAt: { lt: limite }, contactId: { notIn: excluir } }, take: 20, select: { contactId: true } });
          return ps.map((p) => p.contactId);
        }
        const ds = await tx.deal.findMany({ where: { status: 'perdido', updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, contactId: { not: null, notIn: excluir } }, take: 20, select: { contactId: true } });
        return ds.map((d) => d.contactId!).filter(Boolean);
      });
      for (const contactId of candidatos) {
        const conv = await this.prisma.withTenant(tenantId, (tx) => tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, select: { id: true, agentId: true } }));
        if (!conv || (conv.agentId && conv.agentId !== regra.agentId)) continue;
        const r = await this.iniciarCiclo(tenantId, regra, contactId, conv.id, { varredura: regra.estrategia });
        if (r.agendado) agendados++;
      }
    }
    return { agendados };
  }
}
