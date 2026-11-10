import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';

export type Plano = 'starter' | 'growth' | 'scale';
const PLANOS: Plano[] = ['starter', 'growth', 'scale'];

/**
 * Assinatura do PRÓPRIO KHUB (billing da plataforma) — não confundir com
 * `FinanceiroService` (o tenant cobrando OS CLIENTES dele).
 *
 * Preço não é decisão de engenharia: o PRD (§17) marca LACUNA explícita —
 * "não define preços em R$". Por isso o valor de cada plano nunca é
 * hardcoded aqui; vem do Price ID configurado em `STRIPE_PRICE_<PLANO>`
 * (mesmo princípio de gating por credencial do resto do projeto). Decidir o
 * preço é só criar o Price na Stripe e apontar a env var — zero código.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  private readonly stripeCircuito = new CircuitBreaker({ nome: 'Stripe (billing)', limiteFalhas: 4, cooldownMs: 20_000 });

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async status(tenantId: string) {
    const sub = await this.prisma.withTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId } }));
    if (!sub) return { plano: null, status: 'sem_assinatura' as const };
    return {
      plano: sub.plano,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }

  private priceId(plano: Plano): string {
    const key = `STRIPE_PRICE_${plano.toUpperCase()}`;
    const id = this.config.get(key);
    if (!id) {
      throw new BadRequestException(
        `Plano "${plano}" ainda não tem preço configurado (faltou a variável ${key}). Isto não é um bug — é uma decisão de preço pendente.`,
      );
    }
    return id;
  }

  /** Cria (ou reaproveita) o Customer da Stripe para este tenant. */
  private async garantirCustomer(tenantId: string, email: string, secret: string): Promise<string> {
    const existente = await this.prisma.withTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } }));
    if (existente?.stripeCustomerId) return existente.stripeCustomerId;

    const form = new URLSearchParams();
    form.set('email', email);
    form.set('metadata[tenant_id]', tenantId);
    const res = await this.stripeCircuito.run(async () => {
      const r = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (r.status >= 500) throw new Error(`Stripe ${r.status}`);
      return r;
    });
    if (!res.ok) throw new BadRequestException(`Stripe recusou criar o customer: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const j = (await res.json()) as { id: string };
    return j.id;
  }

  /** Checkout em modo ASSINATURA (diferente do `financeiro`, que é `mode=payment`, pagamento único). */
  async criarCheckout(tenantId: string, email: string, plano: Plano): Promise<{ url: string }> {
    if (!PLANOS.includes(plano)) throw new BadRequestException(`plano inválido: ${plano}`);
    this.config.require('stripe');
    const secret = this.config.get('STRIPE_SECRET_KEY')!;
    const webUrl = this.config.get('WEB_URL') ?? 'http://localhost:3210';
    const price = this.priceId(plano);
    const customerId = await this.garantirCustomer(tenantId, email, secret);

    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('customer', customerId);
    form.set('success_url', `${webUrl}/configuracoes/plano?assinado=1`);
    form.set('cancel_url', `${webUrl}/configuracoes/plano?cancelado=1`);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price]', price);
    form.set('metadata[kind]', 'khub_subscription');
    form.set('metadata[tenant_id]', tenantId);
    form.set('metadata[plano]', plano);
    // Replicado na subscription pela própria Stripe — assim TODO evento de
    // ciclo de vida (`customer.subscription.*`) já chega com o tenant_id,
    // sem precisar correlacionar de volta ao checkout original.
    form.set('subscription_data[metadata][tenant_id]', tenantId);
    form.set('subscription_data[metadata][plano]', plano);

    const res = await this.stripeCircuito.run(async () => {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (r.status >= 500) throw new Error(`Stripe ${r.status}`);
      return r;
    });
    if (!res.ok) throw new BadRequestException(`Stripe recusou: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const j = (await res.json()) as { url: string };

    // `incompleta` até o webhook confirmar — nunca marcamos "ativa" otimisticamente.
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.subscription.upsert({
        where: { tenantId },
        create: { tenantId, plano, status: 'incompleta', stripeCustomerId: customerId },
        update: { plano, stripeCustomerId: customerId },
      }),
    );
    return { url: j.url };
  }

  /** Portal de autoatendimento: o tenant cancela/atualiza cartão sem abrir chamado de suporte. */
  async criarPortal(tenantId: string): Promise<{ url: string }> {
    this.config.require('stripe');
    const secret = this.config.get('STRIPE_SECRET_KEY')!;
    const webUrl = this.config.get('WEB_URL') ?? 'http://localhost:3210';
    const sub = await this.prisma.withTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId }, select: { stripeCustomerId: true } }));
    if (!sub?.stripeCustomerId) throw new BadRequestException('nenhuma assinatura encontrada para este tenant');

    const form = new URLSearchParams();
    form.set('customer', sub.stripeCustomerId);
    form.set('return_url', `${webUrl}/configuracoes/plano`);
    const res = await this.stripeCircuito.run(async () => {
      const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (r.status >= 500) throw new Error(`Stripe ${r.status}`);
      return r;
    });
    if (!res.ok) throw new BadRequestException(`Stripe recusou: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const j = (await res.json()) as { url: string };
    return { url: j.url };
  }

  /** Chamado pelo webhook — nunca pelo front. Idempotente (upsert por tenant). */
  async sincronizarAssinatura(opts: {
    tenantId: string;
    plano: string;
    status: 'incompleta' | 'ativa' | 'inadimplente' | 'cancelada' | 'pausada';
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  }): Promise<void> {
    if (!PLANOS.includes(opts.plano as Plano)) {
      this.log.warn(`plano desconhecido vindo da Stripe: ${opts.plano} (tenant ${opts.tenantId}) — ignorado`);
      return;
    }
    await this.prisma.withTenant(opts.tenantId, (tx) =>
      tx.subscription.upsert({
        where: { tenantId: opts.tenantId },
        create: {
          tenantId: opts.tenantId, plano: opts.plano, status: opts.status,
          stripeCustomerId: opts.stripeCustomerId, stripeSubscriptionId: opts.stripeSubscriptionId,
          currentPeriodEnd: opts.currentPeriodEnd, cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
        },
        update: {
          plano: opts.plano, status: opts.status,
          ...(opts.stripeCustomerId ? { stripeCustomerId: opts.stripeCustomerId } : {}),
          ...(opts.stripeSubscriptionId ? { stripeSubscriptionId: opts.stripeSubscriptionId } : {}),
          currentPeriodEnd: opts.currentPeriodEnd, cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
          updatedAt: new Date(),
        },
      }),
    );
  }
}
