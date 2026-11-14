import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CaixaService } from './caixa.service';
import { ComissoesService } from './comissoes.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Banco em memória com o pedaço da API do Prisma que o Financeiro usa. Os
 * índices únicos da db/070 (uma entrada por atendimento/cobrança, uma comissão
 * por entrada, uma linha por chave de importação) são reproduzidos aqui para
 * que um caminho que tente duplicar QUEBRE o teste, como quebraria no banco.
 */
type Row = Record<string, unknown> & { id: string };
let seq = 0;
const novoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function casa(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { equals?: string; mode?: string; in?: unknown[]; not?: unknown };
      if (c.equals !== undefined) return String(v ?? '').toLowerCase() === c.equals.toLowerCase();
      if (c.in) return c.in.includes(v);
      if ('not' in c) return v !== c.not;
      return true;
    }
    if (cond instanceof Date) return v instanceof Date && +v === +cond;
    return (v ?? null) === (cond ?? null);
  });
}

function tabela(unicos: string[][] = [], defaults: Record<string, unknown> = {}) {
  const rows: Row[] = [];
  const checaUnicos = (r: Row, ignorar?: Row) => {
    for (const cols of unicos) {
      if (cols.some((c) => r[c] == null)) continue;
      if (rows.some((o) => o !== ignorar && cols.every((c) => o[c] === r[c]))) {
        throw new Prisma.PrismaClientKnownRequestError(`unique ${cols.join(',')}`, { code: 'P2002', clientVersion: 'test' });
      }
    }
  };
  return {
    rows,
    findFirst: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.find((r) => casa(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: { where: Record<string, Record<string, unknown>> }) => {
      const chave = Object.values(where)[0];
      return rows.find((r) => casa(r, chave)) ?? null;
    }),
    findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => casa(r, where))),
    count: jest.fn(async () => rows.length),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const r = { id: novoId(), createdAt: new Date(), ...defaults, ...data } as Row;
      checaUnicos(r);
      rows.push(r);
      return r;
    }),
    createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) rows.push({ id: novoId(), ...defaults, ...d } as Row);
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.find((x) => casa(x, where));
      if (!r) throw new Error('registro inexistente');
      const novo = { ...r, ...data } as Row;
      checaUnicos(novo, r);
      Object.assign(r, data);
      return r;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const alvo = rows.filter((x) => casa(x, where));
      alvo.forEach((r) => Object.assign(r, data));
      return { count: alvo.length };
    }),
    delete: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const i = rows.findIndex((x) => casa(x, where));
      const [r] = rows.splice(i, 1);
      return r;
    }),
    deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const alvo = rows.filter((x) => casa(x, where));
      for (const r of alvo) rows.splice(rows.indexOf(r), 1);
      return { count: alvo.length };
    }),
    upsert: jest.fn(),
  };
}

const T = '11111111-1111-4111-8111-111111111111';
const PROF = '22222222-2222-4222-8222-222222222222';

