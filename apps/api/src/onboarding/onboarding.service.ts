import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgencyService } from '../agency/agency.service';
import { GennaService } from '../integrations/genna/genna.service';
import {
  AtualizarOnboardingSchema,
  CHAVE_AGENTE_TESTADO,
  CHAVE_APROVACAO_FINAL,
  CHAVE_GENNA_ANALISE,
  CHAVES_SECOES,
  ConhecimentoSchema,
  DecisaoAprovacaoSchema,
  GerarTarefasSchema,
  IniciarSchema,
  RelatorioGennaSchema,
  ReuniaoSchema,
  SECOES_CONHECIMENTO,
  SolicitarAprovacaoSchema,
  SpecAgenteSchema,
  TesteAgenteSchema,
  VerificarSchema,
  aprovacaoDosTestes,
  escopoKeyDoTexto,
  escopoKeyParaTexto,
  lerFiltrosVisao,
  normalizarEscopo,
  pautaParaEscopo,
  tarefasParaEscopo,
  validar,
  verificacoesParaEscopo,
  type Escopo,
  type ResultadoTesteAgente,
} from './onboarding.catalogo';

/** Quem está agindo: membro da agência + o que ele enxerga. Resolvido SEMPRE pela identidade da sessão. */
interface Ator {
  agencyId: string;
  memberId: string;
  role: string;
  /** Subcontas visíveis (id → {nome, tenantId}). */
  clientes: Map<string, { nome: string; tenantId: string }>;
}

