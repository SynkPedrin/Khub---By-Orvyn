import { CrmService } from './crm.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { AvatarContatoService } from './messaging/avatar-contato.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** Barramento falso: registra o que seria publicado (socket + fila de gatilhos). */
function fakeEventos() {
  const publicados: { tenantId: string; evento: string; dados: unknown }[] = [];
  const svc = { publicar: (tenantId: string, evento: string, dados: unknown) => { publicados.push({ tenantId, evento, dados }); } } as unknown as DomainEventsService;
  return { svc, publicados };
}
const crm = (prisma: PrismaService, ev?: DomainEventsService) =>
  new CrmService(prisma, ev ?? fakeEventos().svc, { revalidarSeVencido: () => undefined } as unknown as AvatarContatoService);
const UUID = (n: number) => `100a1015-2cbd-44a7-872c-9b285ade0${String(n).padStart(3, '0')}`;

/** Lote de importação: TODOS com o mesmo created_at (o caso que quebrou de verdade). */
function contatosFake(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: UUID(i),
    nome: `Contato ${i}`,
    email: null,
    telefone: null,
    empresa: null,
    companyId: null,
    company: null,
    tag: 'Lead',
    valorEstimado: 0,
    ultimoContatoAt: null,
    createdAt: new Date('2026-07-14T12:04:54.347Z'),
  }));
}

function fakePrisma(rows: any[], captura: any[] = [], ancoraExiste = true) {
  return {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        contact: {
          findMany: jest.fn(async (args: any) => {
            captura.push(args);
            // simula o cursor nativo: corta depois da âncora
            if (args.cursor) {
              const i = rows.findIndex((r) => r.id === args.cursor.id);
              if (i === -1) return [];
              return rows.slice(i + (args.skip ?? 0)).slice(0, args.take);
            }
            return rows.slice(0, args.take);
          }),
          findUnique: jest.fn(async () => (ancoraExiste ? { id: 'x' } : null)),
        },
      }),
    ),
  } as unknown as PrismaService;
}

describe('CrmService.listContacts (D1 — paginação por cursor)', () => {
  it('devolve nextCursor quando há mais página, e null quando acaba', async () => {
    const p1 = await crm(fakePrisma(contatosFake(26))).listContacts(TENANT, { limit: 25 });
    expect(p1.items).toHaveLength(25); // a 26ª é sonda, não vaza pro cliente
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await crm(fakePrisma(contatosFake(10))).listContacts(TENANT, { limit: 25 });
    expect(p2.items).toHaveLength(10);
    expect(p2.nextCursor).toBeNull();
  });

  it('usa o cursor NATIVO do Prisma (comparação no banco), não timestamp serializado', async () => {
    const captura: any[] = [];
    const svc = crm(fakePrisma(contatosFake(26), captura));
    const p1 = await svc.listContacts(TENANT, { limit: 25 });
    await svc.listContacts(TENANT, { limit: 25, cursor: p1.nextCursor! });

    const args = captura[1];
    expect(args.cursor).toEqual({ id: UUID(24) }); // última linha da página 1
    expect(args.skip).toBe(1);                     // não repete a âncora
    // o WHERE não pode conter comparação de data feita em JS: timestamptz(6) tem
    // microssegundos que o Date trunca, e o lote inteiro sumiria da página 2
    expect(JSON.stringify(args.where ?? {})).not.toContain('createdAt');
  });

  it('lote com created_at idêntico continua paginando (regressão do bug de microssegundos)', async () => {
    const rows = contatosFake(9); // todos no mesmo instante, como o seed real
    const svc = crm(fakePrisma(rows));
    const p1 = await svc.listContacts(TENANT, { limit: 3 });
    const p2 = await svc.listContacts(TENANT, { limit: 3, cursor: p1.nextCursor! });

    expect(p1.items.map((c) => c.nome)).toEqual(['Contato 0', 'Contato 1', 'Contato 2']);
    expect(p2.items.map((c) => c.nome)).toEqual(['Contato 3', 'Contato 4', 'Contato 5']); // NÃO vazio
    expect(p1.items.map((c) => c.id).some((id) => p2.items.some((c) => c.id === id))).toBe(false);
  });

  it('cursor apontando para registro removido dá 400 — não finge que a lista acabou', async () => {
    const svc = crm(fakePrisma(contatosFake(5), [], false));
    const cursorDeOutraLinha = Buffer.from(`c1:${UUID(99)}`).toString('base64url');
    await expect(svc.listContacts(TENANT, { cursor: cursorDeOutraLinha })).rejects.toThrow(/cursor expirado/);
  });

  it('limit é limitado a 100 (cliente não derruba o banco pedindo tudo)', async () => {
    const captura: any[] = [];
    await crm(fakePrisma(contatosFake(200), captura)).listContacts(TENANT, { limit: 5000 });
    expect(captura[0].take).toBe(101); // 100 + sonda
  });

  it('cursor corrompido é rejeitado (400), não ignorado em silêncio', async () => {
    const svc = crm(fakePrisma(contatosFake(5)));
    await expect(svc.listContacts(TENANT, { cursor: 'lixo!!!' })).rejects.toThrow(/cursor inválido/);
  });

  it('busca e paginação convivem', async () => {
    const captura: any[] = [];
    const svc = crm(fakePrisma(contatosFake(26), captura));
    const p1 = await svc.listContacts(TENANT, { q: 'mar', limit: 25 });
    await svc.listContacts(TENANT, { q: 'mar', limit: 25, cursor: p1.nextCursor! });
    expect(JSON.stringify(captura[1].where)).toContain('mar'); // filtro de busca preservado
    expect(captura[1].cursor).toBeDefined();   // + cursor
  });
});