function montar(percent: string | null = '30') {
  const categorias = tabela();
  const transacoes = tabela([['compromissoId'], ['cobrancaId'], ['chaveImportacao']], { status: 'pago', origem: 'manual', responsavelId: null });
  const comissoes = tabela([['transacaoId'], ['pagamentoTransacaoId']], { status: 'prevista', pagoEm: null, pagamentoTransacaoId: null });
  const equipe = tabela();
  if (percent !== null) equipe.rows.push({ id: 'cfg', tenantId: T, identityId: PROF, comissaoPercent: new Prisma.Decimal(percent) });
  // ON DELETE CASCADE de financeiro_comissoes.transacao_id.
  const deleteTx = transacoes.delete.getMockImplementation()!;
  transacoes.delete.mockImplementation(async (args) => {
    const r = await deleteTx(args);
    comissoes.rows.splice(0, comissoes.rows.length, ...comissoes.rows.filter((c) => c.transacaoId !== r.id));
    return r;
  });
  const membros = [{ identityId: PROF, nome: 'Ana Souza', email: 'ana@salao.com' }];
  const tx = {
    financeiroCategoria: categorias,
    financeiroTransacao: transacoes,
    financeiroComissao: comissoes,
    equipeComissao: equipe,
    membership: { findFirst: jest.fn(async ({ where }: { where: { identityId: string } }) => (membros.some((m) => m.identityId === where.identityId) ? { id: 'm' } : null)) },
    contact: { findFirst: jest.fn(async () => ({ id: 'c' })) },
    $executeRaw: jest.fn(async () => 1),
    $executeRawUnsafe: jest.fn(async (_sql: string) => 0),
    $queryRaw: jest.fn(async () => membros),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  return { caixa: new CaixaService(prisma), comissoesSvc: new ComissoesService(prisma), tx, transacoes, comissoes, categorias };
}

const compromisso = (extra: Partial<{ status: string; valorCentavos: number | null; responsavelId: string | null; titulo: string }> = {}) => ({
  id: 'ag-1',
  titulo: 'Corte + escova',
  valorCentavos: 15000,
  contactId: null,
  responsavelId: PROF,
  status: 'concluido',
  inicio: new Date('2026-11-13T17:30:00Z'),
  ...extra,
});

describe('Agenda → caixa (sincronizarCompromisso)', () => {
  it('concluir gera UMA entrada (categoria Serviços, dia local) + comissão arredondada meio para cima', async () => {
    const { caixa, tx, transacoes, comissoes } = montar('33.33');
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    expect(transacoes.rows).toHaveLength(1);
    const e = transacoes.rows[0];
    expect(e).toMatchObject({ tipo: 'entrada', origem: 'agenda', valorCentavos: 15000, compromissoId: 'ag-1', responsavelId: PROF, status: 'pago' });
    expect((e.dataCompetencia as Date).toISOString().slice(0, 10)).toBe('2026-11-13');
    expect(e.categoriaId).toBeTruthy();
    expect(comissoes.rows).toHaveLength(1);
    expect(comissoes.rows[0]).toMatchObject({ valorCentavos: 5000, baseCentavos: 15000, identityId: PROF });
    expect((comissoes.rows[0].competencia as Date).toISOString().slice(0, 10)).toBe('2026-11-01');
  });

  it('concluir duas vezes NÃO duplica entrada nem comissão', async () => {
    const { caixa, tx, transacoes, comissoes } = montar();
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    expect(transacoes.rows).toHaveLength(1);
    expect(comissoes.rows).toHaveLength(1);
  });

  it('sem valor ou não concluído: nada entra no caixa', async () => {
    const { caixa, tx, transacoes } = montar();
    await caixa.sincronizarCompromisso(tx as never, T, compromisso({ valorCentavos: null }));
    await caixa.sincronizarCompromisso(tx as never, T, compromisso({ status: 'confirmado' }));
    expect(transacoes.rows).toHaveLength(0);
  });

  it('valor editado depois de concluído: entrada e comissão prevista acompanham', async () => {
    const { caixa, tx, transacoes, comissoes } = montar('30');
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    await caixa.sincronizarCompromisso(tx as never, T, compromisso({ valorCentavos: 20000 }));
    expect(transacoes.rows).toHaveLength(1);
    expect(transacoes.rows[0].valorCentavos).toBe(20000);
    expect(comissoes.rows).toHaveLength(1);
    expect(comissoes.rows[0].valorCentavos).toBe(6000);
  });

  it('desfazer a conclusão estorna a entrada automática (e a comissão prevista)', async () => {
    const { caixa, tx, transacoes, comissoes } = montar();
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    await caixa.sincronizarCompromisso(tx as never, T, compromisso({ status: 'agendado' }));
    expect(transacoes.rows).toHaveLength(0);
    expect(comissoes.rows).toHaveLength(0);
  });

  it('comissão já paga trava mudança de valor e desfazer conclusão (409)', async () => {
    const { caixa, tx, comissoes } = montar();
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    comissoes.rows[0].status = 'paga';
    await expect(caixa.sincronizarCompromisso(tx as never, T, compromisso({ valorCentavos: 1 }))).rejects.toBeInstanceOf(ConflictException);
    await expect(caixa.sincronizarCompromisso(tx as never, T, compromisso({ status: 'cancelado' }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('importação de histórico sem comissão: gerarComissao=false', async () => {
    const { caixa, tx, comissoes, transacoes } = montar();
    await caixa.sincronizarCompromisso(tx as never, T, compromisso(), { gerarComissao: false });
    expect(transacoes.rows).toHaveLength(1);
    expect(comissoes.rows).toHaveLength(0);
  });

  it('profissional sem % configurada: entrada sem comissão', async () => {
    const { caixa, tx, comissoes } = montar(null);
    await caixa.sincronizarCompromisso(tx as never, T, compromisso());
    expect(comissoes.rows).toHaveLength(0);
  });
});

describe('Cobrança → caixa (sincronizarCobranca)', () => {
  const cob = (status: string) => ({ id: 'cob-1', descricao: 'Mensalidade', valorCentavos: 9990, contactId: null, status, pagoEm: new Date('2026-11-10T15:00:00Z') });

  it('paga duas vezes (manual + webhook) gera UMA entrada, na data do pagamento', async () => {
    const { caixa, tx, transacoes } = montar();
    await caixa.sincronizarCobranca(tx as never, T, cob('paga'));
    await caixa.sincronizarCobranca(tx as never, T, cob('paga'));
    expect(transacoes.rows).toHaveLength(1);
    expect(transacoes.rows[0]).toMatchObject({ origem: 'cobranca', valorCentavos: 9990, cobrancaId: 'cob-1' });
    expect((transacoes.rows[0].dataCompetencia as Date).toISOString().slice(0, 10)).toBe('2026-11-10');
  });

  it('cancelada depois de paga: a entrada automática sai', async () => {
    const { caixa, tx, transacoes } = montar();
    await caixa.sincronizarCobranca(tx as never, T, cob('paga'));
    await caixa.sincronizarCobranca(tx as never, T, cob('cancelada'));
    expect(transacoes.rows).toHaveLength(0);
  });

  it('cobrança de valor zero não vira entrada', async () => {
    const { caixa, tx, transacoes } = montar();
    await caixa.sincronizarCobranca(tx as never, T, { ...cob('paga'), valorCentavos: 0 });
    expect(transacoes.rows).toHaveLength(0);
  });
});

describe('Lançamentos manuais', () => {
  it('categoria de outro tipo é recusada', async () => {
    const { caixa, categorias } = montar();
    categorias.rows.push({ id: 'cat-saida', tipo: 'saida', nome: 'Aluguel' });
    await expect(caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'X', valorCentavos: 100, categoriaId: 'cat-saida' })).rejects.toThrow('essa categoria é de saída');
  });

  it('valor não inteiro ou zero é recusado', async () => {
    const { caixa } = montar();
    await expect(caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'X', valorCentavos: 10.5 })).rejects.toThrow('valor inválido');
    await expect(caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'X', valorCentavos: 0 })).rejects.toThrow('valor inválido');
  });

  it('responsável de fora da conta é recusado', async () => {
    const { caixa } = montar();
    await expect(caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'X', valorCentavos: 100, responsavelId: '99999999-9999-4999-8999-999999999999' })).rejects.toThrow('não é membro');
  });

  it('pendente não gera comissão; ao marcar pago, gera uma', async () => {
    const { caixa, comissoes } = montar('10');
    const t = await caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'Venda', valorCentavos: 12345, status: 'pendente', responsavelId: PROF });
    expect(comissoes.rows).toHaveLength(0);
    await caixa.statusTransacao(T, 'u', t.id, 'pago');
    await caixa.statusTransacao(T, 'u', t.id, 'pago');
    expect(comissoes.rows).toHaveLength(1);
    expect(comissoes.rows[0].valorCentavos).toBe(1235);
  });

  it('excluir entrada com comissão paga → 409; editar só a descrição continua livre', async () => {
    const { caixa, comissoes } = montar();
    const t = await caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'Venda', valorCentavos: 10000, responsavelId: PROF });
    comissoes.rows[0].status = 'paga';
    await expect(caixa.removerTransacao(T, 'u', t.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(caixa.atualizarTransacao(T, 'u', t.id, { valorCentavos: 5000 })).rejects.toBeInstanceOf(ConflictException);
    await expect(caixa.atualizarTransacao(T, 'u', t.id, { descricao: 'Venda (corrigida)' })).resolves.toMatchObject({ descricao: 'Venda (corrigida)' });
  });

  it('categoria duplicada vira 409 legível', async () => {
    const { caixa, categorias } = montar();
    categorias.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    await expect(caixa.criarCategoria(T, 'u', { nome: 'Serviços', tipo: 'entrada' })).rejects.toThrow('já existe uma categoria com esse nome');
  });
});

