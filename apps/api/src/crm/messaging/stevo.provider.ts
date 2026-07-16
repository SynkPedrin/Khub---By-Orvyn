import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface MessagingProvider {
  configured(): boolean;
  sendText(number: string, text: string): Promise<{ providerId?: string }>;
}

/**
 * STEVO — API de WhatsApp NÃO OFICIAL. Enviamos como "SMS" (texto simples) e o
 * inbox exibe como conversa de WhatsApp. Endpoint/payload configuráveis por env
 * (STEVO_API_URL, STEVO_API_KEY, STEVO_SEND_PATH, STEVO_INSTANCE) — ajustar
 * conforme a doc da instância. Sem chaves → send indisponível (degrada limpo).
 */
@Injectable()
export class StevoProvider implements MessagingProvider {
  private readonly log = new Logger('Stevo');

  configured(): boolean {
    return !!(process.env.STEVO_API_URL && process.env.STEVO_API_KEY);
  }

  private onlyDigits(n: string): string {
    return (n || '').replace(/\D/g, '');
  }

  async sendText(number: string, text: string): Promise<{ providerId?: string }> {
    if (!this.configured()) {
      throw new ServiceUnavailableException('STEVO não configurado (defina STEVO_API_URL e STEVO_API_KEY).');
    }
    const base = process.env.STEVO_API_URL!.replace(/\/+$/, '');
    let path = process.env.STEVO_SEND_PATH ?? '/message/sendText';
    if (!path.startsWith('/')) path = `/${path}`;
    const instance = process.env.STEVO_INSTANCE;
    // Evolution/STEVO: instância vai no PATH (/message/sendText/<instance>)
    if (instance && !path.includes(instance)) path = `${path}/${instance}`;
    const url = `${base}${path}`;
    // cobre variações de payload (Evolution v2 usa `text`; v1 usa `textMessage.text`)
    const body = { number: this.onlyDigits(number), text, textMessage: { text } };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: process.env.STEVO_API_KEY!, authorization: `Bearer ${process.env.STEVO_API_KEY!}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`STEVO ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return { providerId: j.id ?? j.messageId ?? j.key?.id };
  }
}
