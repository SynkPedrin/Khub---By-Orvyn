import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AtendimentoService } from '../crm/messaging/atendimento.service';
import { DeliveryService } from './delivery/delivery.service';
import { FollowupService } from './followup/followup.service';
import { IntelligenceCoreService, type ResultadoCore } from './intelligence/intelligence-core.service';
import { traceDoResultado } from './intelligence/trace';
import { MemoryService } from './intelligence/memory.service';
import { ProfileService } from './intelligence/profile.service';
import { KnowledgeService } from './knowledge/knowledge.service';
import { eventosDoTurno, LearningService } from './learning/learning.service';
import { VersioningService } from './versioning/versioning.service';
import { MessagesService } from '../crm/messaging/messages.service';
import { avaliarHorario, mensagemForaDoHorario } from './config/horario';

export const FILA_AGENTES = 'agent-replies';
/**
 * Espera antes de responder: junta a rajada "oi / tudo bem? / queria saber…".
 * 4 s pegava só metade das rajadas reais (quem digita no celular leva 5–10 s
 * entre uma mensagem e outra) e cada rajada partida custava uma geração
 * inteira jogada fora — caro em modelo local, onde a fila é de um por vez.
 * Ajustável por AGENTE_ESPERA_RAJADA_MS.
 */
export const ATRASO_RESPOSTA_MS = Number(process.env.AGENTE_ESPERA_RAJADA_MS) || 7000;

export interface AgenteJob {
  tenantId: string;
  messageId: string;
}

export type DesfechoRun = 'nada' | 'duplicado' | 'respondido' | 'transferido' | 'ignorado' | 'erro' | 'adiado';

/** Resultado com o instante em que o job deve rodar de novo (fora do horário). */
export interface ResultadoResposta {
  desfecho: DesfechoRun;
  adiarAte?: Date;
}

/**
 * Runtime do agente no ATENDIMENTO REAL (ADR-0030 + docs/AI_AGENT_ARCHITECTURE.md §9.1).
 *
 * Roda no WORKER a partir do job `agent-replies` que o outbox enfileira para
 * cada mensagem de contato. Passos 1–4 e 15–18 do ciclo (o meio é do
 * IntelligenceCoreService):
 *  1. identifica contato/conversa; a nova mensagem INTERROMPE a sequência de
 *     blocos pendente e os follow-ups que param quando o contato responde;
 *  2. estado da conversa + versão publicada do agente + orçamento;
 *  3. memória (curto/longo/operacional) e perfil;
 *  4. fontes de conhecimento do agente;
 *  → core → 16. entrega fragmentada pela fila; 17. registra run/uso/
 *  aprendizado; 18. atualiza memória e agenda follow-up.
 *
 * Garantias herdadas: uma resposta por mensagem (UNIQUE do run), sem loop
 * (só mensagem de contato dispara), lead nunca sem dono (falha → humano),
 * nada simulado (sem chave → transferência com motivo explícito).
 */
@Injectable()
export class AgentRuntimeService {
  private readonly log = new Logger('Agentes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: IntelligenceCoreService,
    private readonly atendimento: AtendimentoService,
    private readonly entregas: DeliveryService,
    private readonly followups: FollowupService,
    private readonly memoria: MemoryService,
    private readonly perfis: ProfileService,
    private readonly conhecimento: KnowledgeService,
    private readonly versoes: VersioningService,
    private readonly aprendizado: LearningService,
    private readonly mensagens: MessagesService,
  ) {}

  /** Compatível com quem só quer o desfecho (testes, ferramentas). */
  async responder(job: AgenteJob): Promise<DesfechoRun> {
    return (await this.responderOuAdiar(job)).desfecho;
  }

