import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoProvider } from './stevo.provider';
import { ConfigService } from '../../config/config.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { acharContatoPorTelefone } from '../telefone';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly stevo: StevoProvider,
    private readonly config: ConfigService,
    private readonly eventos: DomainEventsService,
  ) {}

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

    // Depois do commit: as outras abas/usuários do tenant veem a mensagem na hora.
    this.eventos.publicar(tenantId, 'message.created', { conversationId, id: ctx.msgId, de: 'humano', texto, hora: ctx.hora });
    this.eventos.publicar(tenantId, 'conversation.updated', { id: conversationId, ultimaPrevia: texto.slice(0, 140), ultimaHora: ctx.hora, naoLidas: 0 });

    // A mensagem JÁ foi persistida (a parte local teve efeito) → devolvemos 200 com
    // o estado da ENTREGA. Gating: sem credencial, `config_required` + `missing`
    // (não 501, que implicaria falha total da operação). Ver ADR-0008.
    let status: 'sent' | 'failed' | 'sem_telefone' | 'config_required' = 'sent';
    let erro: string | null = null;
    let missing: string[] = [];
    // STEVO_TEST_NUMBER (dev): força o destino para o seu número, p/ testar a entrega
    const destino = this.config.get('STEVO_TEST_NUMBER') || ctx.phone;
    if (!this.stevo.configured()) { status = 'config_required'; missing = this.stevo.missing(); this.config.warnDegraded('stevo', 'mensagem persistida, entrega pendente'); }
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
    return { id: ctx.msgId, hora: ctx.hora, status, erro, missing };
  }

  /** Recebe mensagem de entrada (webhook STEVO): dedup + acha/cria contato+conversa. */
  async receiveInbound(input: InboundInput) {
    const r = await this.entrada(input);
    // Mensagem que chega é o evento mais sensível a atraso do inbox: publica assim
    // que o commit passou. Evento duplicado não é emitido — o dedupe sai antes.
    if (!r.deduped && r.conversationId) {
      this.eventos.publicar(input.tenantId, 'message.created', { conversationId: r.conversationId, id: r.messageId!, de: 'contato', texto: input.text, hora: r.hora! });
      this.eventos.publicar(input.tenantId, 'conversation.updated', { id: r.conversationId, ultimaPrevia: input.text.slice(0, 140), ultimaHora: r.hora!, naoLidas: r.naoLidas! });
      if (r.contatoNovo) {
        this.eventos.publicar(input.tenantId, 'contact.created', { id: r.contactId!, nome: r.contactNome!, origem: 'WhatsApp' });
      }
    }
    return r.deduped ? { deduped: true } : { conversationId: r.conversationId };
  }

  private async entrada(input: InboundInput) {
    return this.prisma.withTenant(input.tenantId, async (tx) => {
      // idempotência (unique provider+event_id)
      try {
        await tx.webhookEvent.create({ data: { tenantId: input.tenantId, provider: 'stevo', eventId: input.providerMessageId, payload: {} } });
      } catch {
        return { deduped: true as const };
      }
      // BUG-012: comparar dígitos crus com o telefone formatado do banco
      // duplicava o contato a cada resposta. A normalização mora no helper.
      const achadoId = await acharContatoPorTelefone(tx, input.fromNumber);
      let contact = achadoId ? await tx.contact.findUnique({ where: { id: achadoId } }) : null;
      const contatoNovo = !contact;
      if (!contact) {
        contact = await tx.contact.create({ data: { tenantId: input.tenantId, nome: input.fromName || input.fromNumber, telefone: input.fromNumber, tag: 'Lead', ultimoContatoAt: new Date() } });
      }
      const hora = this.hora();
      let conv = await tx.conversation.findFirst({ where: { contactId: contact.id, canal: 'WhatsApp' } });
      if (!conv) {
        conv = await tx.conversation.create({ data: { tenantId: input.tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', ultimaPrevia: input.text.slice(0, 140), naoLidas: 1, ultimaHora: hora } });
      } else {
        conv = await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: input.text.slice(0, 140), naoLidas: { increment: 1 }, ultimaHora: hora, updatedAt: new Date() } });
      }
      const msg = await tx.message.create({ data: { tenantId: input.tenantId, conversationId: conv.id, autorTipo: 'contato', corpo: input.text, hora }, select: { id: true } });
      return {
        deduped: false as const,
        conversationId: conv.id,
        messageId: msg.id,
        hora,
        naoLidas: conv.naoLidas,
        contatoNovo,
        contactId: contact.id,
        contactNome: contact.nome,
      };
    });
  }
}
