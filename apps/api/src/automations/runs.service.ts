import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { ExecutorService, type Contexto } from './executor.service';
import { grafoSchema, noRamificado, type EventoEspera, type FiltroEvento, type Grafo, type No } from './catalogo';
import { eventoBate } from './eventos-espera';

/** Janela de envio do workflow (migration 011). */
interface JanelaConfig {
  janelaAtiva: boolean;
  janelaDias: number[];
  janelaInicio: number;
  janelaFim: number;
  timezone: string;
  /** "Notificar equipe" também espera a janela (db/050). Padrão: não. */
  janelaIncluiEquipe?: boolean;
}

/**
 * Nós sujeitos à janela de envio (Q1.2): os que falam com o CONTATO sempre;
 * "Notificar equipe" só quando o fluxo marca `janelaIncluiEquipe` — aviso
 * interno costuma ser urgente ("lead pagou o sinal"), então o padrão é não segurar.
 */
const NOS_DA_JANELA = new Set(['acao.enviar_sms', 'acao.enviar_email', 'acao.pedir_avaliacao']);

/** Nós com saídas nomeadas (condição, split, esperar resposta, esperar até no modo
 *  evento): sem ramo escolhido, NÃO podem cair na saída de outro ramo — ver
 *  `noRamificado` no catálogo. */

export const FILA_PASSOS = 'automation-steps';

export interface PassoJob {
  tenantId: string;
  runId: string;
  noId: string;
  generation?: number;
}

/** Guarda contra `ir_para` em círculo: 200 nós é muito mais que qualquer fluxo real. */
const MAX_PASSOS = 200;

/**
 * `jobId` do BullMQ não pode conter ':' — ele já usa esse separador nas chaves
 * do Redis, e o `add()` lança em vez de avisar. Como partes do id vêm do usuário
 * (id do nó), tudo que não for [a-zA-Z0-9_-] vira '_'.
 */