  /**
   * Igual a `responder`, mas fora do horário de atendimento do agente pode
   * devolver `adiarAte`: o processor reagenda o MESMO job para a abertura
   * (nenhum run é aberto agora, então a idempotência por mensagem continua
   * valendo quando ele rodar de novo).
   */
  async responderOuAdiar(job: AgenteJob): Promise<ResultadoResposta> {
    const { tenantId, messageId } = job;
    const pre = await this.prisma.withTenant(tenantId, async (tx) => {
      const alvo = await tx.message.findUnique({ where: { id: messageId }, select: { autorTipo: true, conversationId: true } });
      if (!alvo || alvo.autorTipo !== 'contato') return null;
      const conv = await tx.conversation.findUnique({ where: { id: alvo.conversationId }, select: { id: true, atendimento: true, agentId: true } });
      if (!conv || conv.atendimento !== 'ia' || !conv.agentId) return null;
      const agente = await tx.agent.findUnique({ where: { id: conv.agentId } });
      if (!agente || agente.status !== 'ativo') return null;
      const efetivo = await this.versoes.efetivo(tx, agente);
      return { conv, agenteId: agente.id, horario: efetivo.config.horario };
    });
    if (pre?.horario?.ativo) {
      const agora = new Date();
      const estado = avaliarHorario(pre.horario, agora);
      if (!estado.aberto) {
        const modo = pre.horario.foraDoHorario;
        if (modo !== 'transferir_para_equipe' && estado.proximaAbertura) {
          if (modo === 'avisar_e_responder_na_abertura') {
            // Um aviso por período fechado: a chave de idempotência é a abertura.
            await this.mensagens
              .send(tenantId, pre.conv.id, mensagemForaDoHorario(pre.horario, estado.proximaAbertura, agora), `agent-fora:${pre.conv.id}:${estado.proximaAbertura.toISOString()}`, undefined, { tipo: 'ia', agentId: pre.agenteId })
              // Mesma chave com texto diferente (ex.: "amanhã" virou "hoje" depois da
              // meia-noite) = aviso deste período JÁ saiu: 409 é o esperado, não falha.
              .catch((e: Error) => { if (!(e instanceof ConflictException)) this.log.warn(`aviso de fora do horário não enviado: ${e.message}`); });
          }
          // Pequena folga após a abertura para juntar a rajada da madrugada.
          return { desfecho: 'adiado', adiarAte: new Date(estado.proximaAbertura.getTime() + ATRASO_RESPOSTA_MS) };
        }
        return { desfecho: await this.foraDoHorarioParaEquipe(tenantId, messageId, pre.conv.id, pre.agenteId) };
      }
    }
    return { desfecho: await this.responderAgora(job) };
  }

  private async foraDoHorarioParaEquipe(tenantId: string, messageId: string, conversationId: string, agentId: string): Promise<DesfechoRun> {
    const runId = await this.abrirRun(tenantId, conversationId, messageId, agentId);
    if (!runId) return 'duplicado';
    return this.paraHumano(tenantId, runId, conversationId, agentId, 'fora do horário de atendimento do agente', Date.now());
  }

