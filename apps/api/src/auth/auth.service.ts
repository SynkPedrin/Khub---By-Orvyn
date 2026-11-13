import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { TokenService } from './token.service';
import { Prisma } from '@prisma/client';
import { modulosDe, papelRestringivel } from './modulos';

export interface SignupInput {
  email: string;
  password: string;
  nome: string;
  empresa?: string;
  nicho?: string;
}
export interface Tokens {
  access: string;
  refresh: string;
  user: { identityId: string; email: string; nome: string; tenantId: string; role: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly tokens: TokenService,
  ) {}

  async signup(input: SignupInput, userAgent?: string): Promise<Tokens> {
    const exists = await this.prisma.identity.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } });
    if (exists) throw new ConflictException('e-mail já cadastrado');

    const identity = await this.prisma.identity.create({
      data: { email: input.email, passwordHash: await hash(input.password), emailVerifiedAt: null },
      select: { id: true, email: true },
    });

    const tenant = await this.tenants.provision({ identityId: identity.id, email: identity.email, nome: input.nome, empresa: input.empresa, nicho: input.nicho });
    return this.issue(identity.id, identity.email, input.nome, tenant.id, 'owner', userAgent);
  }

  /**
   * Aceite de convite (S0-2 / ADR-0009). Token de USO ÚNICO: valida hash+expiração,
   * cria a identidade (se nova) ou apenas adiciona membership (identidade existente
   * entrando num 2º tenant), cria o perfil no tenant do convite com a role dele,
   * marca `accepted_at` e emite sessão. Auditado.
   */
  async acceptInvite(token: string, nome?: string, password?: string, userAgent?: string): Promise<Tokens> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('convite inválido, expirado ou já utilizado');
    }

    let identity = await this.prisma.identity.findFirst({ where: { email: { equals: invite.email, mode: 'insensitive' } } });
    const contaNova = !identity;
    if (!identity) {
      if (!password || password.length < 8) throw new BadRequestException('senha obrigatória (mínimo 8 caracteres) para criar a conta');
      identity = await this.prisma.identity.create({ data: { email: invite.email, passwordHash: await hash(password), emailVerifiedAt: new Date() } });
    }
    else if (!identity.passwordHash || !password || !await verify(identity.passwordHash,password)) {
      throw new UnauthorizedException('confirme a senha da conta existente para aceitar o convite');
    }
    const claimed = await this.prisma.invite.updateMany({where:{id:invite.id,acceptedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date()}});
    if(claimed.count!==1) throw new BadRequestException('convite já utilizado');
    const identityId = identity.id;

    // membership no tenant do convite (idempotente)
    await this.prisma.membership.upsert({
      where: { identityId_tenantId: { identityId, tenantId: invite.tenantId } },
      // Conta nova: esta subaccount é a única, então é a padrão (o login cai direto nela).
      create: { identityId, tenantId: invite.tenantId, role: invite.role, isDefault: contaNova },
      update: {},
    });

    const displayName = nome?.trim() || invite.email.split('@')[0];
    await this.prisma.withTenant(invite.tenantId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { identityId }, select: { id: true } });
      // Acesso por módulo escolhido no convite (ADR-0045) entra junto: o
      // colaborador já chega restrito, sem janela com acesso total.
      const permissoes = (invite.permissoes ?? {}) as Prisma.InputJsonValue;
      if (!existing) {
        await tx.user.create({ data: { tenantId: invite.tenantId, identityId, email: invite.email, nome: displayName, role: invite.role, permissoes } });
      } else if (modulosDe(invite.permissoes) !== null) {
        await tx.user.update({ where: { id: existing.id }, data: { permissoes } });
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${invite.tenantId}::uuid, 'humano', ${identityId}, 'invite.accept', 'invite', ${invite.id})`;
    });

    // uso único
    await this.prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

    return this.issue(identityId, invite.email, displayName, invite.tenantId, invite.role, userAgent);
  }

  /**
   * Pré-visualização pública do convite (ADR-0042): a tela de aceite mostra
   * para qual empresa e com qual e-mail a pessoa vai entrar, e se ela já tem
   * conta (aí pede a senha atual em vez de criar uma). Não revela nada além do
   * que o próprio link já dá direito; token inválido → a mesma mensagem genérica.
   */
  async previewInvite(token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('convite inválido, expirado ou já utilizado');
    }
    const [tenant, identity] = await Promise.all([
      this.prisma.withTenant(invite.tenantId, (tx) => tx.tenant.findUnique({ where: { id: invite.tenantId }, select: { nome: true } })),
      this.prisma.identity.findFirst({ where: { email: { equals: invite.email, mode: 'insensitive' } }, select: { passwordHash: true } }),
    ]);
    return { email: invite.email, empresa: tenant?.nome ?? 'KHUB', papel: invite.role, contaExistente: !!identity?.passwordHash, expiraEm: invite.expiresAt };
  }

  async login(email: string, password: string, userAgent?: string): Promise<Tokens> {
    const identity = await this.prisma.identity.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!identity?.passwordHash || !(await verify(identity.passwordHash, password))) {
      throw new UnauthorizedException('credenciais inválidas');
    }
    const memberships = await this.tenants.membershipsOf(identity.id);
    const active = memberships.find((m) => m.isDefault) ?? memberships[0];
    if (!active) throw new UnauthorizedException('usuário sem tenant');

    const profile = await this.prisma.withTenant(active.tenantId, (tx) =>
      tx.user.findFirst({ where: { identityId: identity.id }, select: { nome: true } }),
    );
    return this.issue(identity.id, identity.email, profile?.nome ?? identity.email, active.tenantId, active.role, userAgent);
  }

  async refresh(rawRefresh: string, userAgent?: string): Promise<Tokens> {
    const rotated = await this.tokens.rotate(rawRefresh, userAgent);
    const identity = await this.prisma.identity.findUnique({ where: { id: rotated.identityId }, select: { email: true } });
    const memberships = await this.tenants.membershipsOf(rotated.identityId);
    const active = memberships.find((m) => m.tenantId === rotated.tenantId);
    if (!identity || !active) {
      await this.tokens.revoke(rotated.raw);
      throw new UnauthorizedException('vínculo revogado');
    }
    const access = this.tokens.signAccess({ sub: rotated.identityId, tenant_id: rotated.tenantId, role: active.role, email: identity?.email ?? '' });
    return { access, refresh: rotated.raw, user: { identityId: rotated.identityId, email: identity?.email ?? '', nome: '', tenantId: rotated.tenantId, role: active.role } };
  }

  async logout(rawRefresh: string): Promise<void> {
    if (rawRefresh) await this.tokens.revoke(rawRefresh);
  }

  /** Ticket curto para o handshake do socket (ADR-0011). */
  wsTicket(user: { identityId: string; tenantId: string; role: string; email: string }): string {
    return this.tokens.signWsTicket({ sub: user.identityId, tenant_id: user.tenantId, role: user.role, email: user.email });
  }

  async me(identityId: string, tenantId: string) {
    const [identity, tenant, memberships] = await Promise.all([
      this.prisma.identity.findUnique({ where: { id: identityId }, select: { email: true, emailVerifiedAt: true } }),
      this.tenants.myTenant(tenantId),
      this.tenants.membershipsOf(identityId),
    ]);
    const profile = await this.prisma.withTenant(tenantId, (tx) => tx.user.findFirst({ where: { identityId }, select: { nome: true, role: true, permissoes: true } }));
    // Módulos efetivos (ADR-0045): owner/admin nunca são restritos.
    const role = memberships.find((m) => m.tenantId === tenantId)?.role ?? profile?.role ?? '';
    const modulos = papelRestringivel(role) ? modulosDe(profile?.permissoes) : null;
    return { identityId, email: identity?.email, nome: profile?.nome, role: profile?.role, modulos, tenant, memberships };
  }

  /**
   * Login/cadastro via OAuth (Google/GitHub). A identidade nasce **sem senha**
   * (`passwordHash: null`) e com o e-mail já verificado pelo provedor. Se o
   * e-mail já existe, apenas emite a sessão no tenant padrão (mesmo comportamento
   * do login). Nunca há senha envolvida — o provedor é a credencial.
   */
  async loginWithOAuth(email: string, nome: string, userAgent?: string): Promise<Tokens> {
    const existente = await this.prisma.identity.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existente) {
      const memberships = await this.tenants.membershipsOf(existente.id);
      const active = memberships.find((m) => m.isDefault) ?? memberships[0];
      if (!active) throw new UnauthorizedException('usuário sem tenant');
      const profile = await this.prisma.withTenant(active.tenantId, (tx) =>
        tx.user.findFirst({ where: { identityId: existente.id }, select: { nome: true } }),
      );
      return this.issue(existente.id, existente.email, profile?.nome ?? nome, active.tenantId, active.role, userAgent);
    }
    // primeiro acesso: cria identidade sem senha + provisiona um tenant (funil default)
    const identity = await this.prisma.identity.create({ data: { email, passwordHash: null, emailVerifiedAt: new Date() } });
    const tenant = await this.tenants.provision({ identityId: identity.id, email, nome });
    return this.issue(identity.id, email, nome, tenant.id, 'owner', userAgent);
  }

  private async issue(identityId: string, email: string, nome: string, tenantId: string, role: string, userAgent?: string): Promise<Tokens> {
    const access = this.tokens.signAccess({ sub: identityId, tenant_id: tenantId, role, email });
    const refresh = await this.tokens.issueRefresh(identityId, tenantId, userAgent);
    return { access, refresh, user: { identityId, email, nome, tenantId, role } };
  }
}
