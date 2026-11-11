import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ConfigService } from '../config/config.service';

export interface MailInput {
  to: string; subject: string; html: string; text: string; idempotencyKey?: string;
}
export interface MailResult { sent: boolean; missing?: string[]; erro?: string; messageId?: string; }

@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer');
  private transporter?: Transporter;
  constructor(private readonly config: ConfigService) {}
  configured(): boolean { return this.missing().length === 0; }
  missing(): string[] { return this.config.missingVars('email'); }
  status() {
    return {
      configured: this.configured(),
      provider: this.config.get('RESEND_API_KEY') ? 'resend' : 'smtp',
      from: this.config.get('RESEND_FROM') ?? this.config.get('SMTP_FROM') ?? null,
      missing: this.missing(),
      publicLinks: /^https:\/\//.test(this.config.get('WEB_URL') ?? ''),
    };
  }
  async send(mail: MailInput): Promise<MailResult> {
    if (!this.configured()) return { sent: false, missing: this.missing() };
    try {
      if (this.config.get('RESEND_API_KEY')) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json',
            ...(mail.idempotencyKey ? { 'Idempotency-Key': mail.idempotencyKey } : {}) },
          body: JSON.stringify({ from: this.config.get('RESEND_FROM'), to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await r.json() as { id?: string };
        if (!r.ok || !data.id) {
          this.log.warn(`Resend recusou envio: HTTP ${r.status}`);
          return { sent: false, erro: r.status === 403 || r.status === 422 ? 'Verifique o domínio e o remetente no Resend. O convite foi salvo, mas o e-mail não foi enviado.' : 'O provedor de e-mail não confirmou o envio. Use o link do convite.' };
        }
        return { sent: true, messageId: data.id };
      }
      this.transporter ??= createTransport(this.config.get('SMTP_URL')!);
      const result = await this.transporter.sendMail({ from: this.config.get('SMTP_FROM') ?? 'KHUB <no-reply@orvyn.app>', to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return { sent: true, messageId: result.messageId };
    } catch {
      this.log.warn('Envio de e-mail não confirmado pelo provedor.');
      return { sent: false, erro: 'Não foi possível confirmar o envio do e-mail. O convite continua disponível por link.' };
    }
  }
}