describe('Comissões: pagar e estornar', () => {
  it('pagar duas vezes lança UMA saída no caixa; estornar desfaz as duas coisas', async () => {
    const { caixa, comissoesSvc, transacoes, comissoes } = montar('30');
    await caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'Venda', valorCentavos: 10000, responsavelId: PROF });
    const id = comissoes.rows[0].id;
    await comissoesSvc.pagar(T, 'u', id);
    await comissoesSvc.pagar(T, 'u', id);
    const saidas = transacoes.rows.filter((t) => t.origem === 'comissao');
    expect(saidas).toHaveLength(1);
    expect(saidas[0]).toMatchObject({ tipo: 'saida', valorCentavos: 3000, status: 'pago' });
    expect(comissoes.rows[0]).toMatchObject({ status: 'paga', pagamentoTransacaoId: saidas[0].id });

    await comissoesSvc.estornar(T, 'u', id);
    expect(transacoes.rows.filter((t) => t.origem === 'comissao')).toHaveLength(0);
    expect(comissoes.rows[0]).toMatchObject({ status: 'prevista', pagoEm: null, pagamentoTransacaoId: null });
  });

  it('excluir a saída do pagamento devolve a comissão para prevista', async () => {
    const { caixa, comissoesSvc, transacoes, comissoes } = montar('30');
    await caixa.criarTransacao(T, 'u', { tipo: 'entrada', descricao: 'Venda', valorCentavos: 10000, responsavelId: PROF });
    await comissoesSvc.pagar(T, 'u', comissoes.rows[0].id);
    const saida = transacoes.rows.find((t) => t.origem === 'comissao')!;
    await caixa.removerTransacao(T, 'u', saida.id);
    expect(comissoes.rows[0]).toMatchObject({ status: 'prevista', pagoEm: null });
  });

  it('% com mais de 2 casas é recusado', async () => {
    const { comissoesSvc } = montar();
    await expect(comissoesSvc.definir(T, 'u', PROF, { comissaoPercent: 12.345 })).rejects.toThrow('percentual inválido');
    await expect(comissoesSvc.definir(T, 'u', PROF, { comissaoPercent: 101 })).rejects.toThrow('percentual inválido');
  });
});

