import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgencyService } from './agency.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantsService } from '../tenants/tenants.service';
import type { CrmService } from '../crm/crm.service';
import type { TokenService } from '../auth/token.service';

const AGENCIA_A = 'agencia-a';
const AGENCIA_B = 'agencia-b';
const TENANT_1 = 'tenant-1';
const TENANT_2 = 'tenant-2';

/**
 * Banco em memória com o contrato que o AgencyService usa — mesmo padrão de
 * auth.service.spec.ts. O foco é a fronteira de autorização: um
 * ClientAccount só é visível/ativável por quem é membro da AGÊNCIA dona
 * dele, nunca por ID cru vindo do cliente.
 */
function ambiente(opts: {
  membro?: Record<string, unknown> | null;
  clientAccounts?: Record<string, unknown>[];
  restricoes?: Record<string, unknown>[];
} = {}) {
  const membro = opts.membro === undefined
    ? { id: 'membro-1', agencyId: AGENCIA_A, identityId: 'ident-pedro', role: 'owner', agency: { id: AGENCIA_A, name: 'Agência A', slug: 'agencia-a', isDemo: true } }
    : opts.membro;
  const clientAccounts = opts.clientAccounts ?? [
    { id: 'client-1', agencyId: AGENCIA_A, tenantId: TENANT_1, displayName: 'Cliente 1', status: 'active', isDemo: true, createdAt: new Date() },
    { id: 'client-2', agencyId: AGENCIA_A, tenantId: TENANT_2, displayName: 'Cliente 2', status: 'active', isDemo: true, createdAt: new Date() },
  ];
  const restricoes = opts.restricoes ?? [];
  const memberships: any[] = [];
  const usersByTenant = new Map<string, any[]>();
  const auditados: { tenantId: string; acao: string }[] = [];
  const criados: any[] = [];

  const prisma = {
    agencyMember: {
      findFirst: jest.fn(async () => membro),
      findMany: jest.fn(async () => (membro ? [membro] : [])),
    },
    agencyClientAccount: {
      findMany: jest.fn(async ({ where }: any) => clientAccounts.filter((c) => c.agencyId === where.agencyId && c.status !== 'archived')),
      create: jest.fn(async ({ data }: any) => { const c = { id: `client-novo-${criados.length}`, createdAt: new Date(), ...data }; criados.push(c); return c; }),
    },
    agencyMemberClientAccess: {
      findMany: jest.fn(async ({ where }: any) => restricoes.filter((r: any) => r.agencyMemberId === where.agencyMemberId)),
    },
    identity: {
      findMany: jest.fn(async () => [{ id: 'ident-pedro', email: 'pedro@agencia.com' }]),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'ident-pedro', email: 'pedro@agencia.com' })),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, nome: 'Tenant', nicho: null, status: 'active', createdAt: new Date() })),
    },
    membership: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existe = memberships.find(
          (m) => m.identityId === where.identityId_tenantId.identityId && m.tenantId === where.identityId_tenantId.tenantId,
        );
        if (existe) return existe;
        memberships.push({ ...create });
        return create;
      }),
    },
    withTenant: jest.fn(async (tenantId: string, work: (tx: unknown) => Promise<unknown>) => {
      if (!usersByTenant.has(tenantId)) usersByTenant.set(tenantId, []);
      const users = usersByTenant.get(tenantId)!;
      return work({
        user: {
          findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.identityId === where.identityId) ?? null),
          create: jest.fn(async ({ data }: any) => { const u = { id: `user-${users.length}`, ...data }; users.push(u); return u; }),
        },
        $executeRaw: jest.fn(async (...parts: any[]) => { auditados.push({ tenantId, acao: 'audit' }); return 1; }),
      });
    }),
  } as unknown as PrismaService;

  const tenants = {
    provision: jest.fn(async (input: any) => ({ id: 'tenant-novo', nome: input.empresa })),
  } as unknown as TenantsService;

  const crm = {
    overview: jest.fn(async (tenantId: string) => ({
      kpis: { contatos: 10, negocios: 3, ganho: 1000 },
      atividades: [{ createdAt: new Date('2026-01-01') }],
    })),
  } as unknown as CrmService;

  const emitidos: any[] = [];
  const tokens = {
    signAccess: jest.fn((claims: any) => `access-${claims.tenant_id}`),
    issueRefresh: jest.fn(async (identityId: string, tenantId: string) => { emitidos.push({ identityId, tenantId }); return `refresh-${tenantId}`; }),
  } as unknown as TokenService;

  return { svc: new AgencyService(prisma, tenants, crm, tokens), prisma, tenants, crm, tokens, memberships, usersByTenant, auditados, criados, emitidos, clientAccounts };
}

