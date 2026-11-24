import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CaixaService } from '../financeiro/caixa.service';

/** Agendamentos multi-serviço (db/079): grupo_id vincula compromissos individuais. */
const T = '11111111-1111-4111-8111-111111111111';
const G = '99999999-9999-4999-8999-999999999999';

const SERVICOS = [
  { id: 's1', nome: 'Escova', duracaoMin: 45, precoCentavos: 5000 },
  { id: 's2', nome: 'Mão', duracaoMin: 60, precoCentavos: 3500 },
];
const PROFS = [
  { id: 'p1', nome: 'Rita' },
  { id: 'p2', nome: 'Bia' },
];

function montar() {
  let seq = 0;
  const tx = {
    agendaCompromisso: {
      findFirst: jest.fn(async (_args?: unknown): Promise<unknown> => null), // choca(): sem choque por padrão
      findMany: jest.fn(async (_args?: unknown): Promise<unknown[]> => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `ag${++seq}`, status: 'agendado', ...data })),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data })),
    },
    profissional: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => PROFS.find((p) => p.id === where.id) ?? null),
      findMany: jest.fn(async () => PROFS),
    },
    servico: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => SERVICOS.find((s) => s.id === where.id) ?? null),
      findMany: jest.fn(async () => SERVICOS),
    },
    contact: { findMany: jest.fn(async () => []) },
    membership: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const caixa = { sincronizarCompromisso: jest.fn(async () => null) } as unknown as CaixaService;
  return { svc: new AgendaService(prisma, new ConfigService(), caixa), tx, caixa };
}

const DOIS_ITENS = {
  itens: [
    { servicoId: 's1', profissionalId: 'p1', inicio: '2026-11-27T17:00:00.000Z' }, // sem fim: duração do catálogo
    { servicoId: 's2', profissionalId: 'p2', inicio: '2026-11-27T17:30:00.000Z', fim: '2026-11-27T18:30:00.000Z', titulo: 'Mão francesinha' },
  ],
};

