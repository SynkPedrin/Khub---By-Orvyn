import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantsService } from '../tenants/tenants.service';
import type { TokenService } from './token.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TENANT_CONVITE = 'aaaa1111-0000-4000-8000-000000000001';
const OUTRO_TENANT = 'bbbb2222-0000-4000-8000-000000000002';

/**
 * Banco em memória com o contrato que o AuthService usa. O foco é o convite:
 * é o único fluxo em que uma pessoa **de fora** entra num tenant, e a Agenda
 * vai reproduzir esse padrão no link público de agendamento.
 */
function ambiente(opts: { convite?: Record<string, unknown> | null; identidade?: Record<string, unknown> | null } = {}) {
  const memberships: any[] = [];
  const users: any[] = [];
  const identidades: any[] = opts.identidade ? [opts.identidade] : [];
  const convite: any = opts.convite === undefined
    ? { id: 'inv1', email: 'Novo@Empresa.com', tenantId: TENANT_CONVITE, role: 'member', acceptedAt: null, expiresAt: new Date(Date.now() + 86400000) }
    : opts.convite;
  const auditados: string[] = [];

  const prisma = {
    invite: {
      findUnique: jest.fn(async ({ where }: any) => (convite && where.tokenHash === sha256('TOKEN-VALIDO') ? convite : null)),
      update: jest.fn(async ({ data }: any) => { Object.assign(convite, data); return convite; }),
      // `updateMany` com WHERE condicional é como o serviço reivindica o
      // convite de forma atômica: só marca `acceptedAt` se ele ainda estiver
      // livre e válido. `count: 0` é o sinal de "alguém chegou antes" — é
      // por ele que o teste de uso único recusa a segunda tentativa.
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!convite || convite.id !== where.id) return { count: 0 };
        if (where.acceptedAt === null && convite.acceptedAt) return { count: 0 };
        if (where.expiresAt?.gt && convite.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(convite, data);
        return { count: 1 };
      }),
    },
    identity: {
      findFirst: jest.fn(async ({ where }: any) => identidades.find((i) => i.email.toLowerCase() === where.email.equals.toLowerCase()) ?? null),
      findUnique: jest.fn(async () => identidades[0] ?? null),
      create: jest.fn(async ({ data }: any) => { const i = { id: 'ident-nova', ...data }; identidades.push(i); return i; }),
    },
    membership: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existe = memberships.find((m) => m.identityId === where.identityId_tenantId.identityId && m.tenantId === where.identityId_tenantId.tenantId);
        if (existe) { Object.assign(existe, update); return existe; }
        memberships.push({ ...create }); return create;
      }),
    },
    withTenant: jest.fn(async (tenantId: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        user: {
          findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.identityId === where.identityId) ?? null),
          create: jest.fn(async ({ data }: any) => { users.push({ tenantId, ...data }); return data; }),
        },
        $executeRaw: jest.fn(async (s: TemplateStringsArray) => { auditados.push(s.join('')); return 1; }),
      }),
    ),
  } as unknown as PrismaService;

  const emitidos: any[] = [];
  const tokens = {
    signAccess: jest.fn(() => 'access-token'),
    issueRefresh: jest.fn(async (identityId: string, tenantId: string) => { emitidos.push({ identityId, tenantId }); return 'refresh-token'; }),
  } as unknown as TokenService;

  const tenants = { provision: jest.fn(), membershipsOf: jest.fn(async () => []), myTenant: jest.fn() } as unknown as TenantsService;

  return { svc: new AuthService(prisma, tenants, tokens), prisma, memberships, users, identidades, convite, emitidos, auditados };
}

