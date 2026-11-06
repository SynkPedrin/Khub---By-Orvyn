import { BadRequestException, Body, Controller, Logger, Param, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Formato do evento Evolution v2 (`{event, instance, data}`) — verificado
 * contra `GET /` (`version:"2.3.7"`) e contra `instance/create` ao vivo para
 * a forma geral do envelope. O payload de MENSAGEM especificamente (dentro de
 * `data` num evento `messages.upsert`) segue o formato estável e documentado
 * do Baileys que a Evolution repassa quase sem alteração — mas não foi
 * observado ao vivo nesta sessão porque isso exige uma mensagem real
 * chegando por WhatsApp (depende do usuário escanear o QR). Ver
 * docs/EVOLUTION_SETUP.md §"O que não foi verificado ao vivo".
 */
const EnvelopeSchema = z.object({
  event: z.string(),
  instance: z.string().min(1).max(160),
  data: z.record(z.unknown()).optional(),
});

/**
 * Extrai uma mensagem de entrada normalizada de um evento `messages.upsert`.
 * Retorna `null` quando o evento não é uma mensagem de entrada aproveitável
 * (mensagem própria, grupo, status, ou evento de outro tipo como
 * `connection.update`) — nesses casos o webhook responde 200 e ignora.
 */
export function parseEvolutionMessage(body: unknown): { from: string; text: string; id: string; instance: string; name?: string } | null {
  const env = EnvelopeSchema.parse(body);
  if (env.event !== 'messages.upsert') return null;

  const d = z.record(z.unknown()).optional().parse(env.data) ?? {};
  const key = z.record(z.unknown()).optional().parse(d.key) ?? {};
  const message = z.record(z.unknown()).optional().parse(d.message) ?? {};

  if (key.fromMe === true) return null;

  const remoteJid = key.remoteJid;
  if (typeof remoteJid === 'string' && (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast')) return null;

  // Baileys manda o texto em campos diferentes conforme o tipo de mensagem —
  // pega o primeiro que existir, na ordem dos tipos mais comuns em conversa 1:1.
  const extended = z.record(z.unknown()).optional().parse(message.extendedTextMessage) ?? {};
  const text = message.conversation ?? extended.text ?? d.text;
  const id = key.id ?? d.messageId;

  if (typeof remoteJid !== 'string' || typeof text !== 'string' || typeof id !== 'string') return null;
  if (text.length === 0) return null;

  return z
    .object({ from: z.string().min(7).max(80), text: z.string().min(1).max(4000), id: z.string().min(1).max(300), instance: z.string(), name: z.string().max(160).optional() })
    .parse({ from: remoteJid, text, id, instance: env.instance, name: d.pushName });
}

/**
 * Webhook público da Evolution API — instância → tenant via
 * `resolve_tenant_by_evolution_instance` (SECURITY DEFINER, migration 024).
 *
 * O token vem no PATH (`/v1/hooks/evolution/:token`), não em header: quem
 * registra a URL do webhook somos nós mesmos (`configureWebhook`), então
 * podemos embutir um segredo de 32+ bytes ali — equivalente em segurança a
 * um header, mais simples de configurar num provedor que não garante
 * repassar headers customizados.
 */
@Public()
@Controller('hooks/evolution')
export class EvolutionWebhookController {
  private readonly log = new Logger('EvolutionWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post(':token')
  async receive(@Param('token') token: string, @Body() body: unknown) {
    const expected = this.config.get('EVOLUTION_WEBHOOK_TOKEN');
    if (!expected) throw new ServiceUnavailableException('webhook não configurado');
    const actual = Buffer.from(token ?? '');
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
      throw new UnauthorizedException('token inválido');
    }

    let env: z.infer<typeof EnvelopeSchema>;
    try {
      env = EnvelopeSchema.parse(body);
    } catch {
      throw new BadRequestException('payload inválido ou sem envelope {event, instance, data}');
    }

    // connection.update: só log — a UI lê o estado real via
    // GET /instance/connectionState quando o operador pede, não fica
    // guardando estado duplicado aqui (fonte da verdade é sempre a Evolution).
    if (env.event === 'connection.update') {
      this.log.log(`connection.update instance=${env.instance} state=${JSON.stringify(env.data?.state)}`);
      return { ok: true };
    }

    let msg: ReturnType<typeof parseEvolutionMessage>;
    try {
      msg = parseEvolutionMessage(body);
    } catch {
      throw new BadRequestException('payload de mensagem malformado');
    }
    if (!msg) return { ignored: true };

    const rows = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`
      SELECT resolve_tenant_by_evolution_instance(${msg.instance}) AS tenant_id
    `;
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) {
      // Instância sem dono conhecido: não é erro do remetente, mas não há
      // onde gravar. 200 para a Evolution não ficar reentregando pra sempre.
      this.log.warn(`webhook de instância sem tenant: ${msg.instance}`);
      return { ignored: true, reason: 'instance_not_routed' };
    }

    const payload = { tenantId, fromNumber: msg.from.replace(/@.*$/, ''), fromName: msg.name, text: msg.text, providerMessageId: msg.id };
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.outboxEvent.upsert({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey: `evolution:${msg!.instance}:${msg!.id}` } },
        create: { tenantId, kind: 'evolution.inbound', dedupeKey: `evolution:${msg!.instance}:${msg!.id}`, payload },
        update: {},
      }),
    );
    return { ok: true };
  }
}
