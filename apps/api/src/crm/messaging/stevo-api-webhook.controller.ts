import { StevoApiEventosService } from './stevo-api-eventos.service';
import { chavesDaMidia, chavesDoReferral, extrairMidia, extrairReferralWhatsApp, tipoDeEntrada, type MidiaEntrada, type ReferralWhatsApp } from './midia-entrada';
import { Prisma } from '@prisma/client';
import { Controller, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { SkipRateLimit } from '../../common/rate-limit.guard';
import { SkipAudit } from '../../common/audit.interceptor';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { verificarAssinaturaStevo } from './stevo-assinatura';

/** Envelope oficial (tipos do `stevo-sdk`: `StevoWebhookEnvelope`). */
const envelopeSchema = z.object({
  event_id: z.string().min(1).max(100),
  type: z.string().min(1).max(60),
  attempt: z.number().int().optional(),
  created_at: z.string().optional(),
  account_id: z.string().optional(),
  instance: z.object({ id: z.string().min(1).max(100), external_ref: z.string().nullable().optional() }),
  data: z.record(z.unknown()).nullable().optional(),
});

/** Eventos que o KHUB processa; o resto é aceito (2xx) e descartado. */
export const EVENTOS_STEVO = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'instance.connected',
  'instance.disconnected',
  'instance.auth_failed',
] as const;

/**
 * Só os campos normalizados que usamos — o `raw` da Stevo NÃO é guardado
 * (minimização, LGPD): payload cru pode trazer dado que não precisamos.
 */
export function payloadMinimo(tipo: string, instanciaId: string, data: Record<string, unknown> | null | undefined) {
  const d = data ?? {};
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    tipo,
    instanciaId,
    messageId: s(d.message_id),
    messageIds: Array.isArray(d.message_ids) ? d.message_ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : [],
    chat: s(d.chat),
    from: s(d.from),
    fromMe: d.from_me === true,
    isGroup: d.is_group === true,
    pushName: s(d.push_name),
    conteudoTipo: s(d.type),
    // Anúncio de origem (clique para WhatsApp): base da atribuição do lead (db/066).
    referral: extrairReferralWhatsApp(d),
    texto: s(d.text),
    timestamp: s(d.timestamp),
    motivo: s(d.reason),
    // Mídia recebida (figurinha/imagem/áudio…): só o necessário para baixar e
    // exibir. base64 grande não vai para a fila (fica só a URL).
    midia: (() => {
      const m = extrairMidia(d);
      return m && m.base64 && m.base64.length > 2_000_000 ? { ...m, base64: null } : m;
    })(),
  };
}
export type EventoStevoApi = Omit<ReturnType<typeof payloadMinimo>, 'midia' | 'referral'> & { midia?: MidiaEntrada | null; referral?: ReferralWhatsApp | null; eventId: string };

/**
 * Webhook de CONTA da Stevo (API de gestão).
 *
 * Responde rápido (a Stevo exige 2xx em até 10 s): verifica a assinatura,
 * resolve o tenant pela instância e grava no outbox com dedupe por `event_id`
 * (entrega é "pelo menos uma vez"; o mesmo evento nunca é processado 2x).
 * O processamento de verdade é no worker (`StevoApiEventosService`).
 *
 * Seguro por construção:
 *  - sem segredo configurado → 401 (nunca aceita sem verificar);
 *  - instância sem vínculo → 200 ignorado (não é erro do remetente; evita
 *    tempestade de retries) — e nada é gravado em tenant nenhum;
 *  - `external_ref` da Stevo diferente do tenant vinculado → ignorado e logado
 *    (sinal de vínculo inconsistente: melhor perder do que entregar no tenant errado).
 */
@Public()
@SkipRateLimit()
@SkipAudit()
@Controller('webhooks/stevo-api')
export class StevoApiWebhookController {
  private readonly log = new Logger('StevoApiWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventos: StevoApiEventosService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(@Req() req: Request) {
    const h = (nome: string) => {
      const v = req.headers[nome];
      return Array.isArray(v) ? v[0] : v;
    };
    const verif = verificarAssinaturaStevo({
      corpoCru: (req as Request & { rawBody?: Buffer }).rawBody,
      timestamp: h('x-stevo-timestamp'),
      assinaturas: [h('x-stevo-signature'), h('x-stevo-signature-previous')],
      segredos: [this.config.get('STEVO_WEBHOOK_SECRET'), this.config.get('STEVO_WEBHOOK_SECRET_PREVIOUS')],
    });
    if (!verif.ok) {
      this.log.warn(`webhook recusado: ${verif.motivo}`);
      throw new UnauthorizedException(`assinatura recusada: ${verif.motivo}`);
    }

    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success) return { ignorado: 'envelope_invalido' };
    const ev = parsed.data;
    if (!(EVENTOS_STEVO as readonly string[]).includes(ev.type)) return { ignorado: 'evento_nao_usado' };

    const rows = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_by_stevo_api_instance(${ev.instance.id}) AS tenant_id`;
    const tenantId = rows[0]?.tenant_id ?? null;
    if (!tenantId) {
      this.log.log(`evento ${ev.type} de instância sem vínculo (${ev.instance.id.slice(0, 8)}…) ignorado`);
      return { ignorado: 'instancia_sem_vinculo' };
    }
    if (ev.instance.external_ref && ev.instance.external_ref !== tenantId) {
      this.log.warn(`external_ref da instância ${ev.instance.id.slice(0, 8)}… diverge do vínculo — evento descartado`);
      return { ignorado: 'external_ref_divergente' };
    }

    const dedupeKey = `stevo_api-${ev.event_id}`;
    const payload: EventoStevoApi = { ...payloadMinimo(ev.type, ev.instance.id, ev.data ?? null), eventId: ev.event_id };
    if (ev.type === 'message.received') {
      const chaves = chavesDoReferral(ev.data ?? null);
      // Diagnóstico do formato do anúncio de origem (não documentado pela Stevo): só NOMES de chaves.
      if (chaves) this.log.log(`mensagem com contexto de origem ${chaves}`);
    }
    if (ev.type === 'message.received' && tipoDeEntrada(payload.conteudoTipo)) {
      // Diagnóstico do formato de mídia (a doc da Stevo não lista os campos): só NOMES de chaves.
      this.log.log(`mídia recebida (${payload.conteudoTipo}) ${chavesDaMidia(ev.data ?? null)}`);
    }
    const linha = await this.prisma.withTenant(tenantId, (tx) =>
      tx.outboxEvent.upsert({
        where: { tenantId_dedupeKey: { tenantId, dedupeKey } },
        create: { tenantId, kind: 'stevo_api.event', dedupeKey, payload: payload as unknown as Prisma.InputJsonValue },
        update: {},
        select: { id: true, status: true },
      }),
    );
    // TEMPO REAL: processa já, na própria requisição (a API publica no socket
    // na hora). O outbox continua sendo a garantia: se falhar aqui, o worker
    // reprocessa; se der certo, marca processado para o worker não repetir
    // (e o receiveInbound é idempotente pelo id da mensagem, caso os dois corram).
    if (linha.status === 'pending') {
      try {
        await this.eventos.processar(tenantId, payload);
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.outboxEvent.updateMany({ where: { id: linha.id, status: 'pending' }, data: { status: 'processed', processedAt: new Date() } }),
        );
      } catch (e) {
        this.log.warn(`processamento imediato falhou (${ev.type}); o worker reprocessa: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    return { ok: true };
  }
}
