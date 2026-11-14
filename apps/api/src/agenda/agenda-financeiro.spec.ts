import { AgendaService } from './agenda.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CaixaService } from '../financeiro/caixa.service';

/** Integração agenda ↔ financeiro (db/070): concluir, editar e importar. */
const T = '11111111-1111-4111-8111-111111111111';
const PROF = '22222222-2222-4222-8222-222222222222';

function montar(existentes: Record<string, unknown>[] = []) {
  const criados: Record<string, unknown>[] = [];
  const tx = {
    agendaCompromisso: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id) return { id: where.id, status: 'agendado', inicio: new Date('2026-11-20T13:00:00Z'), fim: new Date('2026-11-20T14:00:00Z'), responsavelId: PROF, titulo: 'Corte' };
        return existentes.find((e) => +(e.inicio as Date) === +(where.inicio as Date)) ?? null;
      }),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c = { id: `ag${criados.length + 1}`, ...data };
        criados.push(c);
        return c;
      }),
      update: jest.fn(async (a: { where: { id: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>> => ({ id: a.where.id, titulo: 'Corte', responsavelId: PROF, valorCentavos: 8000, contactId: null, inicio: new Date('2026-11-20T13:00:00Z'), ...a.data })),
    },
    membership: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
    // membros (importação) e busca de contato por telefone (sem achar).
    $queryRaw: jest.fn(async (q: TemplateStringsArray) => (q.join('').includes('FROM memberships') ? [{ identityId: PROF, nome: 'Ana Souza', email: 'ana@salao.com' }] : [])),
    $executeRaw: jest.fn(async () => 1),
    $executeRawUnsafe: jest.fn(async (_sql: string) => 0),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const sincronizar = jest.fn(async () => null);
  const caixa = { sincronizarCompromisso: sincronizar } as unknown as CaixaService;
  return { svc: new AgendaService(prisma, new ConfigService(), caixa), tx, sincronizar, criados };
}

describe('AgendaService ↔ caixa', () => {
  it('concluir chama a sincronização do caixa NA MESMA transação', async () => {
    const { svc, tx, sincronizar } = montar();
    await svc.atualizarStatus(T, 'u1', 'ag1', 'concluido');
    expect(sincronizar).toHaveBeenCalledWith(tx, T, expect.objectContaining({ id: 'ag1', status: 'concluido' }));
  });

  it('cancelar também sincroniza (estorna a entrada se havia)', async () => {
    const { svc, sincronizar } = montar();
    await svc.atualizarStatus(T, 'u1', 'ag1', 'cancelado');
    expect(sincronizar).toHaveBeenCalledWith(expect.anything(), T, expect.objectContaining({ status: 'cancelado' }));
  });

  it('editar valor de atendimento concluído acompanha no caixa; de agendado, não', async () => {
    const { svc, tx, sincronizar } = montar();
    tx.agendaCompromisso.update.mockImplementationOnce(async (a) => ({ id: a.where.id, titulo: 'Corte', responsavelId: PROF, contactId: null, inicio: new Date(), status: 'concluido', ...a.data }));
    await svc.atualizar(T, 'u1', 'ag1', { valorCentavos: 9000 });
    expect(sincronizar).toHaveBeenCalledTimes(1);
    tx.agendaCompromisso.update.mockImplementationOnce(async (a) => ({ id: a.where.id, titulo: 'Corte', responsavelId: PROF, contactId: null, inicio: new Date(), status: 'agendado', ...a.data }));
    await svc.atualizar(T, 'u1', 'ag1', { valorCentavos: 9500 });
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });
});

describe('AgendaService.importar (Avec/planilha)', () => {
  const linhas = [
    { titulo: 'Corte', data: '20/11/2026', hora: '10:00', responsavel: 'Ana', valor: '80,00', status: 'Finalizado' },
    { titulo: 'Escova', inicio: '21/11/2026 15:30', duracaoMin: '30', responsavel: 'Fulana', contatoTelefone: '(11) 98888-7777' },
    { titulo: 'Data ruim', data: '31/02/2026' },
    { titulo: 'Valor ruim', data: '22/11/2026', valor: '-10' },
  ];

  it('cria no fuso local, concluído vai pro caixa sem comissão por padrão, erros e avisos por linha do arquivo', async () => {
    const { svc, criados, sincronizar, tx } = montar();
    const r = await svc.importar(T, 'u1', linhas, {}, 2);
    expect(r).toMatchObject({ total: 4, criados: 2, ignorados: 0 });
    expect(r.erros).toEqual([
      { linha: 4, motivo: expect.stringContaining('data inválida') },
      { linha: 5, motivo: expect.stringContaining('valor inválido') },
    ]);
    expect(r.avisos.map((a) => a.linha)).toEqual([3, 3]); // cliente não achado + profissional não achado
    expect(criados[0]).toMatchObject({ titulo: 'Corte', status: 'concluido', valorCentavos: 8000, responsavelId: PROF, inicio: new Date('2026-11-20T13:00:00Z') });
    expect(criados[1]).toMatchObject({ responsavelId: null, inicio: new Date('2026-11-21T18:30:00Z'), fim: new Date('2026-11-21T19:00:00Z') });
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(sincronizar).toHaveBeenCalledWith(tx, T, expect.objectContaining({ titulo: 'Corte' }), { gerarComissao: false });
  });

  it('importação não dispara automação: neutraliza os eventos appointment.* da transação', async () => {
    const { svc, tx } = montar();
    await svc.importar(T, 'u1', [linhas[0]]);
    const sqls = tx.$executeRaw.mock.calls.map((c: unknown[]) => (c[0] as TemplateStringsArray).join('?'));
    expect(sqls.some((s: string) => s.includes('UPDATE outbox_events') && s.includes("kind LIKE 'appointment.%'"))).toBe(true);
  });

  it('reimportar o mesmo agendamento é ignorado', async () => {
    const { svc, criados } = montar([{ id: 'ja', inicio: new Date('2026-11-20T13:00:00Z') }]);
    const r = await svc.importar(T, 'u1', [linhas[0]], { gerarComissoes: true });
    expect(r).toMatchObject({ criados: 0, ignorados: 1 });
    expect(criados).toHaveLength(0);
  });

  it('com gerarComissoes, o concluído gera comissão', async () => {
    const { svc, sincronizar } = montar();
    await svc.importar(T, 'u1', [linhas[0]], { gerarComissoes: true });
    expect(sincronizar).toHaveBeenCalledWith(expect.anything(), T, expect.anything(), { gerarComissao: true });
  });
});
