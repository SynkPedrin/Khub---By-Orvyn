import { Controller, Get, Logger, Optional, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetaLeadsService } from './meta-leads.service';
import { CanaisIngestaoService } from '../crm/messaging/canais/canais-ingestao.service';
import { eventosDeConversa } from '../crm/messaging/canais/meta-canais.parse';

/**
 * Webhook Meta (Lead Ads). GET = verificação do subscription; POST = eventos.
 * O POST confirma após persistir o outbox; o worker processa o lead.
 */
@Public()
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly log = new Logger('MetaWebhook');

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly leads: MetaLeadsService,
    // Conversas omnichannel (db/063): DM e comentários do Instagram/Messenger/página.
    // Superfície pública do CrmModule; opcional só para os testes antigos.
    @Optional() private readonly conversas?: CanaisIngestaoService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get('META_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  @Post()
  async receive(@Req() req: Request, @Res() res: Response) {
    // Recusar antes de qualquer escrita quando a assinatura não for válida.
    if (!this.assinaturaValida(req)) {
      this.log.warn('assinatura inválida no webhook da Meta — evento descartado');
      return res.status(403).send('invalid signature');
    }

    // Lead Ads e comentários chegam em `entry[].changes[]`; DM (Messenger e
    // Instagram) em `entry[].messaging[]`. Entrada sem nenhum dos dois é inválida.
    if (!req.body || !Array.isArray(req.body.entry) || req.body.entry.some((entry: any) => !entry || (!Array.isArray(entry.changes) && !Array.isArray(entry.messaging)))) {
      this.log.warn('invalid_meta_payload');
      return res.status(400).send('invalid payload');
    }
    // DM e comentários (idempotente: reentrega não duplica). Conta não
    // conectada em nenhum tenant é descartada sem escrita — não faz a Meta
    // reentregar para sempre.
    if (this.conversas) {
      for (const ev of eventosDeConversa(req.body)) {
        const r = await this.conversas.receberDaMeta(ev);
        if ('semTenant' in r) this.log.warn(`meta_conta_sem_tenant rede=${ev.rede} conta=${ev.contaId}`);
      }
    }
    const eventos = this.leads.parse(req.body);
    for (const ev of eventos) {
      const rows=await this.prisma.$queryRaw<{tenant_id:string|null}[]>`SELECT resolve_tenant_by_meta_page(${ev.pageId}) AS tenant_id`;
      const tenantId=rows[0]?.tenant_id;
      if(!tenantId) {
        this.log.warn(`meta_page_unmapped pageId=${ev.pageId}`);
        return res.status(503).send('page mapping unavailable');
      }
      const dedupeKey=`meta:${ev.pageId}:${ev.leadgenId}`;
      await this.prisma.withTenant(tenantId,tx=>tx.outboxEvent.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey}},create:{tenantId,kind:'meta.lead',dedupeKey,payload:{...ev}},update:{}}));
    }
    return res.status(200).send('EVENT_RECEIVED');
  }

  /** HMAC-SHA256 do corpo cru com o app secret (o `rawBody` vem do main.ts). */
  private assinaturaValida(req: Request): boolean {
    const secret = this.config.get('META_APP_SECRET');
    if (!secret) return false; // sem credencial não há o que verificar (evento fica gated adiante)
    const header = req.get('x-hub-signature-256');
    if (!header || !/^sha256=[a-fA-F0-9]{64}$/.test(header)) return false;
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) return false;
    const esperado = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    if (header.length !== esperado.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(esperado));
  }
}