describe('Importação de lançamentos (Avec/planilha)', () => {
  const arquivo = [
    { descricao: 'Corte Maria', valor: 'R$ 80,00', data: '05/11/2026', categoria: 'Serviços', responsavel: 'Ana', ocorrencia: 1 },
    { descricao: 'Corte Maria', valor: 'R$ 80,00', data: '05/11/2026', categoria: 'Serviços', responsavel: 'Ana', ocorrencia: 2 },
    { descricao: 'Aluguel', valor: '-2.500,00', data: '01/11/2026', categoria: 'Aluguel', ocorrencia: 1 },
    { descricao: 'Sem valor', valor: 'abc', ocorrencia: 1 },
    { descricao: 'Data ruim', valor: '10', data: '31/02/2026', ocorrencia: 1 },
    { descricao: 'Estornado', valor: '10', status: 'Cancelado', ocorrencia: 1 },
    { descricao: 'Produto', valor: '35,90', responsavel: 'Fulana Inexistente', ocorrencia: 1 },
  ];

  it('lê formato BR, cria categorias, reporta erro POR LINHA (numeração do arquivo) e avisos', async () => {
    const { caixa, transacoes, categorias, comissoes } = montar('30');
    const r = await caixa.importar(T, 'u', arquivo, {}, 2);
    expect(r).toMatchObject({ total: 7, criados: 4, ignorados: 1 });
    expect(r.erros).toEqual([
      { linha: 5, motivo: expect.stringContaining('valor inválido') },
      { linha: 6, motivo: expect.stringContaining('data inválida') },
    ]);
    expect(r.avisos.map((a) => a.linha)).toEqual([7, 8]);
    const aluguel = transacoes.rows.find((t) => t.descricao === 'Aluguel')!;
    expect(aluguel).toMatchObject({ tipo: 'saida', valorCentavos: 250000, origem: 'importacao' });
    expect(categorias.rows.some((c) => c.nome === 'Aluguel' && c.tipo === 'saida')).toBe(true);
    // Padrão: importação de histórico não gera comissão.
    expect(comissoes.rows).toHaveLength(0);
  });

  it('reimportar o mesmo arquivo não duplica nada', async () => {
    const { caixa, transacoes } = montar();
    await caixa.importar(T, 'u', arquivo, {}, 2);
    const antes = transacoes.rows.length;
    const r = await caixa.importar(T, 'u', arquivo, {}, 2);
    expect(r.criados).toBe(0);
    expect(r.ignorados).toBe(5); // 4 já importadas + 1 cancelada
    expect(transacoes.rows).toHaveLength(antes);
  });

  it('com gerarComissoes, entrada do profissional gera comissão', async () => {
    const { caixa, comissoes } = montar('10');
    await caixa.importar(T, 'u', [arquivo[0]], { gerarComissoes: true });
    expect(comissoes.rows).toHaveLength(1);
    expect(comissoes.rows[0].valorCentavos).toBe(800);
  });

  it('cada linha roda em SAVEPOINT (erro não aborta a transação)', async () => {
    const { caixa, tx } = montar();
    await caixa.importar(T, 'u', [arquivo[3]]);
    const cmds = tx.$executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(cmds).toEqual(['SAVEPOINT fin_linha', 'ROLLBACK TO SAVEPOINT fin_linha']);
  });

  it('lote acima do limite é recusado inteiro', async () => {
    const { caixa } = montar();
    await expect(caixa.importar(T, 'u', Array.from({ length: 501 }, () => ({ descricao: 'x', valor: '1' })))).rejects.toThrow('lote máximo');
  });
});