export function idDeJob(...partes: string[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex');
}

/**
 * Orquestra a execução (PRD §7.2): um job = **um nó**. O estado vive no banco,
 * não na memória do worker — por isso uma espera de 7 dias sobrevive a deploy,
 * restart e queda do processo.
 */
@Injectable()
export class RunsService {
  private readonly log = new Logger('Automations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: ExecutorService,
    private readonly eventos: DomainEventsService,
    @InjectQueue(FILA_PASSOS) private readonly fila: Queue<PassoJob>,
  ) {}

  /** Abre a execução a partir de um gatilho e enfileira o primeiro nó. */
  async iniciar(input: {
    tenantId: string;
    workflowId: string;
    versionId: string;
    gatilho: string;
    grafo: Grafo;
    noInicial: string;
    contexto: Contexto;
    dedupeKey?: string;
    teste?: boolean;
    /** Teste do rascunho (Q1.3): o grafo fica congelado no run, imune a edições. */
    grafoTeste?: Grafo;
  }): Promise<{ runId: string } | { duplicado: true }> {
    const primeiro = this.proximoDe(input.grafo, input.noInicial);
    if (!primeiro) {
      this.log.debug(`workflow ${input.workflowId}: gatilho sem nó seguinte — nada a fazer`);
      return { duplicado: true };
    }

    // Reentrada (migration 011): o erro mais caro de automação é o mesmo contato
    // recebendo a mesma sequência várias vezes. `uma_vez` é o padrão.
    const contactId = input.contexto.contato?.id;
    if (contactId && !input.teste) {
      const bloqueado = await this.reentradaBloqueada(input.tenantId, input.workflowId, contactId);
      if (bloqueado) {
        this.log.debug(`contato ${contactId} não reentra no workflow ${input.workflowId} (regra: ${bloqueado})`);
        return { duplicado: true };
      }
    }

    try {
      const run = await this.prisma.withTenant(input.tenantId, (tx) =>
        tx.workflowRun.create({
          data: {
            tenantId: input.tenantId,
            workflowId: input.workflowId,
            versionId: input.versionId,
            gatilho: input.gatilho,
            status: 'rodando',
            noAtual: primeiro,
            estado: input.contexto as unknown as Prisma.InputJsonValue,
            contexto: input.contexto as unknown as Prisma.InputJsonValue,
            contactId: input.contexto.contato?.id ?? null,
            dealId: input.contexto.negocio?.id ?? null,
            dedupeKey: input.dedupeKey ?? null,
            teste: input.teste ?? false,
            grafoTeste: input.teste && input.grafoTeste ? (input.grafoTeste as unknown as Prisma.InputJsonValue) : undefined,
          },
          select: { id: true },
        }),
      );
      await this.enfileirar(input.tenantId, run.id, primeiro, 0);
      return { runId: run.id };
    } catch (e) {
      // unique(workflow_id, dedupe_key): o mesmo evento não abre 2 execuções
      if ((e as { code?: string }).code === 'P2002') {
        this.log.debug(`gatilho duplicado ignorado (workflow ${input.workflowId})`);
        return { duplicado: true };
      }
      throw e;
    }
  }

  /**
   * Executa UM nó e agenda o próximo. Idempotência: o passo só roda se o run
   * ainda estiver apontando para ele — job reentregue depois de um crash não
   * reexecuta o que já passou.
   */
  async processarPasso(job: PassoJob, tentativa: number): Promise<{ adiantadoMs?: number }> {
    const owner = randomUUID();
    const claimed = await this.prisma.withTenant(job.tenantId, tx => tx.workflowRun.updateMany({
      where: { id: job.runId, tenantId: job.tenantId, noAtual: job.noId,
        generation: job.generation, status: { in: ['rodando', 'esperando'] },
        scheduledAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      }, data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 120_000), attempts: { increment: 1 } },
    }));
    if (!claimed.count) return this.jobAdiantado(job);
    try { await this.executarPasso(job, tentativa); return {}; }
    finally {
      await this.prisma.withTenant(job.tenantId, tx => tx.workflowRun.updateMany({
        where: { id: job.runId, tenantId: job.tenantId, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null },
      }));
    }
  }

  /**
   * Claim recusado. Se foi só porque o job chegou ANTES do `scheduledAt` (relógio
   * do Redis × do Postgres, reconcile que reenfileirou, delay encolhido), o run
   * continua apontando para este nó/geração: devolve o tempo que falta para o
   * processor reagendar o MESMO job. Antes o job era descartado em silêncio e
   * o run ficava parado até o reconcile notar (só em fluxo ativo — teste de
   * rascunho ficava parado para sempre). Job velho (outra geração, outro nó,
   * run encerrado) continua sendo descartado.
   */
  private async jobAdiantado(job: PassoJob): Promise<{ adiantadoMs?: number }> {
    const run = await this.prisma.withTenant(job.tenantId, (tx) =>
      tx.workflowRun.findUnique({ where: { id: job.runId, tenantId: job.tenantId }, select: { noAtual: true, generation: true, status: true, scheduledAt: true } }),
    );
    if (!run || run.noAtual !== job.noId || !['rodando', 'esperando'].includes(run.status)) return {};
    if (job.generation !== undefined && run.generation !== job.generation) return {};
    const falta = run.scheduledAt.getTime() - Date.now();
    return falta > 0 ? { adiantadoMs: falta } : {};
  }

  private async executarPasso(job: PassoJob, tentativa: number): Promise<void> {
    const { tenantId, runId, noId } = job;
    const run = await this.carregar(tenantId, runId);
    if (!run) return;

    if (run.status === 'concluido' || run.status === 'cancelado' || run.status === 'falhou') return;
    if (run.workflow?.status === 'pausado' && !run.teste) return;
    if (run.noAtual !== noId) {
      this.log.debug(`passo ${noId} ignorado: run ${runId} já está em ${run.noAtual}`);
      return;
    }
    if (run.passos >= MAX_PASSOS) {
      await this.falhar(tenantId, runId, noId, 'controle', `limite de ${MAX_PASSOS} passos atingido (loop?)`, tentativa);
      return;
    }

    const grafo = grafoSchema.parse(run.grafo);
    const no = grafo.nos.find((n) => n.id === noId);
    if (!no) {
      await this.falhar(tenantId, runId, noId, 'desconhecido', `nó ${noId} não existe nesta versão do workflow`, tentativa);
      return;
    }

    const estado = run.estado as Contexto;
    // Base da trava "contato respondeu → não envia": o início do run, ou o
    // momento em que o fluxo consumiu a última resposta (Esperar resposta).
    const ctx: Contexto = { ...estado, executionKey: `${runId}:${run.generation}:${noId}`, runStartedAt: estado.baseResposta ?? run.startedAt.toISOString(), workflowId: run.workflowId, runId, fuso: run.workflow?.timezone || undefined, ...(run.teste ? { teste: true } : {}) };
    const t0 = Date.now();
    try {
      // Janela de envio: nó que fala com o contato fora do horário é adiado, não
      // executado. Sem isto, uma espera de 2 dias entrega "Oi!" às 3 da manhã.
      // Teste não espera janela de envio: só fala com o número de teste.
      const atraso = ctx.teste ? 0 : this.esperarJanela(no, run.workflow);
      if (atraso > 0) {
        this.log.debug(`nó ${noId} fora da janela de envio: adiado ${Math.round(atraso / 60000)}min`);
        await this.avancar(tenantId, runId, noId, ctx, 'esperando', atraso);
        await this.enfileirar(tenantId, runId, noId, atraso);
        return;
      }

      const r = await this.executor.executar(tenantId, no, ctx, grafo);
      const novoCtx: Contexto = { ...ctx, ...(r.contexto ?? {}) };

      await this.logar(tenantId, runId, no, 'ok', tentativa, r.saida ?? {}, null, Date.now() - t0);
      this.eventos.publicar(tenantId, 'automation.run', { runId, workflowId: run.workflowId, nodeId: noId, status: 'ok' }, { automacao: false });

      // Encadeamento: o contato entra em outro fluxo e este segue seu caminho.
      if (no.tipo === 'acao.chamar_workflow' && !ctx.teste) {
        await this.encadear(tenantId, (no.config as { workflowId: string }).workflowId, novoCtx, run.workflowId);
      }

      if (r.encerrar) return this.concluir(tenantId, runId, novoCtx);

      // Espera: o run fica `esperando` no banco e o job volta com delay —
      // nenhum timer na memória do processo. `mesmoNo` reagenda o próprio nó
      // (é como o "esperar resposta" acorda no timeout).
      if (r.esperarMs && r.esperarMs > 0) {
        const alvo = r.mesmoNo ? noId : r.irPara ?? this.proximoDe(grafo, noId, r.ramo, noRamificado(no));
        if (!alvo) return this.concluir(tenantId, runId, novoCtx);
        await this.avancar(tenantId, runId, alvo, novoCtx, 'esperando', r.esperarMs);
        await this.enfileirar(tenantId, runId, alvo, r.esperarMs);
        return;
      }

      const proximo = r.irPara ?? this.proximoDe(grafo, noId, r.ramo, noRamificado(no));
      if (!proximo) return this.concluir(tenantId, runId, novoCtx);

      await this.avancar(tenantId, runId, proximo, novoCtx, 'rodando');
      await this.enfileirar(tenantId, runId, proximo, 0);
    } catch (e) {
      const erro = (e as Error).message;
      await this.logar(tenantId, runId, no, 'falhou', tentativa, {}, erro, Date.now() - t0);
      // `aoFalhar: 'seguir'` = fallback do PRD §7.2: o fluxo continua sem o nó.
      if (no.aoFalhar === 'seguir') {
        const proximo = this.proximoDe(grafo, noId, undefined, noRamificado(no));
        if (!proximo) return this.concluir(tenantId, runId, ctx);
        await this.avancar(tenantId, runId, proximo, ctx, 'rodando');
        await this.enfileirar(tenantId, runId, proximo, 0);
        return;
      }
      throw e; // deixa o BullMQ tentar de novo; esgotado, cai no DLQ
    }
  }

  /** Retry esgotado: registra no DLQ e marca a execução como falha. */
  async paraDlq(job: PassoJob, erro: string, tentativas: number): Promise<void> {
    const { tenantId, runId, noId } = job;
    const run = await this.carregar(tenantId, runId);
    const tipo = run ? (grafoSchema.parse(run.grafo).nos.find((n) => n.id === noId)?.tipo ?? 'desconhecido') : 'desconhecido';
    await this.falhar(tenantId, runId, noId, tipo, erro, tentativas);
  }

  private async falhar(tenantId: string, runId: string, noId: string, tipo: string, erro: string, tentativas: number): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.workflowDlq.create({ data: { tenantId, runId, noId, tipo, erro: erro.slice(0, 2000), tentativas, payload: { noId } } });
      await tx.workflowRun.update({ where: { id: runId }, data: { status: 'falhou', erro: erro.slice(0, 2000), finishedAt: new Date() } });
    });
    this.log.error(`run ${runId} falhou no nó ${noId}: ${erro}`);
    this.eventos.publicar(tenantId, 'automation.run', { runId, workflowId: '', nodeId: noId, status: 'falhou' }, { automacao: false });
  }

  private async concluir(tenantId: string, runId: string, ctx: Contexto): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.update({
        where: { id: runId },
        data: { status: 'concluido', noAtual: null, estado: ctx as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
      }),
    );
    this.eventos.publicar(tenantId, 'automation.run', { runId, workflowId: '', nodeId: '', status: 'concluido' }, { automacao: false });
  }

  private async avancar(tenantId: string, runId: string, proximo: string, ctx: Contexto, status: string, delay = 0): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.update({
        where: { id: runId },
        data: { noAtual: proximo, estado: ctx as unknown as Prisma.InputJsonValue, status, passos: { increment: 1 }, generation: { increment: 1 }, scheduledAt: new Date(Date.now() + delay), attempts: 0 },
      }),
    );
  }

  private async enfileirar(tenantId: string, runId: string, noId: string, delay: number, sufixo = ''): Promise<void> {
    const run = await this.prisma.withTenant(tenantId, tx => tx.workflowRun.findUnique({ where: { id: runId, tenantId } }));
    if (!run || !run.noAtual) return;
    // BUG-021: o atraso pedido (`delay`) é o piso. Recalcular só por
    // `scheduledAt - agora` encolhia o delay nos ms gastos entre `avancar` e
    // aqui — não determinístico (teste instável) e o job podia chegar ANTES do
    // `scheduledAt`, sendo recusado pelo claim. `scheduledAt` ainda manda quando
    // está mais longe (ex.: run reagendado por outra via).
    await this.fila.add('passo', { tenantId, runId, noId: run.noAtual, generation: run.generation }, {
      delay: Math.max(0, delay, run.scheduledAt.getTime() - Date.now()),
      jobId: idDeJob(runId, String(run.generation)), attempts: 4,
      backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 1000, removeOnFail: false,
    });
  }

  private async logar(tenantId: string, runId: string, no: No, status: string, tentativa: number, saida: Record<string, unknown>, erro: string | null, ms: number): Promise<void> {
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.workflowRunStep.create({
          data: {
            tenantId, runId, noId: no.id, tipo: no.tipo, status, tentativa,
            entrada: (no.config ?? {}) as Prisma.InputJsonValue,
            saida: saida as Prisma.InputJsonValue,
            erro: erro?.slice(0, 2000) ?? null,
            duracaoMs: ms,
          },
        }),
      );
    } catch (e) {
      // log é observabilidade: falhar aqui não pode derrubar a execução
      this.log.warn(`falha ao logar passo ${no.id}: ${(e as Error).message}`);
    }
  }

  private async carregar(tenantId: string, runId: string) {
    const run = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.findUnique({
        where: { id: runId },
        include: {
          version: { select: { grafo: true } },
          workflow: { select: { status: true, janelaAtiva: true, janelaDias: true, janelaInicio: true, janelaFim: true, timezone: true, janelaIncluiEquipe: true } },
        },
      }),
    );
    if (!run) return null;
    // Run de teste do rascunho (Q1.3) executa o grafo congelado nele, não a versão.
    return { ...run, grafo: run.grafoTeste ?? run.version.grafo };
  }

  /** Devolve a regra que bloqueou, ou null se pode entrar. */
  private async reentradaBloqueada(tenantId: string, workflowId: string, contactId: string): Promise<string | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wf = await tx.workflow.findUnique({ where: { id: workflowId }, select: { reentrada: true } });
      const regra = wf?.reentrada ?? 'uma_vez';
      if (regra === 'sempre') return null;

      const where = regra === 'apos_terminar'
        // só bloqueia se ainda estiver correndo (deixa reentrar depois que acabou)
        ? { workflowId, contactId, status: { in: ['rodando', 'esperando'] } }
        // uma_vez: qualquer execução anterior já basta
        : { workflowId, contactId };
      const existe = await tx.workflowRun.findFirst({ where, select: { id: true } });
      return existe ? regra : null;
    });
  }

  /**
   * Contato respondeu: acorda os runs que esperavam por ele (e, se o workflow
   * tem `pararNoReply`, encerra os demais). Chamado pelo worker de gatilhos.
   */
  async avisarResposta(tenantId: string, contactId: string, mensagem?: { id: string; texto: string }): Promise<void> {
    const esperando = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.findMany({
        where: { contactId, status: { in: ['rodando', 'esperando'] } },
        select: { id: true, noAtual: true, estado: true, workflow: { select: { id: true, pararNoReply: true } } },
      }),
    );

    for (const run of esperando) {
      const ctx = run.estado as Contexto;

      // `!ctx.respondeu`: se uma resposta já acordou o run mas o passo ainda não
      // executou, uma SEGUNDA mensagem rápida do contato não pode sobrescrever
      // `mensagem` — a condição seguinte ("resposta contém Google") precisa ler
      // a PRIMEIRA resposta. A segunda mensagem não se perde: o próximo "Esperar
      // resposta" a reconhece pela checagem de resposta antecipada (lastInboundAt).
      if (ctx.aguardandoResposta && ctx.aguardandoResposta === run.noAtual && !ctx.respondeu) {
        // marca a resposta e acorda o nó AGORA — o job do timeout que existir
        // será ignorado depois, porque o run já terá avançado (noAtual muda)
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.workflowRun.update({
            where: { id: run.id },
            // `mensagem`: o texto que o contato respondeu, para a condição seguinte.
            // `baseResposta`: a resposta foi CONSUMIDA pelo fluxo; a trava "contato
            // respondeu, cancela o envio" passa a contar só respostas posteriores
            // (senão as boas-vindas pós-resposta seriam canceladas).
            data: {
              estado: { ...ctx, respondeu: true, ...(mensagem ? { mensagem: { ...mensagem, de: 'contato' } } : {}), baseResposta: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
              status: 'rodando', generation: { increment: 1 }, scheduledAt: new Date(),
            },
          }),
        );
        await this.enfileirar(tenantId, run.id, run.noAtual!, 0, 'reply');
        continue;
      }

      if (run.workflow.pararNoReply) {
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.workflowRun.update({ where: { id: run.id }, data: { status: 'cancelado', erro: 'contato respondeu — fluxo interrompido', finishedAt: new Date() } }),
        );
        this.log.debug(`run ${run.id} cancelado: contato respondeu e o workflow para no reply`);
      }
    }
  }

  /**
   * Evento de domínio do contato (Q3.1): dispara METAS e acorda "Esperar até"
   * no modo evento. Chamado pelo worker de gatilhos ANTES de abrir fluxos novos
   * (e depois de `avisarResposta`, que trata o "Esperar resposta").
   *
   * Meta vence espera: se o run tem uma meta ALCANÇÁVEL a partir do nó atual
   * (caminho pelas conexões ou "Ir para") cujo evento casou, o run pula para
   * ela — a geração sobe, então o job da espera pendente vira job velho e é
   * descartado pelo claim. Meta que já ficou para trás não puxa o run de volta.
   */
  async avisarEvento(tenantId: string, contactId: string, evento: EventoEspera, dados: Record<string, unknown>): Promise<{ metas: number; acordados: number }> {
    const runs = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.findMany({
        where: { contactId, status: { in: ['rodando', 'esperando'] } },
        select: { id: true, noAtual: true, estado: true, grafoTeste: true, version: { select: { grafo: true } } },
        take: 200,
      }),
    );
    let metas = 0;
    let acordados = 0;
    for (const run of runs) {
      if (!run.noAtual) continue;
      const g = grafoSchema.safeParse(run.grafoTeste ?? run.version.grafo);
      if (!g.success) continue;
      const grafo = g.data;
      const ctx = run.estado as Contexto;
      const evDados = { ...dados, tipo: evento, em: new Date().toISOString() };

      const meta = this.metaAlcancavel(grafo, run.noAtual, evento, dados, ctx.metasAtingidas ?? []);
      if (meta) {
        const novo: Contexto = {
          ...ctx, metasAtingidas: [...(ctx.metasAtingidas ?? []), meta], evento: evDados,
          aguardandoResposta: null, respondeu: false, aguardandoEvento: null, eventoOcorreu: false, aguardandoMeta: null,
        };
        const ok = await this.saltar(tenantId, run.id, run.noAtual, meta, novo);
        if (ok) { metas++; await this.enfileirar(tenantId, run.id, meta, 0); }
        continue;
      }

      if (ctx.aguardandoEvento && ctx.aguardandoEvento === run.noAtual && !ctx.eventoOcorreu) {
        const no = grafo.nos.find((n) => n.id === run.noAtual);
        if (no?.tipo !== 'controle.esperar_ate' || !eventoBate(no.config as Partial<FiltroEvento>, evento, dados)) continue;
        const ok = await this.saltar(tenantId, run.id, run.noAtual, run.noAtual, { ...ctx, eventoOcorreu: true, evento: evDados });
        if (ok) { acordados++; await this.enfileirar(tenantId, run.id, run.noAtual, 0); }
      }
    }
    return { metas, acordados };
  }

  /**
   * Move o run para `alvo` AGORA, só se ele ainda estiver em `de` (outro
   * evento/worker pode ter mexido no meio): updateMany condicional = sem corrida.
   */
  private async saltar(tenantId: string, runId: string, de: string, alvo: string, estado: Contexto): Promise<boolean> {
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.updateMany({
        where: { id: runId, noAtual: de, status: { in: ['rodando', 'esperando'] } },
        data: { noAtual: alvo, estado: estado as unknown as Prisma.InputJsonValue, status: 'rodando', generation: { increment: 1 }, scheduledAt: new Date(), attempts: 0 },
      }),
    );
    return r.count > 0;
  }

  /** Primeira meta (mais próxima, em largura) alcançável a partir de `de` cujo evento casou. */
  private metaAlcancavel(grafo: Grafo, de: string, evento: EventoEspera, dados: Record<string, unknown>, atingidas: string[]): string | null {
    const visitados = new Set<string>([de]);
    const fila = [de];
    while (fila.length) {
      const atual = fila.shift()!;
      const no = grafo.nos.find((n) => n.id === atual);
      if (no?.tipo === 'controle.meta' && !atingidas.includes(no.id) && eventoBate(no.config as Partial<FiltroEvento>, evento, dados)) return no.id;
      const vizinhos = grafo.arestas.filter((a) => a.de === atual).map((a) => a.para);
      if (no?.tipo === 'controle.ir_para') vizinhos.push(String((no.config as { alvoNoId?: string }).alvoNoId ?? ''));
      for (const v of vizinhos) {
        if (v && !visitados.has(v)) { visitados.add(v); fila.push(v); }
      }
    }
    return null;
  }

  /**
   * Quanto falta (ms) até a janela de envio abrir. 0 = pode mandar agora.
   * Só vale para nós que FALAM com alguém (SMS e e-mail ao contato; "Notificar
   * equipe" se o fluxo marcar) — mover etapa ou criar tarefa às 3h da manhã não
   * incomoda ninguém.
   */
  private esperarJanela(no: No, wf: JanelaConfig): number {
    if (!wf?.janelaAtiva) return 0;
    const sujeito = NOS_DA_JANELA.has(no.tipo) || (no.tipo === 'acao.notificar_equipe' && wf.janelaIncluiEquipe === true);
    if (!sujeito) return 0;

    // "agora" no fuso do tenant: sem isto, a janela seria do servidor (UTC)
    const agora = new Date();
    const local = new Date(agora.toLocaleString('en-US', { timeZone: wf.timezone || 'America/Sao_Paulo' }));
    const dia = local.getDay();
    const hora = local.getHours();

    const diasOk = wf.janelaDias?.length ? wf.janelaDias : [1, 2, 3, 4, 5];
    const dentroDoDia = diasOk.includes(dia);
    if (dentroDoDia && hora >= wf.janelaInicio && hora < wf.janelaFim) return 0;

    // procura a próxima abertura, hora a hora (no máximo 8 dias à frente)
    const proximo = new Date(local);
    for (let i = 0; i < 24 * 8; i++) {
      proximo.setHours(proximo.getHours() + 1, 0, 0, 0);
      if (diasOk.includes(proximo.getDay()) && proximo.getHours() >= wf.janelaInicio && proximo.getHours() < wf.janelaFim) {
        return Math.max(proximo.getTime() - local.getTime(), 60_000);
      }
    }
    return 60 * 60_000; // janela impossível: tenta de novo em 1h em vez de travar
  }

  /** Encadeia: abre um run do outro workflow com o mesmo contato. */
  private async encadear(tenantId: string, alvoId: string, ctx: Contexto, origemId: string): Promise<void> {
    if (alvoId === origemId) {
      this.log.warn(`workflow ${origemId} tentou acionar a si mesmo — ignorado`);
      return;
    }
    const alvo = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflow.findUnique({ where: { id: alvoId }, include: { versaoAtiva: { select: { id: true, grafo: true } } } }),
    );
    if (!alvo?.versaoAtiva || alvo.status !== 'ativo') {
      this.log.warn(`workflow encadeado ${alvoId} não está ativo/publicado — ignorado`);
      return;
    }
    const grafo = grafoSchema.parse(alvo.versaoAtiva.grafo);
    const gatilho = grafo.nos.find((n) => n.tipo.startsWith('gatilho.'));
    if (!gatilho) return;

    await this.iniciar({
      tenantId, workflowId: alvo.id, versionId: alvo.versaoAtiva.id,
      gatilho: 'encadeado', grafo, noInicial: gatilho.id, contexto: ctx,
      dedupeKey: `encadeado:${origemId}:${ctx.contato?.id ?? ''}:${Date.now()}`,
    });
  }

  /**
   * Aresta que sai de `noId` (opcionalmente pelo ramo do If/Else).
   * `ramificado`: nó com saídas nomeadas (condição, split, esperar resposta).
   * Sem ramo escolhido (ex.: nenhum ramo da condição casou) ele só segue uma
   * saída SEM rótulo; antes caía em `saidas[0]` — o caminho de outro ramo.
   */
  private proximoDe(grafo: Grafo, noId: string, ramo?: string, ramificado = false): string | null {
    const saidas = grafo.arestas.filter((a) => a.de === noId);
    if (ramo) return saidas.find((a) => a.ramo === ramo)?.para ?? null;
    // sem ramo: pega a aresta sem rótulo (saída padrão)
    const padrao = saidas.find((a) => !a.ramo);
    if (ramificado) return padrao?.para ?? null;
    return (padrao ?? saidas[0])?.para ?? null;
  }

  // ------------------------------------------------------------- consultas

  async listarRuns(tenantId: string, workflowId: string, limite = 30) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.findMany({
        where: { workflowId },
        orderBy: { startedAt: 'desc' },
        take: Math.min(limite, 100),
        select: { id: true, gatilho: true, status: true, noAtual: true, erro: true, startedAt: true, finishedAt: true, teste: true, contactId: true },
      }),
    );
  }

  async detalheRun(tenantId: string, runId: string) {
    const run = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.findUnique({
        where: { id: runId },
        include: { steps: { orderBy: { createdAt: 'asc' } } },
      }),
    );
    if (!run) throw new NotFoundException('execução inexistente');
    return {
      id: run.id, status: run.status, gatilho: run.gatilho, noAtual: run.noAtual, erro: run.erro,
      startedAt: run.startedAt, finishedAt: run.finishedAt, teste: run.teste, contexto: run.contexto,
      passos: run.steps.map((s) => ({ id: s.id, noId: s.noId, tipo: s.tipo, status: s.status, tentativa: s.tentativa, saida: s.saida, erro: s.erro, duracaoMs: s.duracaoMs, createdAt: s.createdAt })),
    };
  }

  async listarDlq(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowDlq.findMany({ where: { resolvidoEm: null }, orderBy: { createdAt: 'desc' }, take: 100 }),
    );
  }

  /** Reprocessa um item do DLQ do ponto onde parou — sem refazer o já feito. */
  async reprocessar(tenantId: string, dlqId: string) {
    const item = await this.prisma.withTenant(tenantId, (tx) => tx.workflowDlq.findUnique({ where: { id: dlqId } }));
    if (!item) throw new NotFoundException('item de DLQ inexistente');
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.workflowRun.update({ where: { id: item.runId }, data: { status: 'rodando', erro: null, finishedAt: null, noAtual: item.noId, generation: { increment: 1 }, scheduledAt: new Date(), attempts: 0 } });
      await tx.workflowDlq.update({ where: { id: dlqId }, data: { resolvidoEm: new Date() } });
    });
    await this.enfileirar(tenantId, item.runId, item.noId, 0);
    return { ok: true, runId: item.runId };
  }

  async cancelar(tenantId: string, runId: string) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflowRun.updateMany({ where: { id: runId, status: { in: ['rodando', 'esperando'] } }, data: { status: 'cancelado', finishedAt: new Date() } }),
    );
    return { ok: true };
  }
}
