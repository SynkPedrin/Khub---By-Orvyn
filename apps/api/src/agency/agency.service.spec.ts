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
  /** Outros membros da mesma agência (alvos de atualizarMembro). */
  outros?: Record<string, unknown>[];
  clientAccounts?: Record<string, unknown>[];
  restricoes?: Record<string, unknown>[];
  memberships?: Record<string, unknown>[];
  enderecos?: Record<string, string | null>;
} = {}) {
  const membro = opts.membro === undefined
    ? { id: 'membro-1', agencyId: AGENCIA_A, identityId: 'ident-pedro', role: 'owner', agency: { id: AGENCIA_A, name: 'Agência A', slug: 'agencia-a', isDemo: true } }
    : opts.membro;
  const clientAccounts = opts.clientAccounts ?? [
    { id: 'client-1', agencyId: AGENCIA_A, tenantId: TENANT_1, displayName: 'Cliente 1', status: 'active', isDemo: true, createdAt: new Date() },
    { id: 'client-2', agencyId: AGENCIA_A, tenantId: TENANT_2, displayName: 'Cliente 2', status: 'active', isDemo: true, createdAt: new Date() },
  ];
  let restricoes: any[] = [...(opts.restricoes ?? [])];
  const memberships: any[] = [...(opts.memberships ?? [])];
  const membros: any[] = [...(membro ? [membro] : []), ...(opts.outros ?? [])];
  const prefs: any[] = [];
  const sessoesRevogadas: { identityId: string; tenantIds: string[] }[] = [];
  const casa = (m: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as any)) return (v as any).in.includes(m[k]);
    return m[k] === v;
  });
  const usersByTenant = new Map<string, any[]>();
  const auditados: { tenantId: string; acao: string }[] = [];
  const criados: any[] = [];

  const prisma = {
    agencyMember: {
      findFirst: jest.fn(async ({ where }: any) => membros.find((m) => (!where.identityId || m.identityId === where.identityId) && (!where.id || m.id === where.id)) ?? null),
      findMany: jest.fn(async () => membros),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => { const m = membros.find((x) => x.id === where.id); if (!m) throw new Error('não existe'); return m; }),
      update: jest.fn(async ({ where, data }: any) => { const m = membros.find((x) => x.id === where.id); Object.assign(m, data); return m; }),
      delete: jest.fn(async ({ where }: any) => { const i = membros.findIndex((x) => x.id === where.id); return membros.splice(i, 1)[0]; }),
    },
    agencyMemberClientPref: {
      findMany: jest.fn(async ({ where }: any) => prefs.filter((p) => p.agencyMemberId === where.agencyMemberId)),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.agencyMemberId_clientAccountId;
        const e = prefs.find((p) => p.agencyMemberId === k.agencyMemberId && p.clientAccountId === k.clientAccountId);
        if (e) return Object.assign(e, update);
        const n = { fixado: false, ultimoAcessoEm: null, ...create };
        prefs.push(n);
        return n;
      }),
    },
    refreshToken: {
      updateMany: jest.fn(async ({ where }: any) => { sessoesRevogadas.push({ identityId: where.identityId, tenantIds: where.tenantId.in }); return { count: where.tenantId.in.length }; }),
    },
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
    agencyClientAccount: {
      findMany: jest.fn(async ({ where }: any) => clientAccounts.filter((c) => c.agencyId === where.agencyId && c.status !== 'archived')),
      create: jest.fn(async ({ data }: any) => { const c = { id: `client-novo-${criados.length}`, createdAt: new Date(), ...data }; criados.push(c); return c; }),
    },
    agencyMemberClientAccess: {
      findMany: jest.fn(async ({ where }: any) => restricoes.filter((r: any) => r.agencyMemberId === where.agencyMemberId)),
      deleteMany: jest.fn(async ({ where }: any) => { restricoes = restricoes.filter((r) => r.agencyMemberId !== where.agencyMemberId); return { count: 1 }; }),
      createMany: jest.fn(async ({ data }: any) => { restricoes.push(...data); return { count: data.length }; }),
    },
    identity: {
      findMany: jest.fn(async () => [{ id: 'ident-pedro', email: 'pedro@agencia.com' }]),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'ident-pedro', email: 'pedro@agencia.com' })),
    },
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, nome: 'Tenant', nicho: null, status: 'active', createdAt: new Date() })),
      findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, endereco: opts.enderecos?.[id] ?? null }))),
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
      update: jest.fn(async ({ where, data }: any) => {
        const m = memberships.find((x) => x.identityId === where.identityId_tenantId.identityId && x.tenantId === where.identityId_tenantId.tenantId);
        return Object.assign(m, data);
      }),
      findMany: jest.fn(async ({ where }: any) => memberships.filter((m) => casa(m, where))),
      updateMany: jest.fn(async ({ where, data }: any) => { const xs = memberships.filter((m) => casa(m, where)); xs.forEach((m) => Object.assign(m, data)); return { count: xs.length }; }),
      deleteMany: jest.fn(async ({ where }: any) => { const antes = memberships.length; for (let i = memberships.length - 1; i >= 0; i--) if (casa(memberships[i], where)) memberships.splice(i, 1); return { count: antes - memberships.length }; }),
    },
    withTenant: jest.fn(async (tenantId: string, work: (tx: unknown) => Promise<unknown>) => {
      if (!usersByTenant.has(tenantId)) usersByTenant.set(tenantId, []);
      const users = usersByTenant.get(tenantId)!;
      return work({
        user: {
          findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.identityId === where.identityId) ?? null),
          create: jest.fn(async ({ data }: any) => { const u = { id: `user-${users.length}`, ...data }; users.push(u); return u; }),
          update: jest.fn(async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data)),
          updateMany: jest.fn(async ({ where, data }: any) => { users.filter((u) => u.identityId === where.identityId).forEach((u) => Object.assign(u, data)); return { count: 1 }; }),
          deleteMany: jest.fn(async ({ where }: any) => { for (let i = users.length - 1; i >= 0; i--) if (users[i].identityId === where.identityId) users.splice(i, 1); return { count: 1 }; }),
        },
        conversation: { updateMany: jest.fn(async () => ({ count: 0 })) },
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

  return { svc: new AgencyService(prisma, tenants, crm, tokens), prisma, tenants, crm, tokens, memberships, usersByTenant, auditados, criados, emitidos, clientAccounts, prefs, sessoesRevogadas, restricoes: () => restricoes };
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

const MEMBRO_X = { id: 'membro-x', agencyId: AGENCIA_A, identityId: 'ident-x', role: 'admin', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } };

describe('AgencyService.seletor — seletor de subcontas (estilo GHL)', () => {
  it('lista leve: nome, endereço, fixado e último acesso, SEM métricas de CRM por cliente', async () => {
    const a = ambiente({ enderecos: { [TENANT_1]: 'Av. Umuarama, 100 - Araçatuba, SP' } });
    await a.svc.fixar('ident-pedro', 'client-2', true);
    await a.svc.ativarCliente('ident-pedro', 'client-1');
    const lista = await a.svc.seletor('ident-pedro');
    expect(lista).toEqual([
      expect.objectContaining({ id: 'client-1', nome: 'Cliente 1', endereco: 'Av. Umuarama, 100 - Araçatuba, SP', fixado: false, ultimoAcessoEm: expect.any(Date) }),
      expect.objectContaining({ id: 'client-2', endereco: null, fixado: true, ultimoAcessoEm: null }),
    ]);
    expect(a.crm.overview).not.toHaveBeenCalled();
  });

  it('respeita a restrição de subcontas do membro e recusa quem não é da agência', async () => {
    const a = ambiente({
      membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } },
      restricoes: [{ agencyMemberId: 'membro-2', clientAccountId: 'client-1' }],
    });
    expect((await a.svc.seletor('ident-membro')).map((c) => c.id)).toEqual(['client-1']);
    await expect(a.svc.seletor('quem-quer')).rejects.toThrow(ForbiddenException);
  });

  it('fixar: só subconta visível; a outra agência nem por ID', async () => {
    const a = ambiente({
      membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'member', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } },
      restricoes: [{ agencyMemberId: 'membro-2', clientAccountId: 'client-1' }],
    });
    await expect(a.svc.fixar('ident-membro', 'client-2', true)).rejects.toThrow(NotFoundException);
    await expect(a.svc.fixar('ident-membro', 'client-da-agencia-b', true)).rejects.toThrow(NotFoundException);
    await a.svc.fixar('ident-membro', 'client-1', true);
    await a.svc.fixar('ident-membro', 'client-1', false);
    expect(a.prefs).toEqual([expect.objectContaining({ agencyMemberId: 'membro-2', clientAccountId: 'client-1', fixado: false })]);
  });
});

