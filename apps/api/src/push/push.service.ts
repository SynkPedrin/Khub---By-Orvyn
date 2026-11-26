import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';

export interface PushPayload {
  titulo: string;
  corpo: string;
  /** Caminho interno aberto ao tocar na notificação (ex.: `/m/aprovacoes/<id>`). */
  url: string;
  /** Agrupa notificações do mesmo assunto no aparelho (a nova substitui a antiga). */
  tag?: string;
}

export interface InscricaoPush {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface LinhaInscricao {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Web Push do app mobile (PWA, db/085).
 *
 * Envio é best-effort: a operação de negócio (criar aprovação, responder) já
 * commitou; aparelho fora do ar não derruba nada. Endpoint que o provedor
 * responde 404/410 (app desinstalado, permissão revogada) é apagado.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private configuradoCom: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  chavePublica(): string | null {
    return this.config.get('VAPID_PUBLIC_KEY') ?? null;
  }

  ligado(): boolean {
    return Boolean(this.config.get('VAPID_PUBLIC_KEY') && this.config.get('VAPID_PRIVATE_KEY'));
  }

  private preparar(): boolean {
    if (!this.ligado()) return false;
    const pub = this.config.get('VAPID_PUBLIC_KEY')!;
    if (this.configuradoCom !== pub) {
      const subject = this.config.get('VAPID_SUBJECT') ?? 'mailto:contato@kromads.com.br';
      webpush.setVapidDetails(subject, pub, this.config.get('VAPID_PRIVATE_KEY')!);
      this.configuradoCom = pub;
    }
    return true;
  }

  async inscrever(tenantId: string, identityId: string, s: InscricaoPush, userAgent?: string): Promise<void> {
    if (!this.ligado()) throw new ServiceUnavailableException('Notificações no celular ainda não estão ativadas no servidor.');
    const ua = userAgent ? userAgent.slice(0, 400) : null;
    await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`
      INSERT INTO push_subscriptions (tenant_id, identity_id, endpoint, p256dh, auth, user_agent)
      VALUES (${tenantId}::uuid, ${identityId}::uuid, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth}, ${ua})
      ON CONFLICT (tenant_id, endpoint) DO UPDATE
        SET identity_id = EXCLUDED.identity_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`);
  }

  async cancelar(tenantId: string, identityId: string, endpoint: string): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`
      DELETE FROM push_subscriptions WHERE tenant_id = ${tenantId}::uuid AND identity_id = ${identityId}::uuid AND endpoint = ${endpoint}`);
  }

  async quantosAparelhos(tenantId: string, identityId: string): Promise<number> {
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM push_subscriptions WHERE tenant_id = ${tenantId}::uuid AND identity_id = ${identityId}::uuid`);
    return r[0]?.n ?? 0;
  }

  /**
   * Envia para os aparelhos do tenant. `para` = só estas identidades;
   * `null` = todo mundo inscrito no tenant. `exceto` tira quem originou.
   */
  async enviar(tenantId: string, para: string[] | null, payload: PushPayload, exceto?: string | null): Promise<number> {
    if (!this.preparar()) return 0;
    if (para && para.length === 0) return 0;
    let linhas: LinhaInscricao[];
    try {
      linhas = await this.prisma.withTenant(tenantId, (tx) =>
        para
          ? tx.$queryRaw<LinhaInscricao[]>`
              SELECT id, endpoint, p256dh, auth FROM push_subscriptions
              WHERE tenant_id = ${tenantId}::uuid AND identity_id = ANY(${para}::uuid[])
                AND (${exceto ?? null}::uuid IS NULL OR identity_id <> ${exceto ?? null}::uuid)`
          : tx.$queryRaw<LinhaInscricao[]>`
              SELECT id, endpoint, p256dh, auth FROM push_subscriptions
              WHERE tenant_id = ${tenantId}::uuid
                AND (${exceto ?? null}::uuid IS NULL OR identity_id <> ${exceto ?? null}::uuid)`,
      );
    } catch (e) {
      this.log.warn(`falha ao ler inscrições: ${(e as Error).message}`);
      return 0;
    }
    const corpo = JSON.stringify({
      title: payload.titulo.slice(0, 120),
      body: payload.corpo.slice(0, 300),
      url: /^\/[^/]/.test(payload.url) ? payload.url : '/m',
      tag: payload.tag,
    });
    const mortas: string[] = [];
    const entregues: string[] = [];
    await Promise.all(
      linhas.map(async (l) => {
        try {
          await webpush.sendNotification({ endpoint: l.endpoint, keys: { p256dh: l.p256dh, auth: l.auth } }, corpo, { TTL: 24 * 3600, urgency: 'high' });
          entregues.push(l.id);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) mortas.push(l.id);
          else this.log.warn(`push recusado: HTTP ${status ?? '?'}`);
        }
      }),
    );
    if (mortas.length || entregues.length) {
      await this.prisma
        .withTenant(tenantId, async (tx) => {
          if (mortas.length) await tx.$executeRaw`DELETE FROM push_subscriptions WHERE id = ANY(${mortas}::uuid[])`;
          if (entregues.length) await tx.$executeRaw`UPDATE push_subscriptions SET usado_em = now() WHERE id = ANY(${entregues}::uuid[])`;
        })
        .catch(() => undefined);
    }
    return entregues.length;
  }
}
