import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { CrmService } from '../crm/crm.service';
import { TokenService } from '../auth/token.service';

export interface CriarClienteInput {
  nome: string;
  nicho?: string;
}

/**
 * Agency Mode (migration 026). Nada aqui duplica tenancy: um ClientAccount é
 * só um apontador pra um tenant que já existe, com RLS/isolamento intactos.
 * "Entrar num cliente" (`ativarCliente`) não é impersonation — é trocar qual
 * tenantId vai no PRÓXIMO JWT da mesma identidade, reaproveitando o mesmo
 * mecanismo do login (`TokenService`). Cada query de dado operacional
 * continua resolvendo tenant a partir do JWT, exatamente como hoje.
 */
@Injectable()
export class AgencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly crm: CrmService,
    private readonly tokens: TokenService,
  ) {}

  /** Agência da identidade (V1: uma por identidade) + role, ou null se não pertence a nenhuma. */
  private async membroDe(identityId: string) {
    return this.prisma.agencyMember.findFirst({
      where: { identityId },
      include: { agency: true },
    });
  }

  /** Time da agência. Inclui `clientIds` (restrições de subconta por membro) para a matriz de acesso carregar em uma chamada. */
  async listarMembros(identityId: string) {
    const membro = await this.membroDe(identityId);
    if (!membro) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    const membros = await this.prisma.agencyMember.findMany({
      where: { agencyId: membro.agencyId },
      orderBy: { createdAt: 'asc' },
      include: { clientAccess: { select: { clientAccountId: true } } },
    });
    const identidades = await this.prisma.identity.findMany({ where: { id: { in: membros.map((m) => m.identityId) } }, select: { id: true, email: true } });
    const emailPorId = new Map(identidades.map((i) => [i.id, i.email]));
    return membros.map((m) => ({
      id: m.id,
      identityId: m.identityId,
      email: emailPorId.get(m.identityId) ?? '—',
      role: m.role,
      createdAt: m.createdAt,
      // [] = sem restrição configurada = acesso global a todas as subcontas.
      clientIds: m.clientAccess.map((a) => a.clientAccountId),
    }));
  }

  /**
   * Edita papel e/ou acesso a subcontas de um membro (estilo GHL: visibilidade
   * por usuário). Só owner/admin. O dono da agência e o próprio editor não
   * podem ser alterados. `clientIds` vazio remove a restrição (acesso global);
   * ids são validados contra as subcontas da agência.
   */
  async atualizarMembro(identityId: string, agencyMemberId: string, input: { role?: string; clientIds?: string[] }) {
    const membro = await this.membroDe(identityId);
    if (!membro || !['owner', 'admin'].includes(membro.role)) throw new ForbiddenException('apenas o dono ou um admin da agência edita membros');
    const alvo = await this.prisma.agencyMember.findFirst({ where: { id: agencyMemberId, agencyId: membro.agencyId } });
    if (!alvo) throw new NotFoundException('membro não encontrado nesta agência');
    if (alvo.identityId === identityId) throw new ForbiddenException('você não pode editar o próprio acesso');
    if (alvo.identityId === membro.agency.ownerIdentityId) throw new ForbiddenException('o dono da agência não pode ser editado');

    if (input.role !== undefined) {
      if (!['admin', 'member', 'viewer'].includes(input.role)) throw new ForbiddenException("papel inválido (use admin, member ou viewer)");
      await this.prisma.agencyMember.update({ where: { id: alvo.id }, data: { role: input.role } });
    }

    if (input.clientIds !== undefined) {
      const clientes = await this.prisma.agencyClientAccount.findMany({ where: { agencyId: membro.agencyId }, select: { id: true } });
      const validos = new Set(clientes.map((c) => c.id));
      const ids = [...new Set(input.clientIds)];
      if (ids.some((id) => !validos.has(id))) throw new ForbiddenException('subconta inválida para esta agência');
      await this.prisma.$transaction(async (tx) => {
        await tx.agencyMemberClientAccess.deleteMany({ where: { agencyMemberId: alvo.id } });
        if (ids.length > 0) {
          await tx.agencyMemberClientAccess.createMany({ data: ids.map((clientAccountId) => ({ agencyMemberId: alvo.id, clientAccountId })) });
        }
      });
    }

    await this.auditar(membro.agencyId, identityId, 'agency.member.update', 'agency_member', alvo.id);
    return { ok: true };
  }

  /**
   * Remove um membro da agência (SEC-01 · ADR-0042). Além do vínculo com a
   * agência, apaga os acessos que a agência abriu para ele nos clientes
   * (memberships NÃO padrão nos tenants da agência — o tenant próprio da
   * pessoa, se houver, fica intacto) e revoga as sessões desses tenants.
   * O guard confere a membership a cada requisição: o acesso cai na hora.
   */
  async removerMembro(identityId: string, agencyMemberId: string) {
    const membro = await this.membroDe(identityId);
    if (!membro || !['owner', 'admin'].includes(membro.role)) throw new ForbiddenException('apenas o dono ou um admin da agência remove membros');
    const alvo = await this.prisma.agencyMember.findFirst({ where: { id: agencyMemberId, agencyId: membro.agencyId } });
    if (!alvo) throw new NotFoundException('membro não encontrado nesta agência');
    if (alvo.identityId === identityId) throw new ForbiddenException('você não pode remover a si mesmo');
    if (alvo.identityId === membro.agency.ownerIdentityId) throw new ForbiddenException('o dono da agência não pode ser removido');
    if (alvo.role === 'owner' && membro.role !== 'owner') throw new ForbiddenException('apenas o dono remove outro dono');

    const clientes = await this.prisma.agencyClientAccount.findMany({ where: { agencyId: membro.agencyId }, select: { tenantId: true } });
    const tenantIds = clientes.map((c) => c.tenantId);
    const r = await this.prisma.$transaction(async (tx) => {
      const vinculos = await tx.membership.findMany({ where: { identityId: alvo.identityId, tenantId: { in: tenantIds }, isDefault: false }, select: { tenantId: true } });
      const tenantsRemovidos = vinculos.map((v) => v.tenantId);
      await tx.membership.deleteMany({ where: { identityId: alvo.identityId, tenantId: { in: tenantsRemovidos } } });
      const sessoes = await tx.refreshToken.updateMany({ where: { identityId: alvo.identityId, tenantId: { in: tenantsRemovidos }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.agencyMember.delete({ where: { id: alvo.id } }); // cascata: agency_member_client_access
      return { tenantsRemovidos, sessoesRevogadas: sessoes.count };
    });
    // Perfil do usuário em cada cliente (tabela com RLS: uma transação por tenant).
    for (const t of r.tenantsRemovidos) {
      await this.prisma.withTenant(t, async (tx) => {
        await tx.user.deleteMany({ where: { identityId: alvo.identityId } });
        await tx.conversation.updateMany({ where: { assigneeId: alvo.identityId }, data: { assigneeId: null } });
      });
      await this.auditar(t, identityId, 'agency.member.remove', 'agency_member', alvo.id);
    }
    return { ok: true, clientesRemovidos: r.tenantsRemovidos.length, sessoesRevogadas: r.sessoesRevogadas };
  }

  async meuContexto(identityId: string) {
    const membro = await this.membroDe(identityId);
    if (!membro) return null;
    return { agencyId: membro.agency.id, nome: membro.agency.name, slug: membro.agency.slug, role: membro.role, isDemo: membro.agency.isDemo };
  }

  /** Clientes que este membro pode ver — global (owner/admin) ou restrito por `agency_member_client_access`. */
  private async clientesVisiveis(membro: NonNullable<Awaited<ReturnType<AgencyService['membroDe']>>>) {
    const todos = await this.prisma.agencyClientAccount.findMany({
      where: { agencyId: membro.agencyId, status: { not: 'archived' } },
      orderBy: { createdAt: 'asc' },
    });
    if (membro.role === 'owner' || membro.role === 'admin') return todos;
    const restritos = await this.prisma.agencyMemberClientAccess.findMany({ where: { agencyMemberId: membro.id }, select: { clientAccountId: true } });
    if (restritos.length === 0) return todos; // sem restrição configurada = acesso global (V1, seção 27)
    const permitidos = new Set(restritos.map((r) => r.clientAccountId));
    return todos.filter((c) => permitidos.has(c.id));
  }

  async listarClientes(identityId: string) {
    const membro = await this.membroDe(identityId);
    if (!membro) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    const clientes = await this.clientesVisiveis(membro);

    // Métrica por cliente: SEMPRE tenant-scoped via CrmService.overview() —
    // nunca uma query única cruzando tenants (seção 31 do brief).
    return Promise.all(
      clientes.map(async (c) => {
        const ov = await this.crm.overview(c.tenantId).catch(() => null);
        return {
          id: c.id, tenantId: c.tenantId, nome: c.displayName, status: c.status, isDemo: c.isDemo, createdAt: c.createdAt,
          contatos: ov?.kpis.contatos ?? 0, negocios: ov?.kpis.negocios ?? 0,
          receitaFechada: ov?.kpis.ganho ?? 0, ultimaAtividadeEm: ov?.atividades?.[0]?.createdAt ?? null,
        };
      }),
    );
  }

  async detalheCliente(identityId: string, clientAccountId: string) {
    const membro = await this.membroDe(identityId);
    if (!membro) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    const visiveis = await this.clientesVisiveis(membro);
    const cliente = visiveis.find((c) => c.id === clientAccountId);
    if (!cliente) throw new NotFoundException('cliente não encontrado ou sem acesso');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: cliente.tenantId }, select: { id: true, nome: true, nicho: true, status: true, createdAt: true } });
    const ov = await this.crm.overview(cliente.tenantId).catch(() => null);
    return { ...cliente, tenant, overview: ov };
  }

  /** Cria tenant novo (mesmo provisioning de sempre) + vincula como cliente da agência. */
  async criarCliente(identityId: string, input: CriarClienteInput) {
    const membro = await this.membroDe(identityId);
    if (!membro) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    if (membro.role !== 'owner' && membro.role !== 'admin') throw new ForbiddenException('só owner/admin da agência cria cliente');

    const identity = await this.prisma.identity.findUniqueOrThrow({ where: { id: identityId } });
    const tenant = await this.tenants.provision({ identityId, email: identity.email, nome: 'Responsável', empresa: input.nome, nicho: input.nicho });

    const cliente = await this.prisma.agencyClientAccount.create({
      data: { agencyId: membro.agencyId, tenantId: tenant.id, displayName: input.nome, status: 'active' },
    });
    await this.auditar(tenant.id, identityId, 'agency.client.create', 'agency_client_account', cliente.id);
    return cliente;
  }

  /**
   * Troca o contexto operacional pro tenant deste cliente — mesmo mecanismo
   * do login (novo par de tokens), sem senha, sem impersonation. Garante
   * (auto-provisiona se preciso, idempotente) que a identidade tem
   * Membership+User NESSE tenant, reaproveitando o modelo já existente de
   * "mesma identidade, múltiplos tenants" (visto em acceptInvite()).
   */
  async ativarCliente(identityId: string, clientAccountId: string, userAgent?: string) {
    const membro = await this.membroDe(identityId);
    if (!membro) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    const visiveis = await this.clientesVisiveis(membro);
    const cliente = visiveis.find((c) => c.id === clientAccountId);
    if (!cliente) throw new ForbiddenException('cliente não encontrado ou sem acesso');
    if (cliente.status !== 'active') throw new ForbiddenException('cliente não está ativo');

    const identity = await this.prisma.identity.findUniqueOrThrow({ where: { id: identityId } });
    const papel = membro.role === 'owner' || membro.role === 'admin' ? 'admin' : membro.role === 'viewer' ? 'viewer' : 'member';

    await this.prisma.membership.upsert({
      where: { identityId_tenantId: { identityId, tenantId: cliente.tenantId } },
      create: { identityId, tenantId: cliente.tenantId, role: papel, isDefault: false },
      update: {},
    });

    // "pedro.gabriel@..." → "Pedro Gabriel" — sem isto o primeiro acesso a
    // um cliente novo criava um User com nome cru tipo "pedro.gabriel",
    // inconsistente com o nome que a própria pessoa vê no resto do produto.
    const nome = identity.email
      .split('@')[0]
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    let user = await this.prisma.withTenant(cliente.tenantId, (tx) => tx.user.findFirst({ where: { identityId }, select: { id: true, role: true, nome: true } }));
    if (!user) {
      user = await this.prisma.withTenant(cliente.tenantId, (tx) =>
        tx.user.create({ data: { tenantId: cliente.tenantId, identityId, email: identity.email, nome, role: papel }, select: { id: true, role: true, nome: true } }),
      );
    }

    const access = this.tokens.signAccess({ sub: identityId, tenant_id: cliente.tenantId, role: user.role, email: identity.email });
    const refresh = await this.tokens.issueRefresh(identityId, cliente.tenantId, userAgent);
    await this.auditar(cliente.tenantId, identityId, 'agency.client.activate', 'agency_client_account', cliente.id);

    return { access, refresh, user: { identityId, email: identity.email, nome: user.nome, tenantId: cliente.tenantId, role: user.role } };
  }

  /** Agregado leve pra Agency Home — mesma regra: uma chamada tenant-scoped por cliente, nunca uma query cruzando tenants. */
  async overview(identityId: string) {
    const clientes = await this.listarClientes(identityId);
    return {
      totalClientes: clientes.length,
      negociosAbertosTotal: clientes.reduce((s, c) => s + c.negocios, 0),
      clientes,
    };
  }

  private async auditar(tenantId: string, actorId: string, acao: string, entidade: string, entidadeId: string): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, ${entidade}, ${entidadeId}::uuid)`,
    ).catch(() => undefined); // auditoria nunca derruba a operação principal
  }
}
