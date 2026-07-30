import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';

export interface MessagingProvider {
  configured(): boolean;
  missing(): string[];
  sendText(number: string, text: string): Promise<{ providerId?: string }>;
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

  async sendText(number: string, text: string): Promise<{ providerId?: string }> {
    this.config.require('stevo'); // 501 config_required se faltar

    const base = this.config.get('STEVO_API_URL')!.replace(/\/+$/, '');
    let path = this.config.get('STEVO_SEND_PATH') ?? '/message/sendText';
    if (!path.startsWith('/')) path = `/${path}`;
    const instance = this.config.get('STEVO_INSTANCE');
    // Evolution/STEVO: instância no PATH (/message/sendText/<instance>)
    if (instance && !path.includes(instance)) path = `${path}/${instance}`;
    const apiKey = this.config.get('STEVO_API_KEY')!;
    // cobre variações de payload (Evolution v2 usa `text`; v1 usa `textMessage.text`)
    const body = { number: this.onlyDigits(number), text, textMessage: { text } };

    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: apiKey, authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`STEVO ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return { providerId: j.id ?? j.messageId ?? j.key?.id };
  }
}
