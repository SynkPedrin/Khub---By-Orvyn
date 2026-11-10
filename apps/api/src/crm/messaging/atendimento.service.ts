import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AtendimentoConversa } from '@khub/types';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventsService } from '../../events/domain-events.service';

type Tx = Prisma.TransactionClient;

/** Quem fez a mudança de atendimento — vai para o audit_log. */
export type AtorAtendimento = { tipo: 'humano'; identityId: string } | { tipo: 'ia'; agentId: string | null } | { tipo: 'sistema' };

/** Papéis que podem receber conversa (viewer só lê). */
const PAPEIS_ATENDENTES = ['owner', 'admin', 'manager', 'member'];

export interface EstadoAtendimento {
  id: string;
  atendimento: AtendimentoConversa;
  agentId: string | null;
  assigneeId: string | null;
  handoffMotivo: string | null;
}

/**
 * Estado de atendimento da conversa (RV-06 · ADR-0030).
 *
 * Dono ÚNICO de "quem responde agora": IA (um agente) ou humano (um
 * responsável). Inbox, runtime do agente e o envio manual passam por aqui —
 * assim a regra de transferência e a distribuição existem em um lugar só.
 *
 * Fronteira: o CRM lê a tabela `agents` só para decidir ROTEAMENTO (há agente
 * padrão ativo? o agente pedido existe e está ativo?). Configurar agente é
 * do módulo `agents`, que depende do CRM — nunca o contrário.
 */
