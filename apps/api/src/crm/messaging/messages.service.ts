import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoProvider } from './stevo.provider';

export interface InboundInput {
  tenantId: string;
  fromNumber: string;
  fromName?: string;
  text: string;
  providerMessageId: string;
}

@Injectable()
export class MessagesService {
  private readonly log = new Logger(MessagesService.name);

  constructor(private readonly prisma: PrismaService, private readonly stevo: StevoProvider) {}

  private hora(): string {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /** Envia mensagem de saída: persiste + dispara no STEVO (tolerante, como SMS). */
  async send(tenantId: string, conversationId: string, texto: string) {
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
      if (!conv) throw new NotFoundException('conversa inexistente');
      const hora = this.hora();
      const msg = await tx.message.create({ data: { tenantId, conversationId, autorTipo: 'humano', corpo: texto, hora }, select: { id: true } });
      await tx.conversation.update({ where: { id: conversationId }, data: { ultimaPrevia: texto.slice(0, 140), ultimaHora: hora, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, acao, entidade, entidade_id) VALUES (${tenantId}::uuid, 'humano', 'message.send', 'message', ${msg.id})`;
      return { msgId: msg.id, phone: conv.contact?.telefone ?? null, hora };
    });

    let status: 'sent' | 'failed' | 'sem_telefone' | 'stevo_off' = 'sent';
    let erro: string | null = null;
    // STEVO_TEST_NUMBER (dev): força o destino para o seu número, p/ testar a entrega
    const destino = process.env.STEVO_TEST_NUMBER || ctx.phone;
    if (!this.stevo.configured()) status = 'stevo_off';
    else if (!destino) status = 'sem_telefone';
    else {
      try {
        await this.stevo.sendText(destino, texto);
      } catch (e) {
        status = 'failed';
        erro = (e as Error).message;
        this.log.warn(`STEVO falhou ao enviar: ${erro}`);
      }
    }
    return { id: ctx.msgId, hora: ctx.hora, status, erro };
  }

  /** Recebe mensagem de entrada (webhook STEVO): dedup + acha/cria contato+conversa. */
  async receiveInbound(input: InboundInput) {
    return this.prisma.withTenant(input.tenantId, async (tx) => {
      // idempotência (unique provider+event_id)
      try {
        await tx.webhookEvent.create({ data: { tenantId: input.tenantId, provider: 'stevo', eventId: input.providerMessageId, payload: {} } });
      } catch {
        return { deduped: true };
      }
      const digits = input.fromNumber.replace(/\D/g, '');
      let contact = digits.length >= 8 ? await tx.contact.findFirst({ where: { telefone: { contains: digits.slice(-8) } } }) : null;
      if (!contact) {
        contact = await tx.contact.create({ data: { tenantId: input.tenantId, nome: input.fromName || input.fromNumber, telefone: input.fromNumber, tag: 'Lead', ultimoContatoAt: new Date() } });
      }
      const hora = this.hora();
      let conv = await tx.conversation.findFirst({ where: { contactId: contact.id, canal: 'WhatsApp' } });
      if (!conv) {
        conv = await tx.conversation.create({ data: { tenantId: input.tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', ultimaPrevia: input.text.slice(0, 140), naoLidas: 1, ultimaHora: hora } });
      } else {
        await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: input.text.slice(0, 140), naoLidas: { increment: 1 }, ultimaHora: hora, updatedAt: new Date() } });
      }
      await tx.message.create({ data: { tenantId: input.tenantId, conversationId: conv.id, autorTipo: 'contato', corpo: input.text, hora } });
      return { conversationId: conv.id };
    });
  }
}
