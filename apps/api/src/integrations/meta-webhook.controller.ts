import { Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { ConfigService } from '../config/config.service';
import { MetaLeadsService } from './meta-leads.service';

/**
 * Webhook Meta (Lead Ads). GET = verificação do subscription; POST = eventos.
 * O POST **ack imediato** (a Meta exige <20s e reentrega se demorar) e processa
 * fora do ciclo da resposta; a idempotência vive em `webhook_events`.
 */
@Public()
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly log = new Logger('MetaWebhook');

  constructor(
    private readonly config: ConfigService,
    private readonly leads: MetaLeadsService,
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
  receive(@Req() req: Request, @Res() res: Response) {
    // Assinatura (X-Hub-Signature-256) só é verificável com META_APP_SECRET.
    // Sem o segredo, o evento é aceito e registrado — mas nunca confiamos nele
    // para escrever no CRM (o enriquecimento também exige a credencial).
    if (!this.assinaturaValida(req)) {
      this.log.warn('assinatura inválida no webhook da Meta — evento descartado');
      return res.status(403).send('invalid signature');
    }

    const eventos = this.leads.parse(req.body);
    // Ack primeiro: processar antes de responder faz a Meta reentregar em pico.
    res.status(200).send('EVENT_RECEIVED');

    for (const ev of eventos) {
      void this.leads.processar(ev).catch((e) => this.log.error(`leadgen ${ev.leadgenId}: ${(e as Error).message}`));
    }
    return undefined;
  }

  /** HMAC-SHA256 do corpo cru com o app secret (o `rawBody` vem do main.ts). */
  private assinaturaValida(req: Request): boolean {
    const secret = this.config.get('META_APP_SECRET');
    if (!secret) return true; // sem credencial não há o que verificar (evento fica gated adiante)
    const header = req.get('x-hub-signature-256');
    if (!header?.startsWith('sha256=')) return false;
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) return false;
    const esperado = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    if (header.length !== esperado.length) return false;
    return timingSafeEqual(Buffer.from(header), Buffer.from(esperado));
  }
}
