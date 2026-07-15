import { Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';

/**
 * Webhook Meta (Lead Ads). GET = verificação do subscription; POST = eventos.
 * Idempotência via webhook_events (dedupe por event_id) — a ingestão do lead →
 * contato exige o mapeamento page↔tenant capturado na conexão (Sprint D).
 */
@Public()
@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly log = new Logger('MetaWebhook');

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  @Post()
  receive(@Req() req: Request, @Res() res: Response) {
    // Meta exige resposta rápida (<20s). Ack imediato; processamento assíncrono.
    const body = req.body as { entry?: { id: string; time: number; changes?: unknown[] }[] };
    const events = body?.entry?.length ?? 0;
    this.log.debug(`Meta webhook: ${events} entry(ies) recebida(s)`);
    // TODO(Sprint D): resolver tenant via page_id, dedupe em webhook_events e criar lead→contato.
    return res.status(200).send('EVENT_RECEIVED');
  }
}