describe('AgencyService — acesso nas subcontas segue o acesso na agência', () => {
  it('ativarCliente: vínculo da agência com papel antigo é corrigido para o papel atual', async () => {
    const a = ambiente({
      membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'viewer', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } },
      memberships: [{ identityId: 'ident-membro', tenantId: TENANT_1, role: 'admin', isDefault: false }],
    });
    a.usersByTenant.set(TENANT_1, [{ id: 'u1', identityId: 'ident-membro', role: 'admin', nome: 'M' }]);
    const r = await a.svc.ativarCliente('ident-membro', 'client-1');
    expect(a.memberships[0].role).toBe('viewer');
    expect(a.usersByTenant.get(TENANT_1)![0].role).toBe('viewer');
    expect(a.tokens.signAccess).toHaveBeenCalledWith(expect.objectContaining({ role: 'viewer' }));
    expect(r.user.role).toBe('viewer');
  });

  it('ativarCliente: o tenant PRÓPRIO da pessoa (isDefault) nunca é rebaixado', async () => {
    const a = ambiente({
      membro: { id: 'membro-2', agencyId: AGENCIA_A, identityId: 'ident-membro', role: 'viewer', agency: { id: AGENCIA_A, name: 'A', slug: 'a', isDemo: false } },
      memberships: [{ identityId: 'ident-membro', tenantId: TENANT_1, role: 'owner', isDefault: true }],
    });
    a.usersByTenant.set(TENANT_1, [{ id: 'u1', identityId: 'ident-membro', role: 'owner', nome: 'M' }]);
    await a.svc.ativarCliente('ident-membro', 'client-1');
    expect(a.memberships[0].role).toBe('owner');
    expect(a.usersByTenant.get(TENANT_1)![0].role).toBe('owner');
  });

  it('restringir subcontas tira o vínculo e as sessões das que saíram (o acesso cai na hora)', async () => {
    const a = ambiente({
      outros: [{ ...MEMBRO_X, role: 'member' }],
      memberships: [
        { identityId: 'ident-x', tenantId: TENANT_1, role: 'member', isDefault: false },
        { identityId: 'ident-x', tenantId: TENANT_2, role: 'member', isDefault: false },
      ],
    });
    a.usersByTenant.set(TENANT_2, [{ id: 'u2', identityId: 'ident-x', role: 'member' }]);
    const r = await a.svc.atualizarMembro('ident-pedro', 'membro-x', { clientIds: ['client-1'] });
    expect(r).toMatchObject({ ok: true, subcontasRevogadas: 1 });
    expect(a.memberships.map((m) => m.tenantId)).toEqual([TENANT_1]);
    expect(a.sessoesRevogadas).toEqual([{ identityId: 'ident-x', tenantIds: [TENANT_2] }]);
    expect(a.usersByTenant.get(TENANT_2)).toHaveLength(0);
  });

  it('rebaixar papel ajusta o papel nas subcontas que ele já tinha aberto', async () => {
    const a = ambiente({
      outros: [MEMBRO_X],
      memberships: [{ identityId: 'ident-x', tenantId: TENANT_1, role: 'admin', isDefault: false }, { identityId: 'ident-x', tenantId: 'tenant-proprio', role: 'owner', isDefault: true }],
    });
    a.usersByTenant.set(TENANT_1, [{ id: 'u1', identityId: 'ident-x', role: 'admin' }]);
    const r = await a.svc.atualizarMembro('ident-pedro', 'membro-x', { role: 'viewer' });
    expect(r).toMatchObject({ ok: true, papeisAjustados: 1, subcontasRevogadas: 0 });
    expect(a.memberships.find((m) => m.tenantId === TENANT_1)!.role).toBe('viewer');
    expect(a.memberships.find((m) => m.tenantId === 'tenant-proprio')!.role).toBe('owner');
    expect(a.usersByTenant.get(TENANT_1)![0].role).toBe('viewer');
  });

  it('removerMembro continua tirando todos os vínculos da agência e o próprio membro', async () => {
    const a = ambiente({
      outros: [{ ...MEMBRO_X, role: 'member' }],
      memberships: [{ identityId: 'ident-x', tenantId: TENANT_1, role: 'member', isDefault: false }, { identityId: 'ident-x', tenantId: 'tenant-proprio', role: 'owner', isDefault: true }],
    });
    const r = await a.svc.removerMembro('ident-pedro', 'membro-x');
    expect(r).toMatchObject({ ok: true, clientesRemovidos: 1 });
    expect(a.memberships.map((m) => m.tenantId)).toEqual(['tenant-proprio']);
    expect(a.prisma.agencyMember.delete).toHaveBeenCalledWith({ where: { id: 'membro-x' } });
  });
});

describe('AgencyService — banco sem db/064 (preferências do seletor)', () => {
  it('trocar de subconta e listar o seletor continuam funcionando', async () => {
    const a = ambiente();
    (a.prisma.agencyMemberClientPref.upsert as jest.Mock).mockRejectedValue(new Error('relation "agency_member_client_prefs" does not exist'));
    (a.prisma.agencyMemberClientPref.findMany as jest.Mock).mockRejectedValue(new Error('relation "agency_member_client_prefs" does not exist'));
    await expect(a.svc.ativarCliente('ident-pedro', 'client-1')).resolves.toMatchObject({ user: { tenantId: TENANT_1 } });
    expect((await a.svc.seletor('ident-pedro')).map((c) => c.fixado)).toEqual([false, false]);
  });
});
