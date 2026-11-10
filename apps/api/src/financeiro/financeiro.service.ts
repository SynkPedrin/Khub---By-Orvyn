import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'financeiro_cobranca', ${entidadeId ?? null})`;
}

export interface CobrancaInput {
  descricao: string;
  valorCentavos: number;
  contactId?: string | null;
  dealId?: string | null;
  vencimento?: string | null; // ISO date
  moeda?: string;
  enviar?: boolean; // cria já como 'enviada' em vez de 'rascunho'
}

/**
 * Financeiro: cobranças do tenant (valores em centavos). O gerenciamento é local
 * e real; o link de pagamento passa pela Stripe (REST direto — só falta a chave).
 */
@Injectable()
export class FinanceiroService {
  private readonly stripeCircuito = new CircuitBreaker({ nome: 'Stripe', limiteFalhas: 4, cooldownMs: 20_000 });

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async listar(tenantId: string, filtro?: { status?: string }) {
    const cobrancas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.financeiroCobranca.findMany({
        where: filtro?.status ? { status: filtro.status } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
    );
    // "vencida" é derivada: enviada/rascunho com vencimento no passado.
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return cobrancas.map((c) => ({
      ...c,
      status: (c.status === 'enviada' || c.status === 'rascunho') && c.vencimento && c.vencimento < hoje ? 'vencida' : c.status,
    }));
  }

  async resumo(tenantId: string) {
    const cobrancas = await this.listar(tenantId);
    const soma = (f: (c: (typeof cobrancas)[number]) => boolean) =>
      cobrancas.filter(f).reduce((n, c) => n + c.valorCentavos, 0);
    return {
      recebidoCentavos: soma((c) => c.status === 'paga'),
      aReceberCentavos: soma((c) => c.status === 'enviada' || c.status === 'rascunho'),
      vencidoCentavos: soma((c) => c.status === 'vencida'),
      total: cobrancas.length,
      pagas: cobrancas.filter((c) => c.status === 'paga').length,
      vencidas: cobrancas.filter((c) => c.status === 'vencida').length,
    };
  }

  async criar(tenantId: string, identityId: string, dto: CobrancaInput) {
    if (!Number.isInteger(dto.valorCentavos) || dto.valorCentavos < 0) throw new BadRequestException('valor inválido (centavos, inteiro >= 0)');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const cob = await tx.financeiroCobranca.create({
        data: {
          tenantId,
          descricao: dto.descricao.trim(),
          valorCentavos: dto.valorCentavos,
          moeda: dto.moeda ?? 'BRL',
          status: dto.enviar ? 'enviada' : 'rascunho',
          contactId: dto.contactId ?? null,
          dealId: dto.dealId ?? null,
          vencimento: dto.vencimento ? new Date(dto.vencimento) : null,
          createdBy: identityId,
        },
      });
      await audit(tx, tenantId, identityId, 'cobranca.criada', cob.id);
      return cob;
    });
  }

  async atualizarStatus(tenantId: string, identityId: string, id: string, status: 'enviada' | 'paga' | 'cancelada') {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.financeiroCobranca.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('cobrança inexistente');
      const cob = await tx.financeiroCobranca.update({
        where: { id },
        data: { status, pagoEm: status === 'paga' ? new Date() : null, updatedAt: new Date() },
      });
      await audit(tx, tenantId, identityId, `cobranca.${status}`, id);
      return cob;
    });
  }

  /**
   * Confirmação de pagamento vinda do webhook da Stripe — sem identidade
   * humana por trás, então o audit log registra `actor_type:'sistema'`
   * (mesmo padrão do provisionamento de tenant). Idempotente: se já estiver
   * `paga`, não repete o audit log (o webhook pode reentregar o evento).
   */
  async marcarPagaPorWebhook(tenantId: string, cobrancaId: string): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const cob = await tx.financeiroCobranca.findFirst({ where: { id: cobrancaId } });
      if (!cob || cob.status === 'paga') return;
      await tx.financeiroCobranca.update({ where: { id: cobrancaId }, data: { status: 'paga', pagoEm: new Date(), updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'sistema', 'stripe_webhook', 'cobranca.paga', 'financeiro_cobranca', ${cobrancaId}::uuid)`;
    });
  }

  async remover(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.financeiroCobranca.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('cobrança inexistente');
      await tx.financeiroCobranca.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'cobranca.removida', id);
      return { ok: true };
    });
  }

  /**
   * Cria um Checkout Session na Stripe (REST direto — sem SDK) e devolve a URL de
   * pagamento. Gated: sem STRIPE_SECRET_KEY → 501 config_required (nada de link fake).
   */
  async gerarLinkPagamento(tenantId: string, identityId: string, id: string): Promise<{ url: string }> {
    this.config.require('stripe'); // 501 config_required se faltar a chave
    const secret = this.config.get('STRIPE_SECRET_KEY')!;
    const webUrl = this.config.get('WEB_URL') ?? 'http://localhost:3210';

    return this.prisma.withTenant(tenantId, async (tx) => {
      const cob = await tx.financeiroCobranca.findFirst({ where: { id } });
      if (!cob) throw new NotFoundException('cobrança inexistente');

      const form = new URLSearchParams();
      form.set('mode', 'payment');
      form.set('success_url', `${webUrl}/financeiro?pago=${id}`);
      form.set('cancel_url', `${webUrl}/financeiro?cancelado=${id}`);
      form.set('line_items[0][quantity]', '1');
      form.set('line_items[0][price_data][currency]', cob.moeda.toLowerCase());
      form.set('line_items[0][price_data][unit_amount]', String(cob.valorCentavos));
      form.set('line_items[0][price_data][product_data][name]', cob.descricao);
      form.set('client_reference_id', id);
      // `tenant_id` no metadata: o webhook (`POST /v1/webhooks/stripe`) conecta
      // como `khub_app` (NOBYPASSRLS) e não pode descobrir o tenant de uma
      // cobrança por lookup cross-tenant — precisa vir de uma fonte confiável
      // já na criação do checkout, mesmo padrão do roteamento Meta/STEVO.
      form.set('metadata[kind]', 'financeiro_cobranca');
      form.set('metadata[tenant_id]', tenantId);
      form.set('metadata[cobranca_id]', id);

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

      const j = (await res.json()) as { url: string; payment_intent?: string; id: string };
      await tx.financeiroCobranca.update({
        where: { id },
        data: { stripeCheckoutUrl: j.url, stripePaymentIntent: j.payment_intent ?? j.id, status: cob.status === 'rascunho' ? 'enviada' : cob.status, updatedAt: new Date() },
      });
      await audit(tx, tenantId, identityId, 'cobranca.link_pagamento', id);
      return { url: j.url };
    });
  }
}