describe('AuthService.acceptInvite — a única porta de entrada num tenant alheio', () => {
  it('convidado novo: cria identidade, membership NO TENANT DO CONVITE e perfil', async () => {
    const a = ambiente();
    const r = await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana Convidada', 'SenhaForte123');

    expect(r.user.tenantId).toBe(TENANT_CONVITE); // nunca um tenant novo
    expect(r.user.role).toBe('member');           // a role vem do convite
    expect(a.memberships[0]).toMatchObject({ tenantId: TENANT_CONVITE, role: 'member' });
    expect(a.users[0]).toMatchObject({ nome: 'Ana Convidada', tenantId: TENANT_CONVITE });
    expect(a.emitidos[0]).toMatchObject({ tenantId: TENANT_CONVITE });
  });

  it('USO ÚNICO: aceitar marca `acceptedAt`; a 2ª tentativa é recusada', async () => {
    const a = ambiente();
    await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    expect(a.convite.acceptedAt).toBeTruthy();

    const b = ambiente({ convite: { ...a.convite } }); // mesmo convite, já aceito
    await expect(b.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123')).rejects.toThrow(/inválido|expirado|utilizado/);
  });

  it('convite expirado não entra', async () => {
    const a = ambiente({ convite: { id: 'inv1', email: 'x@y.com', tenantId: TENANT_CONVITE, role: 'member', acceptedAt: null, expiresAt: new Date(Date.now() - 1000) } });
    await expect(a.svc.acceptInvite('TOKEN-VALIDO', 'X', 'SenhaForte123')).rejects.toThrow(BadRequestException);
  });

  it('token errado não entra (o token É a credencial)', async () => {
    const a = ambiente();
    await expect(a.svc.acceptInvite('TOKEN-CHUTADO', 'X', 'SenhaForte123')).rejects.toThrow(/inválido/);
    expect(a.memberships).toHaveLength(0);
  });

  it('identidade que JÁ existe entra no 2º tenant sem criar conta nova', async () => {
    const a = ambiente({ identidade: { id: 'ident-antiga', email: 'novo@empresa.com', passwordHash: await hash('qualquer') } });
    const r = await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'qualquer');

    expect((a.prisma as any).identity.create).not.toHaveBeenCalled();
    expect(r.user.identityId).toBe('ident-antiga');
    expect(a.memberships[0]).toMatchObject({ identityId: 'ident-antiga', tenantId: TENANT_CONVITE });
  });

  it('conta nova sem senha (ou curta) é recusada — não cria acesso sem credencial', async () => {
    for (const senha of [undefined, '1234567']) {
      const a = ambiente();
      await expect(a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', senha)).rejects.toThrow(/senha/);
      expect(a.memberships).toHaveLength(0);
    }
  });

  it('e-mail do convite é case-insensitive (o convite dita o e-mail, não o clique)', async () => {
    const a = ambiente({ identidade: { id: 'ident-antiga', email: 'NOVO@empresa.COM', passwordHash:await hash('SenhaForte123') } });
    await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    expect((a.prisma as any).identity.create).not.toHaveBeenCalled();
  });

  it('sem nome, usa a parte local do e-mail em vez de criar usuário anônimo', async () => {
    const a = ambiente();
    const r = await a.svc.acceptInvite('TOKEN-VALIDO', undefined, 'SenhaForte123');
    expect(r.user.nome).toBe('Novo');
  });

  it('o aceite é auditado no tenant do convite', async () => {
    const a = ambiente();
    await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    expect(a.auditados.join(' ')).toContain('audit_logs');
    expect((a.prisma.withTenant as jest.Mock).mock.calls[0][0]).toBe(TENANT_CONVITE);
  });

  it('reaceite por quem já é membro não duplica perfil (upsert idempotente)', async () => {
    const a = ambiente({ identidade: { id: 'ident-antiga', email: 'novo@empresa.com',passwordHash:await hash('SenhaForte123') } });
    await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    const antes = a.users.length;

    const b = ambiente({ identidade: { id: 'ident-antiga', email: 'novo@empresa.com',passwordHash:await hash('SenhaForte123') } });
    await b.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    expect(b.users.length).toBe(antes); // 1 perfil, não 2
  });

  it('o tenant vem do CONVITE, nunca de quem clica', async () => {
    const a = ambiente();
    await a.svc.acceptInvite('TOKEN-VALIDO', 'Ana', 'SenhaForte123');
    // nenhuma escrita aconteceu no tenant alheio
    const tenantsTocados = (a.prisma.withTenant as jest.Mock).mock.calls.map((c) => c[0]);
    expect(tenantsTocados.every((t) => t === TENANT_CONVITE)).toBe(true);
    expect(tenantsTocados).not.toContain(OUTRO_TENANT);
  });

  it('conta existente exige senha correta antes de consumir o convite', async () => {
    for (const senha of [undefined,'errada']) {
      const a=ambiente({identidade:{id:'ident-antiga',email:'novo@empresa.com',passwordHash:await hash('SenhaForte123')}});
      await expect(a.svc.acceptInvite('TOKEN-VALIDO','Ana',senha)).rejects.toThrow(UnauthorizedException);
      expect(a.convite.acceptedAt).toBeNull();
      expect(a.memberships).toHaveLength(0);
    }
  });
});

describe('AuthService.login', () => {
  it('senha errada não vira sessão', async () => {
    const a = ambiente({ identidade: { id: 'i1', email: 'a@b.c', passwordHash: await hash('SenhaCerta123') } });
    await expect(a.svc.login('a@b.c', 'SenhaErrada')).rejects.toThrow(UnauthorizedException);
  });

  it('identidade sem senha (só OAuth) não loga por senha', async () => {
    const a = ambiente({ identidade: { id: 'i1', email: 'a@b.c', passwordHash: null } });
    await expect(a.svc.login('a@b.c', 'qualquer')).rejects.toThrow(UnauthorizedException);
  });

  it('e-mail inexistente e senha correta de outro não vazam informação diferente', async () => {
    const a = ambiente({ identidade: null });
    await expect(a.svc.login('nao@existe.com', 'SenhaForte123')).rejects.toThrow(/credenciais inválidas/);
  });
});