describe('AgencyService — fronteira de autorização (identidade não pode virar ID cru)', () => {
  it('identidade sem AgencyMember é recusada em toda operação de agência', async () => {
    const a = ambiente({ membro: null });
    await expect(a.svc.listarClientes('quem-quer')).rejects.toThrow(ForbiddenException);
    await expect(a.svc.listarMembros('quem-quer')).rejects.toThrow(ForbiddenException);
    await expect(a.svc.detalheCliente('quem-quer', 'client-1')).rejects.toThrow(ForbiddenException);
    await expect(a.svc.criarCliente('quem-quer', { nome: 'X' })).rejects.toThrow(ForbiddenException);
    await expect(a.svc.ativarCliente('quem-quer', 'client-1')).rejects.toThrow(ForbiddenException);
    expect(await a.svc.meuContexto('quem-quer')).toBeNull(); // única exceção: contexto null, não exceção (cliente direto)
  });

  it('cliente de OUTRA agência: nem aparece na lista, nem é encontrado, nem é ativável — mesmo sabendo o ID certo', async () => {
    const a = ambiente({
      clientAccounts: [{ id: 'client-1', agencyId: AGENCIA_A, tenantId: TENANT_1, displayName: 'Meu cliente', status: 'active', isDemo: true, createdAt: new Date() }],
    });
    const clienteDaAgenciaB = 'client-da-agencia-b';

    const lista = await a.svc.listarClientes('ident-pedro');
    expect(lista.map((c) => c.id)).not.toContain(clienteDaAgenciaB);

    await expect(a.svc.detalheCliente('ident-pedro', clienteDaAgenciaB)).rejects.toThrow(NotFoundException);
    await expect(a.svc.ativarCliente('ident-pedro', clienteDaAgenciaB)).rejects.toThrow(ForbiddenException);
    expect(a.memberships).toHaveLength(0); // nenhuma membership foi criada por engano
  });

  it('membro comum SEM restrição configurada vê tudo (V1 — acesso global default)', async () => {
    const a = ambiente({ membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } } });
    const lista = await a.svc.listarClientes('ident-membro');
    expect(lista.map((c) => c.id).sort()).toEqual(['client-1', 'client-2']);
  });

  it('membro comum COM restrição só vê os clientes liberados', async () => {
    const a = ambiente({
      membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } },
      restricoes: [{ agencyMemberId: 'membro-2', clientAccountId: 'client-1' }],
    });
    const lista = await a.svc.listarClientes('ident-membro');
    expect(lista.map((c) => c.id)).toEqual(['client-1']);
    await expect(a.svc.ativarCliente('ident-membro', 'client-2')).rejects.toThrow(ForbiddenException);
  });

  it('criarCliente: membro comum é recusado, só owner/admin cria', async () => {
    const a = ambiente({ membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } } });
    await expect(a.svc.criarCliente('ident-membro', { nome: 'Novo' })).rejects.toThrow(ForbiddenException);
    expect(a.tenants.provision).not.toHaveBeenCalled();
  });

  it('criarCliente: owner cria tenant novo (provisioning normal) e vincula à SUA agência', async () => {
    const a = ambiente();
    const cliente = await a.svc.criarCliente('ident-pedro', { nome: 'Cliente Novo' });
    expect(a.tenants.provision).toHaveBeenCalledWith(expect.objectContaining({ empresa: 'Cliente Novo' }));
    expect(cliente).toMatchObject({ agencyId: AGENCIA_A, tenantId: 'tenant-novo', displayName: 'Cliente Novo' });
  });

  it('cliente pausado/arquivado não pode ser ativado', async () => {
    const a = ambiente({
      clientAccounts: [{ id: 'client-1', agencyId: AGENCIA_A, tenantId: TENANT_1, displayName: 'Pausado', status: 'paused', isDemo: true, createdAt: new Date() }],
    });
    await expect(a.svc.ativarCliente('ident-pedro', 'client-1')).rejects.toThrow(ForbiddenException);
  });
});

describe('AgencyService.ativarCliente — troca de contexto sem impersonation', () => {
  it('primeira ativação provisiona Membership+User lazy; a SEGUNDA não duplica (idempotente)', async () => {
    const a = ambiente();
    await a.svc.ativarCliente('ident-pedro', 'client-1');
    expect(a.memberships).toHaveLength(1);
    expect(a.usersByTenant.get(TENANT_1)).toHaveLength(1);

    await a.svc.ativarCliente('ident-pedro', 'client-1'); // mesma identidade, mesmo cliente, de novo
    expect(a.memberships).toHaveLength(1); // upsert não duplicou
    expect(a.usersByTenant.get(TENANT_1)).toHaveLength(1); // user reaproveitado, não recriado
  });

  it('o token emitido é sempre do TENANT DO CLIENTE, nunca de outro', async () => {
    const a = ambiente();
    const r = await a.svc.ativarCliente('ident-pedro', 'client-2', 'ua-teste');
    expect(a.tokens.signAccess).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_2 }));
    expect(a.emitidos[0]).toMatchObject({ identityId: 'ident-pedro', tenantId: TENANT_2 });
    expect(r.user.tenantId).toBe(TENANT_2);
  });

  it('owner/admin da agência entra como admin no tenant do cliente; membro comum entra como member', async () => {
    const owner = ambiente();
    await owner.svc.ativarCliente('ident-pedro', 'client-1');
    expect(owner.memberships[0].role).toBe('admin');

    const membroComum = ambiente({ membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } } });
    await membroComum.svc.ativarCliente('ident-membro', 'client-1');
    expect(membroComum.memberships[0].role).toBe('member');
  });
});

describe('AgencyService.overview — agregação nunca cruza tenants numa query só', () => {
  it('chama crm.overview() UMA VEZ POR TENANT (nunca uma query cross-tenant) e soma em memória', async () => {
    const a = ambiente();
    const ov = await a.svc.overview('ident-pedro');
    expect(a.crm.overview).toHaveBeenCalledWith(TENANT_1);
    expect(a.crm.overview).toHaveBeenCalledWith(TENANT_2);
    expect(a.crm.overview).toHaveBeenCalledTimes(2);
    expect(ov.totalClientes).toBe(2);
    expect(ov.negociosAbertosTotal).toBe(6); // 3 + 3, dos mocks tenant-scoped
  });
});
