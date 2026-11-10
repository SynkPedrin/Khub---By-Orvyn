import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';

function ambiente(opts: { precos?: Record<string, string>; subscriptionExistente?: any } = {}) {
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test', WEB_URL: 'http://localhost:3210',
    ...(opts.precos ?? { STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_GROWTH: 'price_growth', STRIPE_PRICE_SCALE: 'price_scale' }),
  };
  const subscriptions = new Map<string, any>();
  if (opts.subscriptionExistente) subscriptions.set(opts.subscriptionExistente.tenantId, opts.subscriptionExistente);

  const prisma = {
    withTenant: jest.fn(async (tenantId: string, fn: any) =>
      fn({
        subscription: {
          findUnique: jest.fn(async ({ where }: any) => subscriptions.get(where.tenantId) ?? null),
          upsert: jest.fn(async ({ where, create, update }: any) => {
            const existe = subscriptions.get(where.tenantId);
            const linha = existe ? { ...existe, ...update } : { tenantId, ...create };
            subscriptions.set(where.tenantId, linha);
            return linha;
          }),
        },
      }),
    ),
  };
  const config = {
    require: jest.fn((p: string) => { if (p === 'stripe' && !env.STRIPE_SECRET_KEY) throw new Error('config_required'); }),
    get: (k: string) => env[k],
  };
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  return { svc: new BillingService(prisma as any, config as any), prisma, subscriptions, fetchMock };
}

describe('BillingService — preço nunca hardcoded, decisão de negócio pendente é erro claro', () => {
  afterEach(() => jest.restoreAllMocks());

  it('plano sem STRIPE_PRICE_<PLANO> configurado: erro explícito, NUNCA um preço inventado', async () => {
    const a = ambiente({ precos: { STRIPE_PRICE_STARTER: 'price_starter' } }); // growth/scale faltando
    await expect(a.svc.criarCheckout('tenant-a', 'a@b.com', 'growth')).rejects.toThrow(/STRIPE_PRICE_GROWTH/);
    expect(a.fetchMock).not.toHaveBeenCalled(); // nem tentou chamar a Stripe sem preço
  });

  it('plano fora da lista (starter/growth/scale): 400, não vira requisição pra Stripe', async () => {
    const a = ambiente();
    await expect(a.svc.criarCheckout('tenant-a', 'a@b.com', 'enterprise' as any)).rejects.toThrow(BadRequestException);
    expect(a.fetchMock).not.toHaveBeenCalled();
  });

  it('checkout bem-sucedido grava a subscription como "incompleta" — nunca "ativa" otimisticamente', async () => {
    const a = ambiente();
    a.fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'cus_1' }) }) // customers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/x' }) }); // checkout
    const r = await a.svc.criarCheckout('tenant-a', 'a@b.com', 'growth');
    expect(r.url).toBe('https://checkout.stripe.com/x');
    expect(a.subscriptions.get('tenant-a')).toMatchObject({ plano: 'growth', status: 'incompleta' });
  });

  it('customer já existe: reaproveita, não cria um novo na Stripe', async () => {
    const a = ambiente({ subscriptionExistente: { tenantId: 'tenant-a', stripeCustomerId: 'cus_existente' } });
    a.fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ url: 'https://checkout.stripe.com/x' }) });
    await a.svc.criarCheckout('tenant-a', 'a@b.com', 'starter');
    expect(a.fetchMock).toHaveBeenCalledTimes(1); // só o checkout, sem POST /customers
    const [, opts] = a.fetchMock.mock.calls[0];
    expect(String(opts.body)).toContain('customer=cus_existente');
  });

  it('webhook sincroniza plano desconhecido (drift futuro da Stripe): ignora, não quebra nem inventa', async () => {
    const a = ambiente();
    await a.svc.sincronizarAssinatura({ tenantId: 'tenant-a', plano: 'enterprise-novo', status: 'ativa' });
    expect(a.subscriptions.has('tenant-a')).toBe(false);
  });

  it('status sem assinatura nenhuma: estado explícito "sem_assinatura", não null silencioso', async () => {
    const a = ambiente();
    const r = await a.svc.status('tenant-a');
    expect(r).toEqual({ plano: null, status: 'sem_assinatura' });
  });
});
