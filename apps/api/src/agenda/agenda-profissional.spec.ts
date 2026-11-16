import { AgendaService } from './agenda.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CaixaService } from '../financeiro/caixa.service';

/** Agenda por profissional (db/071): lista enriquecida e importação com serviço, profissional e cliente sem telefone. */
const T = '11111111-1111-4111-8111-111111111111';

function montar() {
  const criados: Record<string, unknown>[] = [];
  const contatos: { id: string; nome: string; camposCustom: Record<string, unknown> }[] = [];
  const catalogo: { tabela: string; nome: string }[] = [];
  const tx = {
    agendaCompromisso: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => [
        { id: 'a1', contactId: 'c1', profissionalId: 'p1', servicoId: 's1', titulo: 'Mao', inicio: new Date(), fim: new Date(), status: 'agendado' },
        { id: 'a2', contactId: null, profissionalId: null, servicoId: null, titulo: 'Reunião', inicio: new Date(), fim: new Date(), status: 'agendado' },
      ]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c = { id: `ag${criados.length + 1}`, ...data };
        criados.push(c);
        return c;
      }),
    },
    contact: {
      findMany: jest.fn(async () => [{ id: 'c1', nome: 'Ana Lima', telefone: '18999990000' }]),
      findFirst: jest.fn(async ({ where }: { where: { camposCustom: { equals: string } } }) => contatos.find((c) => c.camposCustom.ref_externa === where.camposCustom.equals) ?? null),
      create: jest.fn(async ({ data }: { data: { nome: string; camposCustom: Record<string, unknown> } }) => {
        const c = { id: `ct${contatos.length + 1}`, nome: data.nome, camposCustom: data.camposCustom };
        contatos.push(c);
        return { id: c.id };
      }),
    },
    profissional: { findMany: jest.fn(async () => [{ id: 'p1', nome: 'Carmelita' }]) },
    servico: { findMany: jest.fn(async () => [{ id: 's1', nome: 'Mão' }]) },
    $queryRaw: jest.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      const sql = q.join('?');
      if (sql.includes('FROM memberships')) return [];
      const m = sql.match(/INSERT INTO (servicos|profissionais)/);
      if (m) {
        catalogo.push({ tabela: m[1], nome: String(v[1]) });
        return [{ id: `${m[1]}-${String(v[1]).toLowerCase()}` }];
      }
      return [];
    }),
    $executeRaw: jest.fn(async () => 1),
    $executeRawUnsafe: jest.fn(async (_sql: string) => 0),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const caixa = { sincronizarCompromisso: jest.fn(async () => null) } as unknown as CaixaService;
  return { svc: new AgendaService(prisma, new ConfigService(), caixa), tx, criados, contatos, catalogo };
}

describe('AgendaService.listar (agenda clean)', () => {
  it('traz cliente, telefone, profissional e serviço numa consulta por tipo (sem N+1)', async () => {
    const { svc, tx } = montar();
    const r = (await svc.listar(T, {})) as Record<string, unknown>[];
    expect(r[0]).toMatchObject({ contatoNome: 'Ana Lima', contatoTelefone: '18999990000', profissionalNome: 'Carmelita', servicoNome: 'Mão' });
    expect(r[1]).toMatchObject({ contatoNome: null, profissionalNome: null, servicoNome: null });
    expect(tx.contact.findMany).toHaveBeenCalledTimes(1);
    expect(tx.profissional.findMany).toHaveBeenCalledTimes(1);
  });

  it('filtra por profissional', async () => {
    const { svc, tx } = montar();
    await svc.listar(T, { profissionalId: 'p1' });
    expect(tx.agendaCompromisso.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ profissionalId: 'p1' }) }));
  });
});

describe('AgendaService.importar com serviço, profissional e cliente sem telefone', () => {
  const base = { data: '20/11/2026', hora: '10:00', status: 'Agendado' };

  it('título = serviço; serviço e profissional criados uma vez e reaproveitados; cliente criado uma vez pela referência', async () => {
    const { svc, criados, contatos, catalogo } = montar();
    const r = await svc.importar(T, 'u1', [
      { ...base, servico: 'Mão', profissional: 'Carmelita Ribeiro', contatoNome: 'Jana', contatoRef: 'avec:140' },
      { ...base, hora: '11:00', servico: 'mão ', profissional: 'carmelita ribeiro', contatoNome: 'Jana', contatoRef: 'avec:140' },
    ]);
    expect(r).toMatchObject({ criados: 2, erros: [] });
    expect(catalogo.filter((c) => c.tabela === 'servicos')).toHaveLength(1);
    expect(catalogo.filter((c) => c.tabela === 'profissionais')).toHaveLength(1);
    expect(contatos).toHaveLength(1);
    expect(criados[0]).toMatchObject({ titulo: 'Mão', servicoId: 'servicos-mão', profissionalId: 'profissionais-carmelita ribeiro', contactId: 'ct1' });
    expect(criados[1]).toMatchObject({ contactId: 'ct1', servicoId: 'servicos-mão' });
  });

  it('linha com erro não deixa id de catálogo no cache (savepoint desfeito)', async () => {
    const { svc, catalogo, tx } = montar();
    tx.agendaCompromisso.create.mockRejectedValueOnce(new Error('falha ao gravar'));
    const r = await svc.importar(T, 'u1', [
      { ...base, servico: 'Escova' },
      { ...base, hora: '11:00', servico: 'Escova' },
    ]);
    expect(r).toMatchObject({ criados: 1, erros: [{ linha: 1, motivo: 'falha ao gravar' }] });
    // a 1ª linha falhou DEPOIS do INSERT do serviço (savepoint desfeito): a 2ª precisa inserir de novo
    expect(catalogo.filter((c) => c.nome === 'Escova')).toHaveLength(2);
  });

  it('dedupe considera o profissional e neutraliza também eventos de contato', async () => {
    const { svc, tx } = montar();
    await svc.importar(T, 'u1', [{ ...base, servico: 'Pé', profissional: 'Mel' }]);
    expect(tx.agendaCompromisso.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ profissionalId: 'profissionais-mel' }) }));
    const sqls = tx.$executeRaw.mock.calls.map((c: unknown[]) => (c[0] as TemplateStringsArray).join('?'));
    expect(sqls.some((s: string) => s.includes("kind LIKE 'contact.%'"))).toBe(true);
  });
});
