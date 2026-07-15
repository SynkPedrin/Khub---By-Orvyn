import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { TokenService } from './token.service';

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
    const active = memberships.find((m) => m.tenantId === rotated.tenantId) ?? memberships[0];
    const access = this.tokens.signAccess({ sub: rotated.identityId, tenant_id: rotated.tenantId, role: active?.role ?? 'owner', email: identity?.email ?? '' });
    return { access, refresh: rotated.raw, user: { identityId: rotated.identityId, email: identity?.email ?? '', nome: '', tenantId: rotated.tenantId, role: active?.role ?? 'owner' } };
  }

  async logout(rawRefresh: string): Promise<void> {
    if (rawRefresh) await this.tokens.revoke(rawRefresh);
  }

  async me(identityId: string, tenantId: string) {
    const [identity, tenant, memberships] = await Promise.all([
      this.prisma.identity.findUnique({ where: { id: identityId }, select: { email: true, emailVerifiedAt: true } }),
      this.tenants.myTenant(tenantId),
      this.tenants.membershipsOf(identityId),
    ]);
    const profile = await this.prisma.withTenant(tenantId, (tx) => tx.user.findFirst({ where: { identityId }, select: { nome: true, role: true } }));
    return { identityId, email: identity?.email, nome: profile?.nome, role: profile?.role, tenant, memberships };
  }

  private async issue(identityId: string, email: string, nome: string, tenantId: string, role: string, userAgent?: string): Promise<Tokens> {
    const access = this.tokens.signAccess({ sub: identityId, tenant_id: tenantId, role, email });
    const refresh = await this.tokens.issueRefresh(identityId, tenantId, userAgent);
    return { access, refresh, user: { identityId, email, nome, tenantId, role } };
  }
}