describe('AgendaService.criarGrupo', () => {
  it('feliz: 2 serviços com profissionais diferentes, MESMO grupoId, um audit de grupo', async () => {
    const { svc, tx } = montar();
    const r = await svc.criarGrupo(T, 'u1', DOIS_ITENS);
    expect(r.itens).toHaveLength(2);
    expect(r.grupoId).toMatch(/^[0-9a-f-]{36}$/);
    const criados = tx.agendaCompromisso.create.mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data);
    expect(criados[0].grupoId).toBe(r.grupoId);
    expect(criados[1].grupoId).toBe(r.grupoId);
    expect(criados[0]).toMatchObject({ titulo: 'Escova', profissionalId: 'p1', servicoId: 's1' }); // título padrão = nome do serviço
    expect(criados[1]).toMatchObject({ titulo: 'Mão francesinha', profissionalId: 'p2' });
    const audits = tx.$executeRaw.mock.calls.map((c: unknown[]) => String((c[0] as TemplateStringsArray).join('?')) + JSON.stringify(c.slice(1)));
    expect(audits.filter((a: string) => a.includes('compromisso.grupo_criado'))).toHaveLength(1);
  });

  it('sem fim, o fim sai da duração do catálogo (Escova 45 min)', async () => {
    const { svc, tx } = montar();
    await svc.criarGrupo(T, 'u1', DOIS_ITENS);
    const primeiro = tx.agendaCompromisso.create.mock.calls[0][0].data as { inicio: Date; fim: Date };
    expect(+primeiro.fim - +primeiro.inicio).toBe(45 * 60_000);
  });

  it('choque com a agenda existente → 409 dizendo a profissional e o horário', async () => {
    const { svc, tx } = montar();
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce({ id: 'ocupado' }); // choque do 1º item
    const e = await svc.criarGrupo(T, 'u1', DOIS_ITENS).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as Error).message).toContain('Rita');
    expect(tx.agendaCompromisso.create).not.toHaveBeenCalled();
  });

  it('choque intra-grupo: mesma profissional com horários sobrepostos → 409', async () => {
    const { svc, tx } = montar();
    const e = await svc
      .criarGrupo(T, 'u1', {
        itens: [
          { servicoId: 's1', profissionalId: 'p1', inicio: '2026-11-27T17:00:00.000Z' }, // 17:00–17:45
          { servicoId: 's2', profissionalId: 'p1', inicio: '2026-11-27T17:30:00.000Z', fim: '2026-11-27T18:30:00.000Z' },
        ],
      })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as Error).message).toContain('Rita');
    expect((e as Error).message).toContain('mesmo tempo');
    expect(tx.agendaCompromisso.create).not.toHaveBeenCalled();
  });

  it('profissionais diferentes PODEM se sobrepor; 1 ou 9 itens → 400; catálogo inexistente → 400', async () => {
    const { svc, tx } = montar();
    await expect(
      svc.criarGrupo(T, 'u1', {
        itens: [
          { servicoId: 's1', profissionalId: 'p1', inicio: '2026-11-27T17:00:00.000Z' },
          { servicoId: 's2', profissionalId: 'p2', inicio: '2026-11-27T17:15:00.000Z', fim: '2026-11-27T18:00:00.000Z' },
        ],
      }),
    ).resolves.toMatchObject({ itens: expect.any(Array) });
    await expect(svc.criarGrupo(T, 'u1', { itens: [DOIS_ITENS.itens[0]] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.criarGrupo(T, 'u1', { itens: Array.from({ length: 9 }, () => DOIS_ITENS.itens[0]) })).rejects.toBeInstanceOf(BadRequestException);
    tx.agendaCompromisso.findFirst.mockResolvedValue(null);
    await expect(svc.criarGrupo(T, 'u1', { itens: [{ ...DOIS_ITENS.itens[0], servicoId: 'sX' }, DOIS_ITENS.itens[1]] })).rejects.toThrow('serviço inexistente');
  });

  it('datas tortas de um item usam a mesma validação do compromisso individual → 400', async () => {
    const { svc } = montar();
    await expect(
      svc.criarGrupo(T, 'u1', { itens: [{ servicoId: 's1', profissionalId: 'p1', inicio: '2026-11-27T17:00:00.000Z', fim: '2026-11-27T16:00:00.000Z' }, DOIS_ITENS.itens[1]] }),
    ).rejects.toThrow('o fim deve ser depois do início');
  });
});

describe('AgendaService.atualizarStatusGrupo', () => {
  it('aplica em TODOS os itens, com o efeito de caixa de cada um', async () => {
    const { svc, tx, caixa } = montar();
    tx.agendaCompromisso.findMany.mockResolvedValue([{ id: 'ag1' }, { id: 'ag2' }]);
    tx.agendaCompromisso.findFirst.mockImplementation(async (args) => {
      const { where } = args as { where: { id: string } };
      return { id: where.id, status: 'agendado', inicio: new Date('2026-11-27T17:00:00Z'), fim: new Date('2026-11-27T18:00:00Z'), responsavelId: null, profissionalId: 'p1' };
    });
    const r = await svc.atualizarStatusGrupo(T, 'u1', G, 'concluido');
    expect(r.itens).toHaveLength(2);
    expect(tx.agendaCompromisso.update).toHaveBeenCalledTimes(2);
    expect(tx.agendaCompromisso.update).toHaveBeenCalledWith({ where: { id: 'ag1' }, data: { status: 'concluido' } });
    expect(caixa.sincronizarCompromisso).toHaveBeenCalledTimes(2);
  });

  it('grupo inexistente → 404; status inválido → 400', async () => {
    const { svc, tx } = montar();
    await expect(svc.atualizarStatusGrupo(T, 'u1', G, 'concluido')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.atualizarStatusGrupo(T, 'u1', G, 'nao_compareceu')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.agendaCompromisso.update).not.toHaveBeenCalled();
  });
});

