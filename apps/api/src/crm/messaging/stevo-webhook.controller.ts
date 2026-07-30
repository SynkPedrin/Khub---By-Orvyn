import { Body, Controller, Logger, Post, Query } from '@nestjs/common';
import { Public } from '../../auth/decorators';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from './messages.service';

/**
 * Webhook de ENTRADA do STEVO. Público. Idempotente (webhook_events).
 * Resolução de tenant (migration 008): a instância do payload é resolvida por
 * `resolve_tenant_by_stevo_instance` (SECURITY DEFINER — só devolve o id de
 * roteamento); em dev single-tenant, STEVO_FALLBACK_TENANT_ID cobre o caso de
 * ainda não existir integração conectada. Formato do payload varia por
 * instância — parse tolerante.
 */
@Public()
@Controller('webhooks/stevo')
export class StevoWebhookController {
  private readonly log = new Logger('StevoWebhook');

  constructor(
    private readonly messages: MessagesService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async receive(@Body() body: any, @Query('token') token?: string) {
    const expected = this.config.get('STEVO_WEBHOOK_TOKEN');
    if (expected && token !== expected) return { ignored: 'token inválido' };

    const ev = this.parse(body);
    if (!ev) return { ignored: 'payload não reconhecido' };

    const tenantId = await this.resolveTenant(ev.instance);
    if (!tenantId) return { ignored: 'instância sem tenant: conecte o STEVO nas integrações ou defina STEVO_FALLBACK_TENANT_ID' };

    try {
      await this.messages.receiveInbound({ tenantId, fromNumber: ev.from, fromName: ev.name, text: ev.text, providerMessageId: ev.id });
      return { ok: true };
    } catch (e) {
      this.log.error(`falha ao processar entrada: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  /** instância → tenant. Sem instância no payload (ou sem match), cai no env de dev. */
  private async resolveTenant(instance?: string): Promise<string | undefined> {
    if (instance) {
      try {
        const rows = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`
          SELECT resolve_tenant_by_stevo_instance(${instance}) AS tenant_id`;
        const found = rows[0]?.tenant_id;
        if (found) return found;
      } catch (e) {
        this.log.warn(`resolução de instância falhou: ${(e as Error).message}`);
      }
    }
    return this.config.get('STEVO_FALLBACK_TENANT_ID');
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