/** Prisma falso que registra a ordem: commit vs publicação no socket. */
function prismaDeals(ordem: string[]) {
  return {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => {
      const r = await work({
        stage: { findUnique: jest.fn(async () => ({ id: 's2', pipelineId: 'p1', nome: 'Proposta' })) },
        deal: {
          create: jest.fn(async () => ({ id: 'd-novo', titulo: 'Negócio' })),
          findUnique: jest.fn(async () => ({ id: 'd1', titulo: 'Negócio', stageId: 's1' })),
          updateMany: jest.fn(async () => ({ count: 1 })),
          update: jest.fn(async () => ({})),
          delete: jest.fn(async () => ({})),
        },
        contact: { findUnique: jest.fn(async () => ({ id: 'c1' })) },
        activity: { create: jest.fn(async () => ({})) },
      });
      ordem.push('commit');
      return r;
    }),
  } as unknown as PrismaService;
}

describe('CrmService — eventos de domínio (D2/E)', () => {
  it('publica deal.created DEPOIS do commit (quem ouvir e for ao banco tem que achar)', async () => {
    const ordem: string[] = [];
    const rt = { publicar: () => ordem.push('publicou') } as unknown as DomainEventsService;
    await crm(prismaDeals(ordem), rt).createDeal(TENANT, { titulo: 'Negócio', stageId: 's2' });
    expect(ordem).toEqual(['commit', 'publicou']);
  });

  it('deal.moved leva a etapa anterior (o Kanban remoto sabe de onde tirar o card)', async () => {
    const { svc: rt, publicados } = fakeEventos();
    await crm(prismaDeals([]), rt).moveDeal(TENANT, 'd1', 's2');
    expect(publicados).toEqual([{ tenantId: TENANT, evento: 'deal.moved', dados: { id: 'd1', stageId: 's2', stageAnterior: 's1' } }]);
  });

  it('todo evento sai com o tenant da sessão', async () => {
    const { svc: rt, publicados } = fakeEventos();
    const svc = crm(prismaDeals([]), rt);
    await svc.createDeal(TENANT, { titulo: 'X', stageId: 's2' });
    await svc.moveDeal(TENANT, 'd1', 's2');
    await svc.updateDeal(TENANT, 'd1', { valor: 10 });
    await svc.deleteDeal(TENANT, 'd1');
    expect(publicados.map((p) => p.evento)).toEqual(['deal.created', 'deal.moved', 'deal.updated', 'deal.deleted']);
    expect(publicados.every((p) => p.tenantId === TENANT)).toBe(true);
  });

  it('operação que FALHA não publica evento (nada de card fantasma)', async () => {
    const { svc: rt, publicados } = fakeEventos();
    const prismaQueFalha = {
      withTenant: jest.fn(async () => { throw new Error('stage inexistente'); }),
    } as unknown as PrismaService;
    await expect(crm(prismaQueFalha, rt).createDeal(TENANT, { titulo: 'X', stageId: 'inexistente' })).rejects.toThrow();
    expect(publicados).toHaveLength(0);
  });
});

/** Prisma falso pro contato de LGPD: um único contato, com tudo vazio por padrão. */
function prismaLgpd(contato: any = { id: 'c1', nome: 'Ana', company: null, consentimento: {} }) {
  const auditados: string[] = [];
  const atualizacoes: any[] = [];
  return {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        contact: {
          findUnique: jest.fn(async () => contato),
          update: jest.fn(async ({ data }: any) => { atualizacoes.push(data); return { ...contato, ...data }; }),
        },
        deal: { findMany: jest.fn(async () => []) },
        conversation: { findMany: jest.fn(async () => []) },
        task: { findMany: jest.fn(async () => []) },
        note: { findMany: jest.fn(async () => []) },
        activity: { findMany: jest.fn(async () => []) },
        $executeRaw: jest.fn(async (strings: TemplateStringsArray) => { auditados.push(strings.join('')); return 1; }),
      }),
    ),
    auditados,
    atualizacoes,
  } as unknown as PrismaService & { auditados: string[]; atualizacoes: any[] };
}

describe('CrmService — LGPD (RegrasNegocio §5)', () => {
  it('registrarConsentimento grava baseLegal + timestamp e audita (contato.consentimento_registrado)', async () => {
    const p = prismaLgpd();
    const r = await crm(p).registrarConsentimento(TENANT, 'c1', { baseLegal: 'consentimento', origem: 'formulario_site' });
    expect(r.consentimento).toMatchObject({ baseLegal: 'consentimento', origem: 'formulario_site' });
    expect(r.consentimento.consentidoEm).toBeTruthy();
    expect((p as any).auditados.join(' ')).toContain('contato.consentimento_registrado');
  });

  it('registrarConsentimento em contato inexistente: 404, não grava nada', async () => {
    const p = prismaLgpd(null);
    await expect(crm(p).registrarConsentimento(TENANT, 'inexistente', { baseLegal: 'consentimento' })).rejects.toThrow(/inexistente/);
    expect((p as any).atualizacoes).toHaveLength(0);
  });

  it('exportarDadosContato devolve o conteúdo das mensagens (não só metadados) e audita o acesso', async () => {
    const p = prismaLgpd({
      id: 'c1', nome: 'Ana', email: 'ana@x.com', company: null, consentimento: { baseLegal: 'consentimento' },
    });
    const r = await crm(p).exportarDadosContato(TENANT, 'c1');
    expect(r.titular).toMatchObject({ id: 'c1', nome: 'Ana', email: 'ana@x.com' });
    expect(r).toHaveProperty('conversas');
    expect(r).toHaveProperty('negocios');
    expect((p as any).auditados.join(' ')).toContain('contato.exportado');
  });
});