@Injectable()
export class AtendimentoService {
  private readonly log = new Logger('Atendimento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  /** Conversa nova: nasce com a IA se houver agente padrão ativo para o canal. */
  async estadoInicial(tx: Tx, canal: string): Promise<{ atendimento: AtendimentoConversa; agentId: string | null }> {
    const padrao = await tx.agent.findFirst({
      where: { padrao: true, status: 'ativo', canais: { has: canal } },
      select: { id: true },
    });
    return padrao ? { atendimento: 'ia', agentId: padrao.id } : { atendimento: 'humano', agentId: null };
  }

  /**
   * Humano enviou mensagem manualmente numa conversa da IA: ele assumiu.
   * Roda DENTRO da transação do envio, para não existir janela em que a IA
   * responde por cima do humano.
   */
  async aoHumanoEnviar(tx: Tx, tenantId: string, conversationId: string, identityId: string): Promise<EstadoAtendimento | null> {
    const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { atendimento: true, assigneeId: true } });
    if (!conv || (conv.atendimento === 'humano' && conv.assigneeId)) return null;
    const estado = await this.gravar(tx, tenantId, conversationId, {
      atendimento: 'humano',
      assigneeId: conv.assigneeId ?? identityId,
      handoffMotivo: conv.atendimento === 'ia' ? 'humano assumiu ao responder' : null,
      handoffAt: conv.atendimento === 'ia' ? new Date() : undefined,
    }, { tipo: 'humano', identityId }, 'conversa.assumida');
    return estado;
  }

  /** "Assumir conversa" no Inbox. */
  async assumir(tenantId: string, conversationId: string, identityId: string): Promise<EstadoAtendimento> {
    const estado = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.exigirConversa(tx, conversationId);
      return this.gravar(tx, tenantId, conversationId, { atendimento: 'humano', assigneeId: identityId, handoffMotivo: 'assumida manualmente', handoffAt: new Date() }, { tipo: 'humano', identityId }, 'conversa.assumida');
    });
    this.publicar(tenantId, estado);
    return estado;
  }

  /** Atribuir a um membro específico (continua com humano). */
  async atribuir(tenantId: string, conversationId: string, assigneeId: string, actorId: string): Promise<EstadoAtendimento> {
    const estado = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.exigirConversa(tx, conversationId);
      const membro = await tx.user.findFirst({ where: { identityId: assigneeId, role: { in: PAPEIS_ATENDENTES } }, select: { identityId: true } });
      if (!membro) throw new BadRequestException('responsável não é atendente desta conta');
      return this.gravar(tx, tenantId, conversationId, { atendimento: 'humano', assigneeId }, { tipo: 'humano', identityId: actorId }, 'conversa.atribuida');
    });
    this.publicar(tenantId, estado);
    return estado;
  }

  /** Devolver para a IA: o agente pedido (ou o padrão) precisa estar ativo. */
  async devolverParaIa(tenantId: string, conversationId: string, actorId: string, agentId?: string): Promise<EstadoAtendimento> {
    const estado = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.exigirConversa(tx, conversationId);
      const agente = await tx.agent.findFirst({
        where: agentId ? { id: agentId, status: 'ativo' } : { padrao: true, status: 'ativo' },
        select: { id: true },
      });
      if (!agente) throw new BadRequestException(agentId ? 'agente inexistente ou não está ativo' : 'não há agente padrão ativo — escolha um agente');
      return this.gravar(tx, tenantId, conversationId, { atendimento: 'ia', agentId: agente.id, assigneeId: null, handoffMotivo: null, handoffAt: null }, { tipo: 'humano', identityId: actorId }, 'conversa.devolvida_ia');
    });
    this.publicar(tenantId, estado);
    return estado;
  }

  /**
   * IA → humano. Chamado pelo runtime do agente (pedido do modelo, recusa,
   * limite, erro, falta de credencial). Se ninguém é responsável, distribui
   * para o atendente com MENOS conversas humanas abertas — o lead nunca fica
   * sem dono.
   */
  async transferirParaHumano(tenantId: string, conversationId: string, motivo: string, ator: AtorAtendimento): Promise<EstadoAtendimento> {
    const estado = await this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await this.exigirConversa(tx, conversationId);
      const assigneeId = conv.assigneeId ?? (await this.escolherResponsavel(tx));
      return this.gravar(tx, tenantId, conversationId, { atendimento: 'humano', assigneeId, handoffMotivo: motivo.slice(0, 300), handoffAt: new Date() }, ator, 'conversa.transferida');
    });
    this.publicar(tenantId, estado);
    return estado;
  }

  /** Atendentes da conta com a carga atual (para o seletor de responsável). */
  async atendentes(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const membros = await tx.user.findMany({
        where: { identityId: { not: null }, role: { in: PAPEIS_ATENDENTES } },
        select: { identityId: true, nome: true, email: true, role: true },
        orderBy: { nome: 'asc' },
      });
      const cargas = await this.cargas(tx);
      return membros.map((m) => ({ identityId: m.identityId!, nome: m.nome, email: m.email, role: m.role, abertas: cargas.get(m.identityId!) ?? 0 }));
    });
  }

  /**
   * Distribuição: menor carga de conversas humanas abertas; empate decide
   * pelo identityId (determinístico — o mesmo cenário dá sempre o mesmo dono).
   * Sem atendente cadastrado → null (a conversa fica na fila "sem responsável").
   */
  async escolherResponsavel(tx: Tx): Promise<string | null> {
    const membros = await tx.user.findMany({ where: { identityId: { not: null }, role: { in: PAPEIS_ATENDENTES } }, select: { identityId: true } });
    if (!membros.length) return null;
    const cargas = await this.cargas(tx);
    const ordenados = membros
      .map((m) => ({ id: m.identityId!, carga: cargas.get(m.identityId!) ?? 0 }))
      .sort((a, b) => a.carga - b.carga || a.id.localeCompare(b.id));
    return ordenados[0].id;
  }

  private async cargas(tx: Tx): Promise<Map<string, number>> {
    const linhas = await tx.conversation.groupBy({
      by: ['assigneeId'],
      where: { atendimento: 'humano', status: 'aberta', assigneeId: { not: null } },
      _count: { _all: true },
    });
    return new Map(linhas.map((l) => [l.assigneeId!, l._count._all]));
  }

  private async exigirConversa(tx: Tx, conversationId: string) {
    const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, assigneeId: true } });
    if (!conv) throw new NotFoundException('conversa inexistente');
    return conv;
  }

  private async gravar(
    tx: Tx,
    tenantId: string,
    conversationId: string,
    data: { atendimento: AtendimentoConversa; agentId?: string | null; assigneeId?: string | null; handoffMotivo?: string | null; handoffAt?: Date | null },
    ator: AtorAtendimento,
    acao: string,
  ): Promise<EstadoAtendimento> {
    const c = await tx.conversation.update({
      where: { id: conversationId },
      data,
      select: { id: true, atendimento: true, agentId: true, assigneeId: true, handoffMotivo: true },
    });
    const actorType = ator.tipo === 'ia' ? 'nyro' : ator.tipo === 'humano' ? 'humano' : 'sistema';
    const actorId = ator.tipo === 'humano' ? ator.identityId : ator.tipo === 'ia' ? ator.agentId : null;
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${tenantId}::uuid, ${actorType}, ${actorId}, ${acao}, 'conversation', ${conversationId}, ${JSON.stringify(data)}::jsonb)`;
    return { id: c.id, atendimento: c.atendimento as AtendimentoConversa, agentId: c.agentId, assigneeId: c.assigneeId, handoffMotivo: c.handoffMotivo };
  }

  /** Avisa a tela (depois do commit). Falhar aqui não desfaz a mudança. */
  publicar(tenantId: string, e: EstadoAtendimento): void {
    try {
      this.eventos.publicar(tenantId, 'conversation.updated', { id: e.id, atendimento: e.atendimento, agentId: e.agentId, assigneeId: e.assigneeId, handoffMotivo: e.handoffMotivo });
    } catch (err) {
      this.log.warn(`falha ao publicar atendimento: ${(err as Error).message}`);
    }
  }
}
