import { CreditoIaService, lerConfigCredito } from './credito-ia.service';
import { ErroProvedorIA } from './provider.contract';

/** Prisma falso: N tenants ativos, cada um com um gasto registrado. */
function prismaFalso(gastos: number[]) {
  let leituras = 0;
  const tenants = gastos.map((_, i) => ({ id: `t${i}` }));
  return {
    leituras: () => leituras,
    tenant: { findMany: jest.fn(async () => { leituras++; return tenants; }) },
    withTenant: jest.fn(async (id: string, fn: (tx: unknown) => unknown) =>
      fn({ aiUsageEvent: { aggregate: async () => ({ _sum: { custoUsd: gastos[Number(id.slice(1))] } }) } }),
    ),
  };
}

const ENV = { ANTHROPIC_CREDITO_USD: '78.17', ANTHROPIC_CREDITO_DESDE: '2026-11-25T00:00:00Z' } as NodeJS.ProcessEnv;

describe('lerConfigCredito', () => {
  it('desligado sem limite', () => {
    expect(lerConfigCredito({} as NodeJS.ProcessEnv)).toBeNull();
    expect(lerConfigCredito({ ANTHROPIC_CREDITO_USD: '0' } as NodeJS.ProcessEnv)).toBeNull();
    expect(lerConfigCredito({ ANTHROPIC_CREDITO_USD: 'abc' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('lê limite com vírgula, reserva padrão 5 e data', () => {
    const c = lerConfigCredito({ ANTHROPIC_CREDITO_USD: '78,17', ANTHROPIC_CREDITO_DESDE: '2026-11-25T00:00:00Z' } as NodeJS.ProcessEnv)!;
    expect(c.limiteUsd).toBeCloseTo(78.17);
    expect(c.reservaUsd).toBe(5);
    expect(c.desde.toISOString()).toBe('2026-11-25T00:00:00.000Z');
  });
  it('data inválida desliga em vez de contar errado', () => {
    expect(lerConfigCredito({ ANTHROPIC_CREDITO_USD: '10', ANTHROPIC_CREDITO_DESDE: 'ontem' } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('CreditoIaService', () => {
  it('sem teto configurado não consulta o banco nem bloqueia', async () => {
    const p = prismaFalso([999]);
    const s = new CreditoIaService(p as never);
    await expect(s.verificar({} as NodeJS.ProcessEnv)).resolves.toBeUndefined();
    expect(p.leituras()).toBe(0);
  });

  it('abaixo do teto libera; soma todos os tenants', async () => {
    const p = prismaFalso([30, 20]);
    const s = new CreditoIaService(p as never);
    await expect(s.verificar(ENV)).resolves.toBeUndefined();
    const st = await s.status(ENV);
    expect(st).toMatchObject({ ativo: true, gastoUsd: 50, bloqueado: false });
    expect(st.restanteUsd).toBeCloseTo(28.17);
  });

  it('no teto (limite menos reserva) recusa com causa credito, não retentável', async () => {
    const s = new CreditoIaService(prismaFalso([40, 33.2]) as never);
    const erro = await s.verificar(ENV).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroProvedorIA);
    expect((erro as ErroProvedorIA).causa).toBe('credito');
    expect((erro as ErroProvedorIA).retentavel).toBe(false);
  });

  it('chamadas locais contam até a próxima leitura do banco', async () => {
    const p = prismaFalso([70]);
    const s = new CreditoIaService(p as never);
    await expect(s.verificar(ENV)).resolves.toBeUndefined();
    s.registrar(4);
    await expect(s.verificar(ENV)).rejects.toMatchObject({ causa: 'credito' });
    expect(p.leituras()).toBe(1);
  });

  it('falha ao ler o banco não derruba a IA', async () => {
    const s = new CreditoIaService({ tenant: { findMany: async () => { throw new Error('db fora'); } } } as never);
    await expect(s.verificar(ENV)).resolves.toBeUndefined();
  });
});
