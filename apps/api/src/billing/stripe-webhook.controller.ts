import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { FinanceiroService } from '../financeiro/financeiro.service';

/** Mapa de status da Stripe pro nosso enum — a Stripe tem mais estados que precisamos distinguir. */
function mapStatus(stripeStatus: string): 'incompleta' | 'ativa' | 'inadimplente' | 'cancelada' | 'pausada' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'ativa';
    case 'past_due':
    case 'unpaid':
      return 'inadimplente';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelada';
    case 'paused':
      return 'pausada';
    default:
      return 'incompleta';
  }
}

/**
 * Webhook único da Stripe pros DOIS fluxos que passam por ela (mesma conta,
 * uma URL só pra configurar no painel): assinatura da plataforma
 * (`khub_subscription`, ver BillingService) e cobrança de cliente do tenant
 * (`financeiro_cobranca`, ver FinanceiroService). Roteado por
 * `metadata.kind`, setado por nós na criação do checkout — nunca inferido.
 *
 * Mesmo padrão do webhook da Meta (meta-webhook.controller.ts): assinatura
 * HMAC sobre o corpo CRU antes de qualquer leitura, idempotência via
 * `webhook_events`, tenant sempre de uma fonte confiável (nunca do payload
 * "nu" sem verificar a assinatura primeiro).
 */
@Public()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly log = new Logger('StripeWebhook');

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly financeiro: FinanceiroService,
  ) {}

  @Post()
  async receive(@Req() req: Request, @Res() res: Response) {
    const evento = this.verificarAssinaturaEParsear(req);
    if (!evento) {
      this.log.warn('assinatura inválida no webhook da Stripe — evento descartado');
      return res.status(403).send('invalid signature');
    }

    const obj = evento.data?.object as Record<string, unknown> | undefined;
    const metadata = (obj?.metadata ?? {}) as Record<string, string>;
    const tenantId = metadata.tenant_id;
    if (!tenantId) {
      // Evento sem o nosso metadata (ex.: objeto antigo, ou de outra integração
      // na mesma conta Stripe) — não há tenant pra isolar o registro de
      // idempotência. Confirma recebimento sem processar (nunca inventa tenant).
      this.log.warn(`evento Stripe ${evento.type} sem metadata.tenant_id — ignorado`);
      return res.status(200).send('ignored: no tenant metadata');
    }

    const jaProcessado = await this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.webhookEvent.findFirst({ where: { provider: 'stripe', eventId: evento.id }, select: { id: true } });
      if (existe) return true;
      await tx.webhookEvent.create({ data: { tenantId, provider: 'stripe', eventId: evento.id, payload: evento as unknown as Prisma.InputJsonValue } });
      return false;
    });
    if (jaProcessado) return res.status(200).send('already processed');

    await this.processar(evento.type, obj!, metadata, tenantId);
    return res.status(200).send('ok');
  }

  private async processar(tipo: string, obj: Record<string, unknown>, metadata: Record<string, string>, tenantId: string): Promise<void> {
    if (metadata.kind === 'financeiro_cobranca') {
      if (tipo === 'checkout.session.completed' && metadata.cobranca_id) {
        await this.financeiro.marcarPagaPorWebhook(tenantId, metadata.cobranca_id);
      }
      return;
    }

    // 'orvyn_subscription': assinaturas criadas antes do rebrand (ADR-0041) seguem no Stripe com o valor antigo.
    if (metadata.kind === 'khub_subscription' || metadata.kind === 'orvyn_subscription' || tipo.startsWith('customer.subscription.')) {
      if (tipo === 'checkout.session.completed') {
        await this.billing.sincronizarAssinatura({
          tenantId, plano: metadata.plano ?? 'starter', status: 'ativa',
          stripeCustomerId: obj.customer as string | undefined,
          stripeSubscriptionId: obj.subscription as string | undefined,
        });
        return;
      }
      if (tipo === 'customer.subscription.updated' || tipo === 'customer.subscription.created') {
        await this.billing.sincronizarAssinatura({
          tenantId,
          plano: metadata.plano ?? 'starter',
          status: mapStatus(obj.status as string),
          stripeCustomerId: obj.customer as string | undefined,
          stripeSubscriptionId: obj.id as string | undefined,
          currentPeriodEnd: obj.current_period_end ? new Date((obj.current_period_end as number) * 1000) : undefined,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        });
        return;
      }
      if (tipo === 'customer.subscription.deleted') {
        await this.billing.sincronizarAssinatura({
          tenantId, plano: metadata.plano ?? 'starter', status: 'cancelada',
          stripeSubscriptionId: obj.id as string | undefined,
        });
      }
    }
  }

  /** HMAC-SHA256 no formato da Stripe: header `t=<ts>,v1=<hash>` sobre `${ts}.${corpo_cru}`. */
  private verificarAssinaturaEParsear(req: Request): { id: string; type: string; data: { object: unknown } } | null {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET');
    if (!secret) return null; // sem credencial não há o que verificar — nunca processa sem assinatura
    const header = req.get('stripe-signature');
    if (!header) return null;

    const partes = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const timestamp = partes.t;
    const assinatura = partes.v1;
    if (!timestamp || !assinatura || !/^[a-fA-F0-9]{64}$/.test(assinatura)) return null;

    // Tolerância de 5 min contra replay de um payload capturado antigo.
    const idadeMs = Date.now() - Number(timestamp) * 1000;
    if (!Number.isFinite(idadeMs) || idadeMs > 5 * 60_000 || idadeMs < -60_000) return null;

    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) return null;
    const esperado = createHmac('sha256', secret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex');
    if (esperado.length !== assinatura.length) return null;
    if (!timingSafeEqual(Buffer.from(esperado), Buffer.from(assinatura))) return null;

    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }
}
