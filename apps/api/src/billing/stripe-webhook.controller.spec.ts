import { createHmac } from 'node:crypto';
import { StripeWebhookController } from './stripe-webhook.controller';

// Unit tests: verificam a fronteira HTTP (assinatura, idempotência, roteamento
// por metadata.kind), não o isolamento real do Postgres (isso é db/002).
function setup() {
  const rows = new Map<string, unknown>();
  const webhookEvent = {
    findFirst: jest.fn(async ({ where }: any) => (rows.has(`${where.provider}:${where.eventId}`) ? { id: 'x' } : null)),
    create: jest.fn(async ({ data }: any) => { rows.set(`${data.provider}:${data.eventId}`, data); return data; }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, fn: any) => fn({ webhookEvent })) };
  const sincronizarAssinatura = jest.fn(async () => undefined);
  const marcarPagaPorWebhook = jest.fn(async () => undefined);
  const controller = new StripeWebhookController(
    { get: () => 'whsec_test' } as any,
    prisma as any,
    { sincronizarAssinatura } as any,
    { marcarPagaPorWebhook } as any,
  );
  const response: any = { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };

  function request(evento: unknown, opts: { assinaturaErrada?: boolean; timestampVelho?: boolean } = {}) {
    const raw = Buffer.from(JSON.stringify(evento));
    const ts = opts.timestampVelho ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000);
    const assinaturaReal = createHmac('sha256', 'whsec_test').update(`${ts}.${raw.toString('utf8')}`).digest('hex');
    const assinatura = opts.assinaturaErrada ? '0'.repeat(64) : assinaturaReal;
    return { rawBody: raw, get: (h: string) => (h === 'stripe-signature' ? `t=${ts},v1=${assinatura}` : undefined) } as any;
  }

  return { controller, response, request, prisma, rows, sincronizarAssinatura, marcarPagaPorWebhook };
}

const eventoAssinatura = {
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { kind: 'khub_subscription', tenant_id: 'tenant-a', plano: 'growth' } } },
};
const eventoFinanceiro = {
  id: 'evt_2', type: 'checkout.session.completed',
  data: { object: { metadata: { kind: 'financeiro_cobranca', tenant_id: 'tenant-a', cobranca_id: 'cob-1' } } },
};

describe('Stripe webhook — fronteira HTTP', () => {
  it('assinatura inválida: 403, nenhuma escrita', async () => {
    const s = setup();
    await s.controller.receive(s.request(eventoAssinatura, { assinaturaErrada: true }), s.response);
    expect(s.response.status).toHaveBeenCalledWith(403);
    expect(s.sincronizarAssinatura).not.toHaveBeenCalled();
  });

  it('timestamp fora da janela de 5min: recusado (proteção contra replay)', async () => {
    const s = setup();
    await s.controller.receive(s.request(eventoAssinatura, { timestampVelho: true }), s.response);
    expect(s.response.status).toHaveBeenCalledWith(403);
    expect(s.sincronizarAssinatura).not.toHaveBeenCalled();
  });

  it('evento sem metadata.tenant_id: confirma (200) sem processar — nunca inventa tenant', async () => {
    const s = setup();
    const semMetadata = { id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } };
    await s.controller.receive(s.request(semMetadata), s.response);
    expect(s.response.status).toHaveBeenCalledWith(200);
    expect(s.sincronizarAssinatura).not.toHaveBeenCalled();
  });

  it('kind=khub_subscription roteia pro BillingService, nunca pro FinanceiroService', async () => {
    const s = setup();
    await s.controller.receive(s.request(eventoAssinatura), s.response);
    expect(s.sincronizarAssinatura).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', plano: 'growth', status: 'ativa' }));
    expect(s.marcarPagaPorWebhook).not.toHaveBeenCalled();
  });

  it('kind=financeiro_cobranca roteia pro FinanceiroService, nunca pro BillingService', async () => {
    const s = setup();
    await s.controller.receive(s.request(eventoFinanceiro), s.response);
    expect(s.marcarPagaPorWebhook).toHaveBeenCalledWith('tenant-a', 'cob-1');
    expect(s.sincronizarAssinatura).not.toHaveBeenCalled();
  });

  it('reentrega do mesmo evento (mesmo id) processa só uma vez — idempotência', async () => {
    const s = setup();
    await s.controller.receive(s.request(eventoAssinatura), s.response);
    await s.controller.receive(s.request(eventoAssinatura), s.response);
    expect(s.sincronizarAssinatura).toHaveBeenCalledTimes(1);
  });
});
