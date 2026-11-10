import { LeadsService } from './leads.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** Prisma falso com uma "tabela" de contatos em memória. */
function fakePrisma(contatos: any[]) {
  const criados: any[] = [];
  const atualizados: any[] = [];
  const atividades: any[] = [];
  const tx: any = {
    // helper de telefone busca via SQL normalizado (BUG-012): o fake espelha
    // o `right(só_dígitos, 8)` que o Postgres faz
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...p: unknown[]) => {
      const cauda = p[1] as string;
      return contatos.filter((c: any) => c.telefone && String(c.telefone).replace(/\D/g, '').slice(-8) === cauda).map((c: any) => ({ id: c.id })).slice(0, 1);
    }),
    contact: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.email) return contatos.find((c) => c.email?.toLowerCase() === where.email.equals.toLowerCase()) ?? null;
        return null;
      }),
      findMany: jest.fn(async () => contatos.filter((c) => c.telefone)),
      findUnique: jest.fn(async ({ where }: any) => contatos.find((c) => c.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { criados.push(data); return { id: 'novo-contato' }; }),
      update: jest.fn(async (args: any) => { atualizados.push(args); return {}; }),
    },
    activity: { create: jest.fn(async ({ data }: any) => { atividades.push(data); return {}; }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  const publicados: { evento: string; dados: unknown }[] = [];
  const eventos = { publicar: (_t: string, evento: string, dados: unknown) => { publicados.push({ evento, dados }); } } as unknown as DomainEventsService;
  return { prisma, eventos, publicados, criados, atualizados, atividades, tx };
}

describe('LeadsService (D1 — lead externo → contato)', () => {
  it('cria contato quando o lead é novo', async () => {
    const f = fakePrisma([]);
    const svc = new LeadsService(f.prisma, f.eventos);
    const r = await svc.upsertFromLead(TENANT, { nome: 'Ana Lead', email: 'ana@x.com', telefone: '+55 11 90000-1111', origem: 'Meta Lead Ads', externalId: 'lead-1' });

    expect(r.criado).toBe(true);
    expect(f.criados[0]).toMatchObject({ nome: 'Ana Lead', email: 'ana@x.com', tag: 'Lead' });
    // rastreabilidade da origem fica no contato
    expect(f.criados[0].camposCustom).toMatchObject({ lead_origem: 'Meta Lead Ads', lead_external_id: 'lead-1' });
  });

  it('BUG-027: contato novo grava a coluna `origem` (é dela que o outbox monta o gatilho)', async () => {
    const f = fakePrisma([]);
    await new LeadsService(f.prisma, f.eventos).upsertFromLead(TENANT, { nome: 'Bia', email: 'bia@x.com', origem: 'Meta Ads', externalId: 'lead-o' });
    expect(f.criados[0]).toMatchObject({ origem: 'Meta Ads' });
  });

  it('NÃO duplica: e-mail já existente enriquece o contato', async () => {
    const f = fakePrisma([{ id: 'c1', nome: 'Ana', email: 'ana@x.com', telefone: null, camposCustom: {} }]);
    const svc = new LeadsService(f.prisma, f.eventos);
    const r = await svc.upsertFromLead(TENANT, { nome: 'Ana Lead', email: 'ANA@x.com', telefone: '+55 11 90000-1111', origem: 'Meta Lead Ads', externalId: 'lead-2' });

    expect(r).toEqual({ contactId: 'c1', criado: false });
    expect(f.criados).toHaveLength(0);
    // preenche o telefone que faltava, sem sobrescrever o que já havia
    expect(f.atualizados[0].data.telefone).toBe('+55 11 90000-1111');
  });

  it('reentrega do MESMO lead não cria contato novo (idempotência)', async () => {
    const f = fakePrisma([{ id: 'c1', nome: 'Ana', email: 'ana@x.com', telefone: null, camposCustom: {} }]);
    const svc = new LeadsService(f.prisma, f.eventos);
    const lead = { nome: 'Ana', email: 'ana@x.com', origem: 'Meta Lead Ads', externalId: 'lead-3' };
    await svc.upsertFromLead(TENANT, lead);
    await svc.upsertFromLead(TENANT, lead);
    expect(f.criados).toHaveLength(0);
  });

  it('dedupe por telefone ignora formatação (+55 11 99812-4410 == 5511998124410)', async () => {
    const f = fakePrisma([{ id: 'c9', nome: 'Marina', email: null, telefone: '+55 11 99812-4410', camposCustom: {} }]);
    const svc = new LeadsService(f.prisma, f.eventos);
    const r = await svc.upsertFromLead(TENANT, { nome: 'Marina A', telefone: '5511998124410', origem: 'Meta Lead Ads', externalId: 'lead-4' });
    expect(r).toEqual({ contactId: 'c9', criado: false });
  });

  it('lead sem nome não vira contato anônimo: usa e-mail/telefone como nome', async () => {
    const f = fakePrisma([]);
    const svc = new LeadsService(f.prisma, f.eventos);
    await svc.upsertFromLead(TENANT, { email: 'sem.nome@x.com', origem: 'Meta Lead Ads', externalId: 'lead-5' });
    expect(f.criados[0].nome).toBe('sem.nome@x.com');
  });

  it('toda transação abre com o tenant da sessão (isolamento)', async () => {
    const f = fakePrisma([]);
    const svc = new LeadsService(f.prisma, f.eventos);
    await svc.upsertFromLead(TENANT, { nome: 'X', email: 'x@x.com', origem: 'Meta Lead Ads', externalId: 'l' });
    expect((f.prisma.withTenant as jest.Mock).mock.calls.every((c) => c[0] === TENANT)).toBe(true);
  });
});
