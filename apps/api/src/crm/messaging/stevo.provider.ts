import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import type { MidiaSaida } from './provider.contract';

export interface MessagingProvider {
  configured(): boolean;
  missing(): string[];
  /** `idempotencyKey`: usado por quem suporta (API de gestão da Stevo); os demais ignoram. */
  sendText(number: string, text: string, tenantInstance?: string, idempotencyKey?: string): Promise<{ providerId?: string }>;
  /**
   * Mídia (Q2.5 · contrato em provider.contract.ts). Opcional: este
   * provedor legado (API de instância) NÃO implementa — o endpoint de mídia
   * dele não está documentado no repositório nem verificado, e não se inventa
   * endpoint. `aceitaBase64` diz se dá para mandar sem storage.
   */
  sendMedia?(number: string, midia: MidiaSaida, tenantInstance?: string, idempotencyKey?: string): Promise<{ providerId?: string }>;
  readonly aceitaBase64?: boolean;
}

/**
 * STEVO — WhatsApp NÃO OFICIAL (base Evolution): enviamos texto simples ("SMS")
 * e o inbox exibe como conversa de WhatsApp. Gating pelo ConfigService
 * (STEVO_API_URL + STEVO_API_KEY + STEVO_INSTANCE) — Brief §2.
 */
@Injectable()
export class StevoProvider implements MessagingProvider {
  private readonly log = new Logger('Stevo');

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('stevo');
  }
  missing(): string[] {
    return this.config.missingVars('stevo');
  }

  private onlyDigits(n: string): string {
    return (n || '').replace(/\D/g, '');
  }

  async sendText(number: string, text: string, tenantInstance?: string): Promise<{ providerId?: string }> {
    this.config.require('stevo'); // 501 config_required se faltar

    const base = this.config.get('STEVO_API_URL')!.replace(/\/+$/, '');
    let path = this.config.get('STEVO_SEND_PATH') ?? '/message/sendText';
    if (!path.startsWith('/')) path = `/${path}`;
    const instance = tenantInstance ?? this.config.get('STEVO_INSTANCE');
    // Evolution/STEVO: instância no PATH (/message/sendText/<instance>)
    if (instance && !path.includes(instance)) path = `${path}/${encodeURIComponent(instance)}`;
    const apiKey = this.config.get('STEVO_API_KEY')!;
    // cobre variações de payload (Evolution v2 usa `text`; v1 usa `textMessage.text`)
    const body = { number: this.onlyDigits(number), text, textMessage: { text } };

    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: apiKey, authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new DeliveryError(res.status);
    return { providerId: j.id ?? j.messageId ?? j.key?.id };
  }
}

export class DeliveryError extends Error {
 readonly retryable: boolean;
 readonly uncertain: boolean;
 /** `opts` sobrepõe a heurística por status quando o provedor diz explicitamente
  *  (ex.: Stevo `502 upstream_unavailable` = nada enviado, seguro repetir). */
 constructor(readonly status: number, opts: { retryable?: boolean; uncertain?: boolean; codigo?: string } = {}) {
   super(`messaging_provider_http_${status}${opts.codigo ? `_${opts.codigo}` : ''}`);
   this.retryable=opts.retryable ?? status===429;
   this.uncertain=opts.uncertain ?? (status>=500 || status===408);
 }
}
