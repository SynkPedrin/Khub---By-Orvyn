import { ConflictException } from '@nestjs/common';
import { OnboardingNyro } from './onboarding-nyro';

const ctx = { tenantId: 't1', identityId: 'ident-1', nicho: null, subespecialidade: null } as const;

function setup(over: {
  escopo?: unknown;
  iniciar?: jest.Mock;
  visao?: jest.Mock;
  criarCliente?: jest.Mock;
}) {
  const handlers = new Map<string, (args: Record<string, unknown>, c: unknown) => Promise<unknown>>();
  const executor = { registrarHandler: (nome: string, fn: never) => handlers.set(nome, fn) };
  const agency = {
    escopo: jest.fn().mockResolvedValue(
      over.escopo === undefined
        ? {
            membro: { id: 'm1', agencyId: 'ag1', role: 'owner' },
            clientes: [
              { id: 'c1', displayName: 'Studio da Beleza', tenantId: 't-studio' },
              { id: 'c2', displayName: 'Dra. Bárbara Lopes', tenantId: 't-barbara' },
            ],
          }
        : over.escopo,
    ),
    criarCliente: over.criarCliente ?? jest.fn(),
  };
  const onboarding = {
    iniciar: over.iniciar ?? jest.fn().mockResolvedValue({ id: 'ob1', status: 'coleta' }),
    visaoExecutiva: over.visao ?? jest.fn().mockResolvedValue({ contadores: { coleta: 1 }, itens: [] }),
  };
  const nyro = new OnboardingNyro(executor as never, agency as never, onboarding as never);
  nyro.onModuleInit();
  return { handlers, agency, onboarding };
}

describe('OnboardingNyro — gatilho "entrou um cliente novo" (ADR-0054)', () => {
  it('registra os handlers das duas tools do catálogo', () => {
    const { handlers } = setup({});
    expect([...handlers.keys()].sort()).toEqual(['andamento_onboarding', 'iniciar_onboarding']);
  });

  it('localiza a subconta pelo nome (aproximado, sem acento) e inicia o onboarding', async () => {
    const { handlers, onboarding } = setup({});
    const r = (await handlers.get('iniciar_onboarding')!({ nomeCliente: 'studio da beleza', escopo: { trafego: true } }, ctx)) as Record<string, unknown>;
    expect(onboarding.iniciar).toHaveBeenCalledWith('ident-1', { clientAccountId: 'c1', escopo: { trafego: true } });
    expect(r.iniciado).toBe(true);
    expect(r.link).toBe('/agency/onboarding/ob1');
  });

  it('não encontrou a subconta → pergunta se deve criar (não inventa cadastro)', async () => {
    const { handlers, onboarding, agency } = setup({});
    const r = (await handlers.get('iniciar_onboarding')!({ nomeCliente: 'Padaria do Zé' }, ctx)) as Record<string, unknown>;
    expect(r.iniciado).toBe(false);
    expect(String(r.pergunta)).toContain('Padaria do Zé');
    expect(onboarding.iniciar).not.toHaveBeenCalled();
    expect(agency.criarCliente).not.toHaveBeenCalled();
  });

  it('criarSubconta=true com owner → cria o cadastro e inicia', async () => {
    const criarCliente = jest.fn().mockResolvedValue({ id: 'c9', displayName: 'Padaria do Zé' });
    const { handlers, onboarding } = setup({ criarCliente });
    const r = (await handlers.get('iniciar_onboarding')!({ nomeCliente: 'Padaria do Zé', criarSubconta: true }, ctx)) as Record<string, unknown>;
    expect(criarCliente).toHaveBeenCalledWith('ident-1', { nome: 'Padaria do Zé' });
    expect(onboarding.iniciar).toHaveBeenCalledWith('ident-1', { clientAccountId: 'c9' });
    expect(r.iniciado).toBe(true);
  });

  it('criarSubconta=true com member → recusa educada (só owner/admin cria subconta)', async () => {
    const { handlers } = setup({
      escopo: { membro: { id: 'm2', agencyId: 'ag1', role: 'member' }, clientes: [] },
    });
    const r = (await handlers.get('iniciar_onboarding')!({ nomeCliente: 'Padaria do Zé', criarSubconta: true }, ctx)) as Record<string, unknown>;
    expect(r.iniciado).toBe(false);
    expect(String(r.pergunta)).toContain('dono ou um admin');
  });

  it('duplicidade (409 onboarding_duplicado) → devolve o onboarding existente, sem duplicar', async () => {
    const iniciar = jest.fn().mockRejectedValue(new ConflictException({ message: 'dup', code: 'onboarding_duplicado', onboardingId: 'ob9' }));
    const { handlers } = setup({ iniciar });
    const r = (await handlers.get('iniciar_onboarding')!({ nomeCliente: 'Studio da Beleza' }, ctx)) as Record<string, unknown>;
    expect(r.jaExistia).toBe(true);
    expect(r.link).toBe('/agency/onboarding/ob9');
  });

  it('andamento filtra por nome e resume progresso', async () => {
    const visao = jest.fn().mockResolvedValue({
      contadores: { coleta: 2 },
      itens: [
        { id: 'ob1', cliente: { id: 'c1', nome: 'Studio da Beleza' }, status: 'coleta', etapaAtual: null, verificacoes: { total: 16, verificadas: 3, pendentes: 13, bloqueadas: 0 }, tarefas: { total: 40, atrasadas: 2, prioridades: [] } },
        { id: 'ob2', cliente: { id: 'c2', nome: 'Dra. Bárbara Lopes' }, status: 'homologacao', etapaAtual: null, verificacoes: { total: 14, verificadas: 12, pendentes: 2, bloqueadas: 0 }, tarefas: { total: 30, atrasadas: 0, prioridades: [] } },
      ],
    });
    const { handlers } = setup({ visao });
    const r = (await handlers.get('andamento_onboarding')!({ nomeCliente: 'bárbara' }, ctx)) as { itens: { cliente: string }[] };
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]!.cliente).toBe('Dra. Bárbara Lopes');
  });

  it('andamento de cliente sem onboarding → resposta honesta', async () => {
    const visao = jest.fn().mockResolvedValue({ contadores: {}, itens: [] });
    const { handlers } = setup({ visao });
    const r = (await handlers.get('andamento_onboarding')!({ nomeCliente: 'Ninguém' }, ctx)) as Record<string, unknown>;
    expect(r.encontrado).toBe(false);
  });
});
