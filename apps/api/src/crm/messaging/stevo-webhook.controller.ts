import { Body, Controller, Logger, Post, Query } from '@nestjs/common';
import { Public } from '../../auth/decorators';
import { MessagesService } from './messages.service';

/**
 * Webhook de ENTRADA do STEVO. Público. Idempotente (webhook_events).
 * Resolução de tenant: em produção, mapear instance→tenant (tabela/serviço);
 * em dev, usa STEVO_FALLBACK_TENANT_ID. Formato do payload varia por instância —
 * parse tolerante; ajustar conforme a doc do STEVO.
 */
@Public()
@Controller('webhooks/stevo')
export class StevoWebhookController {
  private readonly log = new Logger('StevoWebhook');

  constructor(private readonly messages: MessagesService) {}

  @Post()
  async receive(@Body() body: any, @Query('token') token?: string) {
    if (process.env.STEVO_WEBHOOK_TOKEN && token !== process.env.STEVO_WEBHOOK_TOKEN) {
      return { ignored: 'token inválido' };
    }
    const ev = this.parse(body);
    if (!ev) return { ignored: 'payload não reconhecido' };

    const tenantId = process.env.STEVO_FALLBACK_TENANT_ID; // TODO: mapear ev.instance→tenant em produção
    if (!tenantId) return { ignored: 'sem tenant (defina STEVO_FALLBACK_TENANT_ID ou mapeie a instância)' };

    try {
      await this.messages.receiveInbound({ tenantId, fromNumber: ev.from, fromName: ev.name, text: ev.text, providerMessageId: ev.id });
      return { ok: true };
    } catch (e) {
      this.log.error(`falha ao processar entrada: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  private parse(b: any): { from: string; text: string; id: string; instance?: string; name?: string } | null {
    if (!b) return null;
    const from = b?.data?.from ?? b?.from ?? b?.sender ?? b?.phone ?? b?.data?.key?.remoteJid;
    const text = b?.data?.text ?? b?.message?.text ?? b?.text ?? b?.body ?? b?.data?.message?.conversation ?? b?.data?.body;
    const id = String(b?.data?.id ?? b?.id ?? b?.messageId ?? b?.data?.key?.id ?? `${from}:${text}`);
    const fromMe = b?.data?.fromMe ?? b?.fromMe ?? false;
    const name = b?.data?.pushName ?? b?.pushName ?? b?.name;
    const instance = b?.instance ?? b?.data?.instance;
    if (fromMe || !from || !text) return null;
    return { from: String(from), text: String(text), id, instance, name };
  }
}
