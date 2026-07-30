import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ConfigService } from '../config/config.service';

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface MailResult {
  sent: boolean;
  missing?: string[];
  erro?: string;
}

/**
 * Envio de e-mail transacional (Brief §2 — gating por credencial).
 * Implementação completa: com `SMTP_URL` presente, envia de verdade (SMTP/Gmail
 * OAuth2 via URL de conexão). Sem a credencial NÃO quebra o fluxo: devolve
 * `{ sent: false, missing }` e quem chamou expõe o link para envio manual.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer');
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('email');
  }
  missing(): string[] {
    return this.config.missingVars('email');
  }

  private from(): string {
    return this.config.get('SMTP_FROM') ?? 'Orvyn OS <no-reply@orvyn.app>';
  }

  private transport(): Transporter {
    // memoizado: reaproveita o pool de conexões entre envios
    if (!this.transporter) this.transporter = createTransport(this.config.get('SMTP_URL')!);
    return this.transporter;
  }

  async send(mail: MailInput): Promise<MailResult> {
    if (!this.configured()) {
      this.config.warnDegraded('email', 'link exibido na UI para envio manual');
      return { sent: false, missing: this.missing() };
    }
    try {
      await this.transport().sendMail({ from: this.from(), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      this.log.log(`e-mail enviado: ${mail.subject} -> ${mail.to}`);
      return { sent: true };
    } catch (e) {
      // Falha de SMTP não pode derrubar a operação de negócio (o convite já existe).
      const erro = (e as Error).message;
      this.log.error(`falha ao enviar e-mail para ${mail.to}: ${erro}`);
      return { sent: false, erro };
    }
  }
}