describe('AgendaService.reagendarGrupo', () => {
  const GRUPO = [
    { id: 'ag1', status: 'agendado', titulo: 'Escova', inicio: new Date('2026-11-27T17:00:00Z'), fim: new Date('2026-11-27T17:45:00Z'), responsavelId: null, profissionalId: 'p1' },
    { id: 'ag2', status: 'confirmado', titulo: 'Mão', inicio: new Date('2026-11-27T17:30:00Z'), fim: new Date('2026-11-27T18:30:00Z'), responsavelId: null, profissionalId: 'p2' },
    { id: 'ag3', status: 'concluido', titulo: 'Pé', inicio: new Date('2026-11-27T19:00:00Z'), fim: new Date('2026-11-27T20:00:00Z'), responsavelId: null, profissionalId: 'p1' },
  ];

  it('desloca só os ATIVOS pelo delta e ignora os próprios ids no choque', async () => {
    const { svc, tx } = montar();
    tx.agendaCompromisso.findMany.mockResolvedValue(GRUPO);
    const r = await svc.reagendarGrupo(T, 'u1', G, 60);
    expect(r.movidos).toBe(2);
    expect(tx.agendaCompromisso.update).toHaveBeenCalledTimes(2);
    expect(tx.agendaCompromisso.update).toHaveBeenCalledWith({
      where: { id: 'ag1' },
      data: { inicio: new Date('2026-11-27T18:00:00Z'), fim: new Date('2026-11-27T18:45:00Z') },
    });
    // concluído não move
    expect(tx.agendaCompromisso.update.mock.calls.some((c: [{ where: { id: string } }]) => c[0].where.id === 'ag3')).toBe(false);
    // choque revalidado por item ativo, ignorando os ids do grupo
    const choques = tx.agendaCompromisso.findFirst.mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
    expect(choques).toHaveLength(2);
    expect(choques[0]).toMatchObject({ id: { notIn: ['ag1', 'ag2', 'ag3'] }, profissionalId: 'p1' });
    const audits = tx.$executeRaw.mock.calls.map((c: unknown[]) => JSON.stringify(c.slice(1)));
    expect(audits.some((a: string) => a.includes('compromisso.grupo_reagendado'))).toBe(true);
  });

  it('choque na nova janela → 409 e nada move', async () => {
    const { svc, tx } = montar();
    tx.agendaCompromisso.findMany.mockResolvedValue(GRUPO);
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce({ id: 'outro' });
    await expect(svc.reagendarGrupo(T, 'u1', G, -120)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.agendaCompromisso.update).not.toHaveBeenCalled();
  });

  it('delta inválido (0, fracionário, > 7 dias) → 400; grupo inexistente → 404', async () => {
    const { svc, tx } = montar();
    await expect(svc.reagendarGrupo(T, 'u1', G, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reagendarGrupo(T, 'u1', G, 1.5)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reagendarGrupo(T, 'u1', G, 7 * 24 * 60 + 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.reagendarGrupo(T, 'u1', G, 30)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.agendaCompromisso.update).not.toHaveBeenCalled();
  });
});

describe('AgendaService.listar por grupoId', () => {
  it('filtra só os itens do grupo e devolve o grupoId no spread', async () => {
    const { svc, tx } = montar();
    tx.agendaCompromisso.findMany.mockResolvedValue([
      { id: 'ag1', grupoId: G, contactId: null, profissionalId: 'p1', servicoId: 's1', titulo: 'Escova', inicio: new Date(), fim: new Date(), status: 'agendado' },
    ]);
    const r = (await svc.listar(T, { grupoId: G })) as Record<string, unknown>[];
    expect(tx.agendaCompromisso.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ grupoId: G }) }));
    expect(r[0]).toMatchObject({ grupoId: G, profissionalNome: 'Rita', servicoNome: 'Escova' });
  });
});