  private async responderAgora(job: AgenteJob): Promise<DesfechoRun> {
    const { tenantId, messageId } = job;
    const base = await this.prisma.withTenant(tenantId, async (tx) => {
      const alvo = await tx.message.findUnique({ where: { id: messageId }, select: { id: true, autorTipo: true, conversationId: true, createdAt: true } });
      if (!alvo || alvo.autorTipo !== 'contato') return null;
      const conv = await tx.conversation.findUnique({ where: { id: alvo.conversationId }, select: { id: true, atendimento: true, agentId: true, contactId: true } });
      return conv ? { alvo, conv } : null;
    });
    if (!base) return 'nada';
    const { alvo, conv } = base;

    // O contato falou: o que estava para sair deixa de valer (reavaliação pela nova mensagem).
    await this.interromper(tenantId, conv.id, conv.contactId);

    // Conversa com humano: o agente não fala.
    if (conv.atendimento !== 'ia') return 'nada';

    const runId = await this.abrirRun(tenantId, conv.id, messageId, conv.agentId);
    if (!runId) return 'duplicado';
    const t0 = Date.now();

    try {
      const hoje = new Date();
      hoje.setUTCHours(0, 0, 0, 0);
      const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
        const agente = conv.agentId ? await tx.agent.findUnique({ where: { id: conv.agentId } }) : null;
        return {
          agente,
          efetivo: agente ? await this.versoes.efetivo(tx, agente) : null,
          maisNova: await tx.message.findFirst({ where: { conversationId: conv.id, autorTipo: 'contato', createdAt: { gt: alvo.createdAt } }, select: { id: true } }),
          contato: conv.contactId ? await tx.contact.findUnique({ where: { id: conv.contactId }, select: { nome: true, optedOutAt: true } }) : null,
          respostasIa: await tx.agentRun.count({ where: { conversationId: conv.id, status: 'respondido' } }),
          tenant: await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true, subespecialidade: true } }),
          historico: await tx.message.findMany({ where: { conversationId: conv.id, createdAt: { lte: alvo.createdAt } }, orderBy: { createdAt: 'desc' }, take: 80, select: { autorTipo: true, corpo: true } }),
          intencoes: await tx.agentIntentCategory.findMany({ where: { ativo: true }, select: { chave: true, nome: true, descricao: true, exemplos: true } }),
          runsAnteriores: await tx.agentRun.findMany({ where: { conversationId: conv.id, id: { not: runId } }, orderBy: { createdAt: 'desc' }, take: 50, select: { trace: true, custoUsd: true } }),
          custoHoje: conv.agentId ? await tx.agentRun.aggregate({ where: { agentId: conv.agentId, createdAt: { gte: hoje } }, _sum: { custoUsd: true } }) : null,
        };
      });

      // Rajada: a mensagem MAIS NOVA do contato responde, com o contexto todo.
      if (ctx.maisNova) return this.fechar(tenantId, runId, 'ignorado', 'há mensagem mais recente do contato na fila', t0);
      const { agente, efetivo } = ctx;
      if (!agente || !efetivo || agente.status !== 'ativo') return this.paraHumano(tenantId, runId, conv.id, conv.agentId, 'agente indisponível (pausado ou arquivado)', t0);
      if (ctx.contato?.optedOutAt) return this.fechar(tenantId, runId, 'ignorado', 'contato optou por não receber mensagens', t0);
      if (ctx.respostasIa >= efetivo.maxRespostasConversa) {
        return this.paraHumano(tenantId, runId, conv.id, agente.id, `limite de ${efetivo.maxRespostasConversa} respostas da IA nesta conversa`, t0);
      }
      const inte = efetivo.config.inteligencia;
      const custoConversa = ctx.runsAnteriores.reduce((t, r) => t + Number(r.custoUsd), 0);
      if (inte.orcamentoUsdConversa > 0 && custoConversa >= inte.orcamentoUsdConversa) {
        return this.paraHumano(tenantId, runId, conv.id, agente.id, `orçamento de IA da conversa esgotado (US$ ${custoConversa.toFixed(2)})`, t0);
      }
      const custoDia = Number(ctx.custoHoje?._sum.custoUsd ?? 0);
      if (inte.orcamentoUsdDiario > 0 && custoDia >= inte.orcamentoUsdDiario) {
        return this.paraHumano(tenantId, runId, conv.id, agente.id, `orçamento diário de IA do agente esgotado (US$ ${custoDia.toFixed(2)})`, t0);
      }

      const [perfil, memoria, documentIds] = await Promise.all([
        this.perfis.carregar(tenantId, conv.contactId),
        this.memoria.contexto(tenantId, conv.id, conv.contactId, efetivo.config.memoria),
        this.conhecimento.documentosDoAgente(tenantId, agente.id, efetivo.config.conhecimento),
      ]);
      const regrasJaDisparadas = new Set<string>();
      for (const r of ctx.runsAnteriores) {
        const disparadas = ((r.trace as { regras?: { disparadas?: { regraId: string }[] } })?.regras?.disparadas) ?? [];
        disparadas.forEach((d) => regrasJaDisparadas.add(d.regraId));
      }
      const historico = ctx.historico.reverse();
      const ultima = historico[historico.length - 1]?.corpo ?? '';

      const r = await this.core.processar({
        tenantId,
        agente: efetivo,
        empresa: ctx.tenant?.nome ?? 'a empresa',
        nicho: ctx.tenant?.nicho ?? null,
        subespecialidade: ctx.tenant?.subespecialidade ?? null,
        conversationId: conv.id,
        contactId: conv.contactId,
        contatoNome: ctx.contato?.nome ?? null,
        messageId,
        runId,
        historico,
        perfil,
        memoria,
        intencoesExtras: ctx.intencoes,
        regrasJaDisparadas,
        documentIds,
        simulacao: false,
        origem: 'atendimento',
      });

      if (r.custoUsd > 0) await this.core.registrarUso(tenantId, agente.nome, { modelo: r.modelo, entrada: r.tokensEntrada, saida: r.tokensSaida, custoUsd: r.custoUsd, latenciaMs: Date.now() - t0 });
      await this.aprendizado.registrar(tenantId, eventosDoTurno(agente.id, r, { conversationId: conv.id, runId, limiarConfianca: efetivo.config.inteligencia.limiarConfianca, mensagem: ultima }));

      // O contato escreveu de novo enquanto o modelo pensava: esta resposta já
      // nasceu velha. O job da mensagem nova responde com o contexto inteiro.
      const chegouOutra = await this.prisma.withTenant(tenantId, (tx) =>
        tx.message.findFirst({ where: { conversationId: conv.id, autorTipo: 'contato', createdAt: { gt: alvo.createdAt } }, select: { id: true } }),
      );
      if (chegouOutra && r.decisao === 'responder') return this.fechar(tenantId, runId, 'ignorado', 'contato mandou nova mensagem durante a geração (respondida pela mais recente)', t0, r, efetivo.versionId);

      let sequencia: { sequenciaId: string; blocos: number } | null = null;
      if (r.fragmentacao.blocos.length && (r.decisao === 'responder' || r.decisao === 'transferir')) {
        // A "digitação" do 1º bloco já aconteceu enquanto o modelo gerava: só
        // espera o que faltar. Os demais mantêm o ritmo de digitação.
        const decorrido = Date.now() - t0;
        const blocos = r.fragmentacao.blocos.map((b, i) => (i === 0 ? { ...b, atrasoMs: Math.max(0, b.atrasoMs - decorrido) } : b));
        sequencia = await this.entregas.enfileirar({ tenantId, agentId: agente.id, conversationId: conv.id, runId, blocos, chaveBase: `agent:${messageId}` });
      }

      let desfecho: DesfechoRun;
      let motivo = r.motivo;
      if (r.decisao === 'silenciar') desfecho = 'ignorado';
      else if (r.decisao === 'responder') desfecho = 'respondido';
      else {
        motivo = r.decisao === 'recusa' ? 'o modelo recusou responder esta mensagem' : r.motivo ?? 'o agente não conseguiu formular uma resposta';
        await this.atendimento.transferirParaHumano(tenantId, conv.id, motivo, { tipo: 'ia', agentId: agente.id });
        desfecho = 'transferido';
      }
      await this.fechar(tenantId, runId, desfecho as Exclude<DesfechoRun, 'nada' | 'duplicado'>, motivo, t0, r, efetivo.versionId, sequencia);

      if (desfecho === 'respondido') {
        await this.followups
          .agendarAposResposta(tenantId, { agentId: agente.id, contactId: conv.contactId, conversationId: conv.id, intencao: r.analise.intencao, objecoes: r.analise.objecoes, temperatura: r.analise.temperatura, perfil, forcarEstrategia: r.regras.iniciarFollowup })
          .catch((e: Error) => this.log.warn(`follow-up não agendado: ${e.message}`));
        if (r.analise.proximoPasso) await this.memoria.registrarOperacional(tenantId, conv.contactId, agente.id, conv.id, 'proximo_passo', r.analise.proximoPasso, efetivo.config.memoria.retencaoDias);
        // Resumo progressivo DEPOIS da resposta enfileirada: não atrasa o atendimento.
        void this.memoria
          .atualizarResumo(tenantId, { conversationId: conv.id, contactId: conv.contactId, agentId: agente.id, modelo: efetivo.config.inteligencia.modeloAnalise ?? efetivo.modelo }, efetivo.config.memoria, efetivo.config.inteligencia.janelaHistorico)
          .catch((e: Error) => this.log.warn(`resumo de memória falhou: ${e.message}`));
      }
      return desfecho;
    } catch (e) {
      const erro = (e as Error).message.slice(0, 200);
      this.log.error(`agente falhou (tenant ${tenantId}, mensagem ${messageId}): ${erro}`);
      // Lead nunca fica sem dono: falhou a IA, a conversa vai para a equipe.
      await this.atendimento
        .transferirParaHumano(tenantId, conv.id, `falha ao gerar resposta da IA: ${erro}`, { tipo: 'ia', agentId: conv.agentId })
        .catch((err) => this.log.error(`falha ao transferir após erro: ${(err as Error).message}`));
      if (conv.agentId) await this.aprendizado.registrar(tenantId, [{ agentId: conv.agentId, tipo: 'transferencia', chave: 'erro interno', conversationId: conv.id, runId, detalhe: { erro } }]);
      return this.fechar(tenantId, runId, 'erro', erro, t0);
    }
  }

  /** Nova mensagem do contato: cancela blocos pendentes e follow-ups que param quando ele responde. */
  private async interromper(tenantId: string, conversationId: string, contactId: string | null) {
    try {
      const blocos = await this.entregas.cancelarPendentes(tenantId, conversationId, 'contato enviou nova mensagem: resposta reavaliada');
      let fus = 0;
      if (contactId) {
        fus = await this.prisma.withTenant(tenantId, async (tx) => {
          const regras = await tx.agentFollowupRule.findMany({ where: { pararSe: { has: 'respondeu' } }, select: { id: true } });
          const r = await tx.agentFollowup.updateMany({ where: { contactId, status: 'agendado', ruleId: { in: regras.map((x) => x.id) } }, data: { status: 'cancelado', motivo: 'contato respondeu', updatedAt: new Date() } });
          return r.count;
        });
      }
      if (blocos || fus) this.log.log(`conversa ${conversationId}: ${blocos} bloco(s) e ${fus} follow-up(s) interrompidos pela nova mensagem`);
    } catch (e) {
      this.log.warn(`falha ao interromper pendências: ${(e as Error).message}`);
    }
  }

  /** Cria o run; `null` se esta mensagem já foi processada (idempotência). */
  private async abrirRun(tenantId: string, conversationId: string, messageId: string, agentId: string | null): Promise<string | null> {
    try {
      const r = await this.prisma.withTenant(tenantId, (tx) =>
        tx.agentRun.create({ data: { tenantId, conversationId, messageId, agentId, status: 'processando' }, select: { id: true } }),
      );
      return r.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  private async paraHumano(tenantId: string, runId: string, conversationId: string, agentId: string | null, motivo: string, t0: number): Promise<DesfechoRun> {
    await this.atendimento.transferirParaHumano(tenantId, conversationId, motivo, { tipo: 'ia', agentId });
    if (agentId) await this.aprendizado.registrar(tenantId, [{ agentId, tipo: 'transferencia', chave: motivo.replace(/[\d.$,]+/g, '').trim().slice(0, 60), conversationId, runId, detalhe: { motivo } }]);
    return this.fechar(tenantId, runId, 'transferido', motivo, t0);
  }

  private async fechar(
    tenantId: string,
    runId: string,
    status: Exclude<DesfechoRun, 'nada' | 'duplicado'>,
    motivo: string | null,
    t0: number,
    r?: ResultadoCore,
    versionId: string | null = null,
    sequencia: { sequenciaId: string; blocos: number } | null = null,
  ): Promise<DesfechoRun> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentRun.update({
        where: { id: runId },
        data: {
          status,
          motivo: motivo?.slice(0, 500) ?? null,
          tools: (r?.ferramentas ?? []) as Prisma.InputJsonValue,
          fontes: (r?.conhecimento.fontes ?? []) as unknown as Prisma.InputJsonValue,
          modelo: r?.modelo ?? null,
          tokensEntrada: r?.tokensEntrada ?? 0,
          tokensSaida: r?.tokensSaida ?? 0,
          custoUsd: new Prisma.Decimal((r?.custoUsd ?? 0).toFixed(6)),
          latenciaMs: Date.now() - t0,
          finishedAt: new Date(),
          versionId,
          intencao: r?.analise.intencao ?? null,
          sentimento: r?.analise.sentimento ?? null,
          urgencia: r?.analise.urgencia ?? null,
          confianca: r ? new Prisma.Decimal(r.analise.confiancaIntencao.toFixed(3)) : null,
          blocos: r?.fragmentacao.blocos.length ?? 0,
          trace: (r ? traceDoResultado(r, { sequenciaId: sequencia?.sequenciaId ?? null }) : {}) as Prisma.InputJsonValue,
        },
      }),
    );
    return status;
  }
}