type Tx = Prisma.TransactionClient;

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * Onboarding KROMA (db/078): condução rastreável da entrada de um cliente da
 * agência — coleta, imersão, implantação (tarefas reais no Daily, db/074),
 * análise via Genna (ADR-0053, só leitura), especificação do agente de IA e
 * homologação com aprovação humana. Regras de acesso (mesmas do Daily):
 * - a agência vem da identidade (nunca de id vindo do cliente);
 * - member restrito só vê onboarding de subconta visível;
 * - visualizador só lê;
 * - finalizar e decidir aprovações: só owner/admin.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agency: AgencyService,
    private readonly genna: GennaService,
  ) {}

  // ───────────────────────────── acesso ─────────────────────────────

  private async ator(identityId: string): Promise<Ator> {
    const e = await this.agency.escopo(identityId);
    if (!e) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    return {
      agencyId: e.membro.agencyId,
      memberId: e.membro.id,
      role: e.membro.role,
      clientes: new Map(e.clientes.map((c) => [c.id, { nome: c.displayName, tenantId: c.tenantId }])),
    };
  }

  private exigeEscrita(a: Ator): void {
    if (a.role === 'viewer') throw new ForbiddenException('visualizador não pode alterar o onboarding');
  }

  private exigeAdmin(a: Ator): void {
    if (!['owner', 'admin'].includes(a.role)) throw new ForbiddenException('apenas o dono ou um admin da agência pode fazer isso');
  }

  /** Onboarding da agência E de subconta visível para o membro. 404 esconde a existência. */
  private async visivel(a: Ator, id: string) {
    const ob = await this.prisma.agencyOnboarding.findFirst({
      where: { id, agencyId: a.agencyId, clientAccountId: { in: [...a.clientes.keys()] } },
    });
    if (!ob) throw new NotFoundException('onboarding não encontrado');
    return ob;
  }

  private exigeAberto(ob: { status: string }): void {
    if (ob.status === 'pronto') throw new ConflictException({ message: 'onboarding já finalizado', code: 'onboarding_finalizado' });
  }

  private async evento(onboardingId: string, tipo: string, dados: Record<string, unknown> = {}, ator = 'usuario', tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).agencyOnboardingEvent.create({ data: { onboardingId, tipo, dados: json(dados), ator } });
  }

  /** Auditoria manual (o controller é @SkipAudit): mesma prática do AgencyService — nunca derruba a operação. */
  private async auditar(a: Ator, identityId: string, acao: string, entidadeId: string): Promise<void> {
    await this.prisma
      .withTenant(a.agencyId, (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${a.agencyId}::uuid, 'humano', ${identityId}, ${acao}, 'agency_onboarding', ${entidadeId}::uuid)`,
      )
      .catch(() => undefined);
  }

  private async validarResponsavel(a: Ator, memberId: string | null | undefined): Promise<void> {
    if (!memberId) return;
    const n = await this.prisma.agencyMember.count({ where: { id: memberId, agencyId: a.agencyId } });
    if (n !== 1) throw new BadRequestException({ message: 'responsável não é da equipe', code: 'onboarding_invalido' });
  }

  /** Semeia as verificações do escopo que ainda não existem (nunca apaga as já respondidas). */
  private async semearVerificacoes(tx: Tx, onboardingId: string, escopo: Escopo): Promise<void> {
    const existentes = new Set(
      (await tx.agencyOnboardingVerification.findMany({ where: { onboardingId }, select: { chave: true } })).map((v) => v.chave),
    );
    const novas = verificacoesParaEscopo(escopo).filter((v) => !existentes.has(v.chave));
    if (novas.length) {
      await tx.agencyOnboardingVerification.createMany({
        data: novas.map((v) => ({
          onboardingId,
          chave: v.chave,
          rotulo: v.rotulo,
          secao: v.secao,
          obrigatorio: v.obrigatorio,
          escopoKey: escopoKeyParaTexto(v.escopoKey),
        })),
      });
    }
  }

  private async secoesPendentes(tx: Tx, onboardingId: string): Promise<string[]> {
    const linhas = await tx.agencyOnboardingKnowledge.findMany({ where: { onboardingId, pendente: true }, select: { secao: true } });
    return linhas.map((l) => l.secao);
  }

  // ───────────────────────────── ciclo de vida ─────────────────────────────

  async iniciar(identityId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const input = validar(IniciarSchema, bruto);
    const cliente = a.clientes.get(input.clientAccountId);
    if (!cliente) throw new NotFoundException('subconta não encontrada ou sem acesso');
    await this.validarResponsavel(a, input.responsavelId);
    const escopo = normalizarEscopo(input.escopo ?? {});

    const existente = await this.prisma.agencyOnboarding.findFirst({
      where: { clientAccountId: input.clientAccountId, status: { not: 'pronto' } },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({ message: 'esta subconta já tem um onboarding em andamento', code: 'onboarding_duplicado', onboardingId: existente.id });
    }

    try {
      const criado = await this.prisma.$transaction(async (tx) => {
        const ob = await tx.agencyOnboarding.create({
          data: { agencyId: a.agencyId, clientAccountId: input.clientAccountId, responsavelId: input.responsavelId ?? null, escopo: json(escopo) },
        });
        await this.semearVerificacoes(tx, ob.id, escopo);
        await tx.agencyOnboardingKnowledge.createMany({
          data: CHAVES_SECOES.map((secao) => ({ onboardingId: ob.id, secao })),
        });
        await this.evento(ob.id, 'onboarding.iniciado', { escopo, responsavelId: input.responsavelId ?? null }, 'usuario', tx);
        return ob;
      });
      await this.auditar(a, identityId, 'onboarding.iniciar', criado.id);
      return criado;
    } catch (e) {
      // Corrida entre dois cliques: a unique parcial do banco é a rede final.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ message: 'esta subconta já tem um onboarding em andamento', code: 'onboarding_duplicado' });
      }
      throw e;
    }
  }

  async visaoExecutiva(identityId: string, query: Record<string, unknown>) {
    const a = await this.ator(identityId);
    const f = lerFiltrosVisao(query);
    const base = await this.prisma.agencyOnboarding.findMany({
      where: {
        agencyId: a.agencyId,
        clientAccountId: { in: [...a.clientes.keys()] },
        ...(f.etapa ? { etapaAtual: f.etapa } : {}),
        ...(f.responsavel ? { responsavelId: f.responsavel } : {}),
        ...(f.cliente ? { clientAccountId: f.cliente } : {}),
        ...(f.de || f.ate ? { startedAt: { ...(f.de ? { gte: f.de } : {}), ...(f.ate ? { lte: f.ate } : {}) } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    const contadores: Record<string, number> = {};
    for (const ob of base) contadores[ob.status] = (contadores[ob.status] ?? 0) + 1;

    const ids = base.map((o) => o.id);
    const [verificacoes, links] = await Promise.all([
      this.prisma.agencyOnboardingVerification.findMany({ where: { onboardingId: { in: ids } }, select: { onboardingId: true, status: true, obrigatorio: true } }),
      this.prisma.agencyOnboardingTask.findMany({ where: { onboardingId: { in: ids } }, select: { onboardingId: true, taskId: true } }),
    ]);
    const tasks = await this.prisma.agencyTask.findMany({
      where: { id: { in: links.map((l) => l.taskId) }, arquivadaEm: null },
      select: { id: true, status: true, prioridade: true, prazoEm: true },
    });
    const taskPorId = new Map(tasks.map((t) => [t.id, t]));
    const agora = new Date();

    type Linha = (typeof base)[number];
    const resumo = (ob: Linha) => {
      const ver = verificacoes.filter((v) => v.onboardingId === ob.id);
      const tarefas = links.filter((l) => l.onboardingId === ob.id).map((l) => taskPorId.get(l.taskId)).filter((t): t is NonNullable<typeof t> => !!t);
      return {
        id: ob.id,
        status: ob.status,
        etapaAtual: ob.etapaAtual,
        escopo: normalizarEscopo(ob.escopo),
        cliente: { id: ob.clientAccountId, nome: a.clientes.get(ob.clientAccountId)?.nome ?? 'Cliente' },
        responsavelId: ob.responsavelId,
        startedAt: ob.startedAt,
        completedAt: ob.completedAt,
        verificacoes: {
          total: ver.length,
          verificadas: ver.filter((v) => v.status === 'verificado').length,
          pendentes: ver.filter((v) => v.status === 'pendente').length,
          bloqueadas: ver.filter((v) => v.status === 'bloqueado').length,
        },
        tarefas: {
          total: tarefas.length,
          atrasadas: tarefas.filter((t) => t.prazoEm && t.prazoEm < agora && t.status !== 'concluida').length,
          prioridades: [...new Set(tarefas.map((t) => t.prioridade))],
        },
      };
    };

    let lista = base;
    if (f.status.length) lista = lista.filter((o) => f.status.includes(o.status));
    if (f.prioridade.length) {
      lista = lista.filter((o) => {
        const r = resumo(o);
        return r.tarefas.prioridades.some((p) => f.prioridade.includes(p));
      });
    }
    return { contadores, itens: lista.map(resumo) };
  }

  async detalhe(identityId: string, id: string) {
    const a = await this.ator(identityId);
    const ob = await this.visivel(a, id);
    const [knowledge, meetings, reports, agent, links, verifications, approvals, events] = await Promise.all([
      this.prisma.agencyOnboardingKnowledge.findMany({ where: { onboardingId: id }, orderBy: { secao: 'asc' } }),
      this.prisma.agencyOnboardingMeeting.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.agencyOnboardingReport.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.agencyOnboardingAgent.findUnique({ where: { onboardingId: id } }),
      this.prisma.agencyOnboardingTask.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.agencyOnboardingVerification.findMany({ where: { onboardingId: id }, orderBy: { chave: 'asc' } }),
      this.prisma.agencyOnboardingApproval.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.agencyOnboardingEvent.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const tasks = await this.prisma.agencyTask.findMany({
      where: { id: { in: links.map((l) => l.taskId) } },
      select: { id: true, numero: true, titulo: true, tipo: true, status: true, prioridade: true, prazoEm: true, responsavelId: true, arquivadaEm: true },
    });
    const taskPorId = new Map(tasks.map((t) => [t.id, t]));
    return {
      ...ob,
      escopo: normalizarEscopo(ob.escopo),
      cliente: { id: ob.clientAccountId, nome: a.clientes.get(ob.clientAccountId)?.nome ?? 'Cliente' },
      knowledge,
      meetings,
      reports,
      agent,
      tarefas: links.map((l) => ({ ...l, task: taskPorId.get(l.taskId) ? { ...taskPorId.get(l.taskId)!, numero: Number(taskPorId.get(l.taskId)!.numero) } : null })),
      verifications,
      approvals,
      events,
    };
  }

  /** Edição de status/etapa/responsável. Mudança de escopo por member vira aprovação pendente; owner/admin aplica direto. */
  async atualizar(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(AtualizarOnboardingSchema, bruto);
    if (input.status === 'pronto') {
      throw new BadRequestException({ message: 'para concluir use a finalização (ela revalida a homologação)', code: 'onboarding_invalido' });
    }
    await this.validarResponsavel(a, input.responsavelId);

    let aprovacaoPendente: { id: string } | null = null;
    if (input.escopo) {
      const novo = normalizarEscopo({ ...normalizarEscopo(ob.escopo), ...input.escopo });
      if (['owner', 'admin'].includes(a.role)) {
        await this.prisma.$transaction(async (tx) => {
          await tx.agencyOnboarding.update({ where: { id }, data: { escopo: json(novo) } });
          await this.semearVerificacoes(tx, id, novo);
          await this.evento(id, 'onboarding.escopo_alterado', { escopo: novo }, 'usuario', tx);
        });
      } else {
        aprovacaoPendente = await this.prisma.agencyOnboardingApproval.create({
          data: { onboardingId: id, acao: 'mudar_escopo', payload: json({ escopo: input.escopo, justificativa: input.justificativa ?? null }), solicitadoPor: a.memberId },
          select: { id: true },
        });
        await this.evento(id, 'onboarding.aprovacao_solicitada', { acao: 'mudar_escopo', aprovacaoId: aprovacaoPendente.id });
      }
    }

    const { escopo: _escopo, justificativa: _justificativa, ...diretos } = input;
    if (Object.keys(diretos).length) {
      await this.prisma.agencyOnboarding.update({
        where: { id },
        data: {
          ...(diretos.status !== undefined ? { status: diretos.status } : {}),
          ...(diretos.etapaAtual !== undefined ? { etapaAtual: diretos.etapaAtual } : {}),
          ...(diretos.responsavelId !== undefined ? { responsavelId: diretos.responsavelId } : {}),
        },
      });
      await this.evento(id, 'onboarding.atualizado', { campos: Object.keys(diretos) });
    }
    await this.auditar(a, identityId, 'onboarding.atualizar', id);
    return { ok: true, aprovacaoPendente };
  }

  // ───────────────────────────── conhecimento ─────────────────────────────

  async atualizarConhecimento(identityId: string, id: string, secao: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    if (!(CHAVES_SECOES as readonly string[]).includes(secao)) {
      throw new BadRequestException({ message: 'seção de conhecimento inválida', code: 'onboarding_invalido' });
    }
    const input = validar(ConhecimentoSchema, bruto);
    const pendente = input.pendente ?? true;

    const linha = await this.prisma.$transaction(async (tx) => {
      const atual = await tx.agencyOnboardingKnowledge.findUnique({ where: { onboardingId_secao: { onboardingId: id, secao } } });
      if (atual) {
        // Snapshot do conteúdo anterior antes de sobrescrever.
        await tx.agencyOnboardingKnowledgeHist.create({ data: { knowledgeId: atual.id, dados: json(atual.dados ?? {}), alteradoPor: a.memberId } });
        return tx.agencyOnboardingKnowledge.update({
          where: { id: atual.id },
          data: {
            dados: json(input.dados),
            pendente,
            atualizadoPor: a.memberId,
            confirmadoPor: pendente ? null : a.memberId,
            confirmadoEm: pendente ? null : new Date(),
          },
        });
      }
      return tx.agencyOnboardingKnowledge.create({
        data: {
          onboardingId: id,
          secao,
          dados: json(input.dados),
          pendente,
          atualizadoPor: a.memberId,
          confirmadoPor: pendente ? null : a.memberId,
          confirmadoEm: pendente ? null : new Date(),
        },
      });
    });
    await this.evento(id, 'onboarding.conhecimento_atualizado', { secao, pendente });
    return linha;
  }

  async historicoConhecimento(identityId: string, id: string, secao: string) {
    const a = await this.ator(identityId);
    await this.visivel(a, id);
    const atual = await this.prisma.agencyOnboardingKnowledge.findUnique({ where: { onboardingId_secao: { onboardingId: id, secao } } });
    if (!atual) return [];
    return this.prisma.agencyOnboardingKnowledgeHist.findMany({ where: { knowledgeId: atual.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  // ───────────────────────────── reuniões ─────────────────────────────

  async registrarReuniao(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(ReuniaoSchema, bruto);
    const pauta = input.pauta ?? pautaParaEscopo(normalizarEscopo(ob.escopo)).map((t) => t.titulo);
    const reuniao = await this.prisma.$transaction(async (tx) => {
      const r = await tx.agencyOnboardingMeeting.create({
        data: {
          onboardingId: id,
          tipo: input.tipo ?? 'imersao',
          data: input.data ?? null,
          participantes: json(input.participantes ?? []),
          pauta: json(pauta),
          resumo: input.resumo ?? null,
          decisoes: json(input.decisoes ?? []),
          pendencias: json(input.pendencias ?? []),
          criadoPor: a.memberId,
        },
      });
      const pendentes = await this.secoesPendentes(tx, id);
      await this.evento(id, 'onboarding.reuniao_registrada', { meetingId: r.id, tipo: r.tipo, secoesPendentes: pendentes }, 'usuario', tx);
      return r;
    });
    return reuniao;
  }

  async atualizarReuniao(identityId: string, id: string, meetingId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const reuniao = await this.prisma.agencyOnboardingMeeting.findFirst({ where: { id: meetingId, onboardingId: id } });
    if (!reuniao) throw new NotFoundException('reunião não encontrada');
    const input = validar(ReuniaoSchema, bruto);
    if (!Object.keys(input).length) throw new BadRequestException({ message: 'nada para alterar', code: 'onboarding_invalido' });
    const atualizada = await this.prisma.$transaction(async (tx) => {
      const r = await tx.agencyOnboardingMeeting.update({
        where: { id: meetingId },
        data: {
          ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
          ...(input.data !== undefined ? { data: input.data } : {}),
          ...(input.participantes !== undefined ? { participantes: json(input.participantes) } : {}),
          ...(input.pauta !== undefined ? { pauta: json(input.pauta) } : {}),
          ...(input.resumo !== undefined ? { resumo: input.resumo } : {}),
          ...(input.decisoes !== undefined ? { decisoes: json(input.decisoes) } : {}),
          ...(input.pendencias !== undefined ? { pendencias: json(input.pendencias) } : {}),
        },
      });
      const pendentes = await this.secoesPendentes(tx, id);
      await this.evento(id, 'onboarding.reuniao_atualizada', { meetingId, secoesPendentes: pendentes }, 'usuario', tx);
      return r;
    });
    return atualizada;
  }

  // ───────────────────────────── tarefas (Daily, db/074) ─────────────────────────────

  /**
   * Cria as tarefas do template no Daily da agência, vinculadas ao onboarding.
   * Dedupe por (onboarding, título): rodar de novo não duplica. Sem mapa de
   * atribuições, as tarefas nascem sem responsável (a UI atribui depois).
   */
  async gerarTarefas(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(GerarTarefasSchema, bruto ?? {});
    const atribuicoes = input.atribuicoes ?? {};
    const membros = Object.values(atribuicoes);
    if (membros.length) {
      const n = await this.prisma.agencyMember.count({ where: { agencyId: a.agencyId, id: { in: membros } } });
      if (n !== new Set(membros).size) throw new BadRequestException({ message: 'responsável não é da equipe', code: 'onboarding_invalido' });
    }

    const templates = tarefasParaEscopo(normalizarEscopo(ob.escopo));
    const links = await this.prisma.agencyOnboardingTask.findMany({ where: { onboardingId: id }, select: { taskId: true } });
    const existentes = new Set(
      (
        await this.prisma.agencyTask.findMany({
          where: { id: { in: links.map((l) => l.taskId) }, arquivadaEm: null },
          select: { titulo: true },
        })
      ).map((t) => t.titulo),
    );
    const novas = templates.filter((t) => !existentes.has(t.titulo));
    let posicao =
      ((
        await this.prisma.agencyTask.findFirst({
          where: { agencyId: a.agencyId, status: 'a_fazer', arquivadaEm: null },
          orderBy: { posicao: 'desc' },
          select: { posicao: true },
        })
      )?.posicao ?? 0) + 1024;

    const criadas: { id: string; titulo: string; papel: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const t of novas) {
        const task = await tx.agencyTask.create({
          data: {
            agencyId: a.agencyId,
            clientAccountId: ob.clientAccountId,
            criadorId: a.memberId,
            responsavelId: atribuicoes[t.papel] ?? null,
            titulo: t.titulo,
            tipo: t.tipo,
            status: 'a_fazer',
            prioridade: 'normal',
            posicao,
          },
          select: { id: true },
        });
        posicao += 1024;
        await tx.agencyOnboardingTask.create({ data: { onboardingId: id, taskId: task.id, secao: t.secao, criterioAceite: t.criterioAceite } });
        criadas.push({ id: task.id, titulo: t.titulo, papel: t.papel });
      }
      if (criadas.length) await this.evento(id, 'onboarding.tarefas_geradas', { criadas: criadas.length, ignoradas: templates.length - criadas.length }, 'usuario', tx);
    });
    await this.auditar(a, identityId, 'onboarding.tarefas_gerar', id);
    return { criadas, ignoradas: templates.length - criadas.length, total: templates.length };
  }

  // ───────────────────────────── relatórios (Genna, ADR-0053) ─────────────────────────────

  /**
   * Roda uma ferramenta de LEITURA do Genna na subconta do cliente e salva o
   * relatório. Sem conexão/configuração, o erro do GennaService (501/409)
   * propaga como está — nada aqui simula resultado. O retorno do Genna é dado
   * NÃO confiável: vai para `bruto`/`metricas` só para leitura humana, nunca
   * é executado como instrução.
   */
  async salvarRelatorioGenna(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(RelatorioGennaSchema, bruto);
    const cliente = a.clientes.get(ob.clientAccountId)!;

    const r = await this.genna.consultar(cliente.tenantId, identityId, input.ferramenta, input.argumentos ?? {});
    const metricas = r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados) ? r.dados : {};
    const relatorio = await this.prisma.$transaction(async (tx) => {
      const rep = await tx.agencyOnboardingReport.create({
        data: {
          onboardingId: id,
          fonte: 'genna',
          perfilAnalisado: input.perfil,
          ferramenta: input.ferramenta,
          metricas: json(metricas),
          // Imagens (data URLs) ficam de fora do bruto: grandes demais para o histórico.
          bruto: json({ ok: r.ok, texto: r.texto, dados: r.dados ?? null, links: r.links }),
          criadoPor: a.memberId,
        },
      });
      // Análise feita = etapa concluída; a VERIFICAÇÃO (verificado) continua humana.
      await tx.agencyOnboardingVerification.updateMany({
        where: { onboardingId: id, chave: CHAVE_GENNA_ANALISE, status: { in: ['pendente', 'em_andamento'] } },
        data: { status: 'concluido' },
      });
      await this.evento(id, 'onboarding.relatorio_genna', { reportId: rep.id, ferramenta: input.ferramenta, perfil: input.perfil, ok: r.ok }, 'usuario', tx);
      return rep;
    });
    await this.auditar(a, identityId, 'onboarding.relatorio_genna', id);
    return relatorio;
  }

  async listarRelatorios(identityId: string, id: string) {
    const a = await this.ator(identityId);
    await this.visivel(a, id);
    return this.prisma.agencyOnboardingReport.findMany({ where: { onboardingId: id }, orderBy: { createdAt: 'desc' } });
  }

  // ───────────────────────────── agente de IA ─────────────────────────────

  async salvarSpecAgente(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(SpecAgenteSchema, bruto);
    const agent = await this.prisma.agencyOnboardingAgent.upsert({
      where: { onboardingId: id },
      create: { onboardingId: id, nome: input.nome ?? null, especificacao: json(input.especificacao), systemPrompt: input.systemPrompt ?? null, atualizadoPor: a.memberId },
      update: {
        ...(input.nome !== undefined ? { nome: input.nome } : {}),
        especificacao: json(input.especificacao),
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        atualizadoPor: a.memberId,
      },
    });
    await this.evento(id, 'onboarding.agente_spec', { agentId: agent.id });
    return agent;
  }

  /**
   * Registra o resultado de um cenário de teste. `approval_status` é DERIVADO
   * dos testes: só vira `aprovado` com os 11 cenários base aprovados, e a
   * verificação `agente_ia_testado` segue esse status.
   */
  async registrarResultadoTesteAgente(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(TesteAgenteSchema, bruto);
    const agent = await this.prisma.agencyOnboardingAgent.findUnique({ where: { onboardingId: id } });
    if (!agent) throw new NotFoundException('salve a especificação do agente antes de registrar testes');

    const testes = (Array.isArray(agent.testes) ? (agent.testes as unknown as ResultadoTesteAgente[]) : []).filter(
      (t) => t && typeof t.cenario === 'string' && t.cenario !== input.cenario,
    );
    testes.push({ cenario: input.cenario, status: input.status, ...(input.observacao ? { observacao: input.observacao } : {}) });
    const aprovacao = aprovacaoDosTestes(testes);

    const atualizado = await this.prisma.$transaction(async (tx) => {
      const ag = await tx.agencyOnboardingAgent.update({
        where: { id: agent.id },
        // 'publicado' só sai daqui por fluxo futuro de publicação; um teste novo sempre rebaixa para o derivado.
        data: { testes: json(testes), approvalStatus: aprovacao, atualizadoPor: a.memberId },
      });
      const aprovados = testes.filter((t) => t.status === 'aprovado').length;
      await tx.agencyOnboardingVerification.updateMany({
        where: { onboardingId: id, chave: CHAVE_AGENTE_TESTADO },
        data:
          aprovacao === 'aprovado'
            ? {
                status: 'verificado',
                verificadoPor: a.memberId,
                verificadoEm: new Date(),
                evidencias: json([{ tipo: 'testes_agente', referencia: `${aprovados} cenários aprovados`, observacao: 'derivado dos testes do agente' }]),
              }
            : aprovacao === 'em_testes'
              ? { status: 'em_andamento', verificadoPor: null, verificadoEm: null }
              : { status: 'pendente', verificadoPor: null, verificadoEm: null },
      });
      await this.evento(id, 'onboarding.agente_teste', { cenario: input.cenario, status: input.status, aprovacao }, 'usuario', tx);
      return ag;
    });
    return atualizado;
  }

  // ───────────────────────────── homologação ─────────────────────────────

  /**
   * Transição de uma verificação. `verificado` exige evidências OU a
   * confirmação explícita `semEvidencia: true` (que vira evidência registrada
   * com o motivo) — nada de marcar como verificado sem rastro.
   */
  async verificar(identityId: string, id: string, chave: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(VerificarSchema, bruto);
    const ver = await this.prisma.agencyOnboardingVerification.findFirst({ where: { onboardingId: id, chave } });
    if (!ver) throw new NotFoundException('verificação não encontrada');
    if (chave === CHAVE_APROVACAO_FINAL) {
      throw new BadRequestException({ message: 'a aprovação final é concedida pela ação de finalizar', code: 'onboarding_invalido' });
    }

    let evidencias = (input.evidencias ?? []) as { tipo?: string; referencia?: string; observacao?: string }[];
    if (input.status === 'verificado') {
      if (!evidencias.length && input.semEvidencia === true) {
        evidencias = [{ tipo: 'sem_evidencia', referencia: input.motivo ?? 'confirmado sem evidência anexada' }];
      }
      if (!evidencias.length) {
        throw new BadRequestException({ message: 'marcar como verificado exige evidências ou a confirmação explícita sem evidência', code: 'onboarding_sem_evidencia' });
      }
    }

    const verificado = input.status === 'verificado';
    const atualizada = await this.prisma.agencyOnboardingVerification.update({
      where: { id: ver.id },
      data: {
        status: input.status,
        ...(input.evidencias !== undefined || evidencias.length ? { evidencias: json(evidencias) } : {}),
        verificadoPor: verificado ? a.memberId : null,
        verificadoEm: verificado ? new Date() : null,
      },
    });
    await this.evento(id, 'onboarding.verificacao', { chave, status: input.status });
    return atualizada;
  }

  async solicitarAprovacao(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const ob = await this.visivel(a, id);
    this.exigeAberto(ob);
    const input = validar(SolicitarAprovacaoSchema, bruto);
    const aprovacao = await this.prisma.agencyOnboardingApproval.create({
      data: { onboardingId: id, acao: input.acao, payload: json(input.payload ?? {}), solicitadoPor: a.memberId },
    });
    await this.evento(id, 'onboarding.aprovacao_solicitada', { acao: input.acao, aprovacaoId: aprovacao.id });
    return aprovacao;
  }

  async decidirAprovacao(identityId: string, approvalId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    this.exigeAdmin(a);
    const input = validar(DecisaoAprovacaoSchema, bruto);
    const aprovacao = await this.prisma.agencyOnboardingApproval.findUnique({ where: { id: approvalId } });
    if (!aprovacao) throw new NotFoundException('aprovação não encontrada');
    const ob = await this.visivel(a, aprovacao.onboardingId);
    if (aprovacao.status !== 'pendente') {
      throw new ConflictException({ message: 'esta aprovação já foi decidida', code: 'aprovacao_decidida' });
    }

    const decidida = await this.prisma.$transaction(async (tx) => {
      const ap = await tx.agencyOnboardingApproval.update({
        where: { id: approvalId },
        data: {
          status: input.aprovar ? 'aprovada' : 'recusada',
          decididoPor: a.memberId,
          justificativa: input.justificativa ?? null,
          decididoEm: new Date(),
        },
      });
      if (input.aprovar && aprovacao.acao === 'mudar_escopo') {
        const payload = aprovacao.payload as { escopo?: unknown };
        const novo = normalizarEscopo({ ...normalizarEscopo(ob.escopo), ...(payload.escopo as Record<string, unknown> | undefined) });
        await tx.agencyOnboarding.update({ where: { id: ob.id }, data: { escopo: json(novo) } });
        await this.semearVerificacoes(tx, ob.id, novo);
        await this.evento(ob.id, 'onboarding.escopo_alterado', { escopo: novo, viaAprovacao: approvalId }, 'usuario', tx);
      }
      await this.evento(ob.id, 'onboarding.aprovacao_decidida', { aprovacaoId: approvalId, acao: aprovacao.acao, aprovada: input.aprovar }, 'usuario', tx);
      return ap;
    });
    await this.auditar(a, identityId, 'onboarding.aprovacao_decidir', approvalId);
    return decidida;
  }

  /**
   * Finalização: trava a linha (FOR UPDATE), revalida TODA verificação
   * obrigatória aplicável ao escopo e só então marca `pronto`. Idempotente:
   * já finalizado devolve o estado atual sem regravar. Nunca confia no frontend.
   */
  async finalizar(identityId: string, id: string) {
    const a = await this.ator(identityId);
    this.exigeAdmin(a);
    // Visibilidade primeiro (member restrito não finaliza o que não vê; 404 esconde).
    await this.visivel(a, id);

    const resultado = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string; escopo: unknown; completed_at: Date | null }[]>`
        SELECT id, status, escopo, completed_at FROM agency_onboardings WHERE id = ${id}::uuid FOR UPDATE`;
      const ob = rows[0];
      if (!ob) throw new NotFoundException('onboarding não encontrado');
      if (ob.status === 'pronto') {
        return { id: ob.id, status: 'pronto' as const, completedAt: ob.completed_at, jaFinalizado: true };
      }

      const escopo = normalizarEscopo(ob.escopo);
      const verificacoes = await tx.agencyOnboardingVerification.findMany({ where: { onboardingId: id } });
      const pendencias = verificacoes
        .filter((v) => {
          if (!v.obrigatorio || v.chave === CHAVE_APROVACAO_FINAL) return false;
          const chaves = escopoKeyDoTexto(v.escopoKey);
          if (chaves && !chaves.some((k) => escopo[k as keyof Escopo] === true)) return false;
          return v.status !== 'verificado';
        })
        .map((v) => ({ chave: v.chave, rotulo: v.rotulo, status: v.status }));
      if (pendencias.length) {
        throw new ConflictException({
          message: `homologação incompleta: ${pendencias.length} verificação(ões) pendente(s)`,
          code: 'onboarding_pendencias',
          pendencias,
        });
      }

      const agora = new Date();
      await tx.agencyOnboarding.update({
        where: { id },
        data: { status: 'pronto', completedAt: agora, completionLocked: false, aprovadoPor: a.memberId, aprovadoEm: agora },
      });
      // A verificação de aprovação final é concedida por ESTA ação (owner/admin).
      await tx.agencyOnboardingVerification.updateMany({
        where: { onboardingId: id, chave: CHAVE_APROVACAO_FINAL },
        data: { status: 'verificado', verificadoPor: a.memberId, verificadoEm: agora },
      });
      await this.evento(id, 'onboarding.finalizado', { pendencias: 0 }, 'usuario', tx);
      return { id, status: 'pronto' as const, completedAt: agora, jaFinalizado: false };
    });
    if (!resultado.jaFinalizado) await this.auditar(a, identityId, 'onboarding.finalizar', id);
    return resultado;
  }

  // ───────────────────────────── painel de conferência ─────────────────────────────

  /** Seções agregadas para o painel: status derivado, pendências e ids para deep-link. */
  async conferencia(identityId: string, id: string) {
    const a = await this.ator(identityId);
    const ob = await this.visivel(a, id);
    const escopo = normalizarEscopo(ob.escopo);
    const [knowledge, verifications, links] = await Promise.all([
      this.prisma.agencyOnboardingKnowledge.findMany({ where: { onboardingId: id } }),
      this.prisma.agencyOnboardingVerification.findMany({ where: { onboardingId: id }, orderBy: { chave: 'asc' } }),
      this.prisma.agencyOnboardingTask.findMany({ where: { onboardingId: id } }),
    ]);
    const tasks = await this.prisma.agencyTask.findMany({
      where: { id: { in: links.map((l) => l.taskId) } },
      select: { id: true, numero: true, titulo: true, status: true, prazoEm: true, responsavelId: true, arquivadaEm: true },
    });
    const taskPorId = new Map(tasks.map((t) => [t.id, t]));
    const agora = new Date();

    const derivar = (statuses: string[]): string => {
      if (!statuses.length) return 'pendente';
      if (statuses.every((s) => s === 'verificado')) return 'verificado';
      if (statuses.includes('bloqueado')) return 'bloqueado';
      if (statuses.some((s) => !['pendente'].includes(s))) return 'em_andamento';
      return 'pendente';
    };

    const porSecaoVer = new Map<string, typeof verifications>();
    for (const v of verifications) {
      const arr = porSecaoVer.get(v.secao) ?? [];
      arr.push(v);
      porSecaoVer.set(v.secao, arr);
    }
    const knPorSecao = new Map(knowledge.map((k) => [k.secao, k]));

    return {
      onboardingId: id,
      status: ob.status,
      responsavelId: ob.responsavelId,
      conhecimento: SECOES_CONHECIMENTO.map((s) => {
        const k = knPorSecao.get(s.chave);
        const dados = k?.dados && typeof k.dados === 'object' && !Array.isArray(k.dados) ? (k.dados as Record<string, unknown>) : {};
        const faltantes = s.camposObrigatorios.filter((c) => {
          const v = dados[c];
          return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
        });
        return {
          secao: s.chave,
          rotulo: s.rotulo,
          pendente: k?.pendente ?? true,
          confirmadoEm: k?.confirmadoEm ?? null,
          camposFaltantes: faltantes,
          knowledgeId: k?.id ?? null,
        };
      }),
      verificacoes: [...porSecaoVer.entries()].map(([secao, itens]) => ({
        secao,
        status: derivar(itens.map((v) => v.status)),
        pendencias: itens.filter((v) => v.obrigatorio && v.status !== 'verificado').length,
        itens: itens.map((v) => ({
          id: v.id,
          chave: v.chave,
          rotulo: v.rotulo,
          status: v.status,
          obrigatorio: v.obrigatorio,
          evidencias: Array.isArray(v.evidencias) ? v.evidencias.length : 0,
          taskId: v.taskId,
          verificadoPor: v.verificadoPor,
          verificadoEm: v.verificadoEm,
        })),
      })),
      tarefas: (() => {
        const porSecao = new Map<string, { secao: string; total: number; concluidas: number; atrasadas: number; itens: unknown[] }>();
        for (const l of links) {
          const t = taskPorId.get(l.taskId);
          if (!t || t.arquivadaEm) continue;
          const secao = l.secao ?? 'outras';
          if (!porSecao.has(secao)) porSecao.set(secao, { secao, total: 0, concluidas: 0, atrasadas: 0, itens: [] });
          const g = porSecao.get(secao)!;
          g.total += 1;
          if (t.status === 'concluida') g.concluidas += 1;
          const atrasada = !!t.prazoEm && t.prazoEm < agora && t.status !== 'concluida';
          if (atrasada) g.atrasadas += 1;
          g.itens.push({ taskId: t.id, numero: Number(t.numero), titulo: t.titulo, status: t.status, atrasada, responsavelId: t.responsavelId, criterioAceite: l.criterioAceite });
        }
        return [...porSecao.values()];
      })(),
      escopo,
    };
  }
}
