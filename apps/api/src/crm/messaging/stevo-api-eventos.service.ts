import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from './messages.service';
import { AvatarContatoService } from './avatar-contato.service';
import { StorageService } from '../../common/storage.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { LIMITE_INLINE, ROTULO_MIDIA, type MidiaEntrada } from './midia-entrada';
import type { EventoStevoApi } from './stevo-api-webhook.controller';

/** JID do WhatsApp (`5511999999999@s.whatsapp.net`, `…:12@…`) → só dígitos. */
export function numeroDoJid(jid: string | null): string | null {
  if (!jid) return null;
  const digitos = jid.replace(/@.*$/, '').replace(/:.*$/, '').replace(/\D/g, '');
  return digitos.length >= 8 ? digitos : null;
}

/**
 * Ordem do status de entrega. Recibos chegam fora de ordem (o `read` pode vir
 * antes do `delivered`); o status só AVANÇA — nunca volta de lido p/ entregue.
 */
const ORDEM: Record<string, number> = { sending: 1, pending: 1, unknown: 1, sent: 2, delivered: 3, read: 4 };

export type DesfechoEvento = 'entrada' | 'ignorado' | 'status' | 'instancia';

/**
 * Processa os eventos do webhook de conta da Stevo (worker, via outbox).
 * Formatos: tipos normalizados do SDK oficial (`StevoMessageEventData`,
 * `StevoReceiptEventData`, `StevoConnectionEventData`).
 */
@Injectable()
export class StevoApiEventosService {
  private readonly log = new Logger('StevoApiEventos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensagens: MessagesService,
    private readonly avatares?: AvatarContatoService,
    private readonly storage?: StorageService,
    private readonly realtime?: RealtimeService,
  ) {}

  async processar(tenantId: string, ev: EventoStevoApi): Promise<DesfechoEvento> {
    switch (ev.tipo) {
      case 'message.received':
        return this.recebida(tenantId, ev);
      case 'message.sent':
        return this.atualizarStatus(tenantId, ev.messageId ? [ev.messageId] : [], 'sent');
      case 'message.delivered':
        return this.atualizarStatus(tenantId, ev.messageIds, 'delivered');
      case 'message.read':
        return this.atualizarStatus(tenantId, ev.messageIds, 'read');
      case 'message.failed':
        return this.falhou(tenantId, ev);
      case 'instance.connected':
      case 'instance.disconnected':
      case 'instance.auth_failed':
        return this.instancia(tenantId, ev);
      default:
        return 'ignorado';
    }
  }

  /**
   * Mensagem do contato → inbox. Grupo e `from_me` ficam de fora nesta versão:
   * grupo não é atendimento 1:1, e `from_me` é a própria empresa digitando no
   * celular (registrar isso como humano é a próxima melhoria — doc 18).
   */
  private async recebida(tenantId: string, ev: EventoStevoApi): Promise<DesfechoEvento> {
    if (ev.isGroup || ev.fromMe) return 'ignorado';
    const numero = numeroDoJid(ev.chat) ?? numeroDoJid(ev.from);
    if (!numero) return 'ignorado';
    const midia = ev.midia ?? null;
    const texto = ev.texto?.trim() || midia?.legenda || (midia ? ROTULO_MIDIA[midia.tipo] : ev.conteudoTipo && ev.conteudoTipo !== 'text' ? `[${ev.conteudoTipo}]` : '');
    if (!texto) return 'ignorado';
    const r = await this.mensagens.receiveInbound({
      tenantId,
      fromNumber: numero,
      fromName: ev.pushName ?? undefined,
      text: texto.slice(0, 4000),
      // id do WhatsApp quando houver; senão o event_id (único e estável em retries).
      providerMessageId: `stevo_api:${ev.messageId ?? ev.eventId}`,
    });
    if ('conversationId' in r && r.conversationId) {
      // Depois da mensagem já estar na tela: foto do contato e mídia, sem atrasar o texto.
      void this.depoisDaEntrada(tenantId, r.conversationId, texto.slice(0, 4000), midia).catch((e: Error) => this.log.warn(`pós-entrada falhou: ${e.message.slice(0, 160)}`));
    }
    return 'entrada';
  }

  /** Foto de perfil (se ausente/vencida) e mídia recebida guardada no anexo da mensagem. */
  private async depoisDaEntrada(tenantId: string, conversationId: string, texto: string, midia: MidiaEntrada | null) {
    const alvo = await this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { contact: { select: { id: true, fotoEm: true } } } });
      const msg = midia
        ? await tx.message.findFirst({ where: { conversationId, autorTipo: 'contato', corpo: texto, anexo: { equals: Prisma.DbNull } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
        : null;
      return { contato: conv?.contact ?? null, msgId: msg?.id ?? null };
    });
    this.avatares?.revalidarSeVencido(tenantId, alvo.contato);
    if (!midia || !alvo.msgId) return;

    const bruto = await this.baixar(midia);
    if (!bruto) return;
    const mime = midia.mime ?? (midia.tipo === 'figurinha' ? 'image/webp' : 'application/octet-stream');
    const nome = midia.nome ?? `${midia.tipo}-${alvo.msgId.slice(0, 8)}`;
    const base = { tipo: midia.tipo, mime, nome, tamanho: bruto.length, ...(midia.legenda ? { legenda: midia.legenda } : {}) };
    let anexo: Record<string, unknown> | null = null;
    if (this.storage?.configurado()) {
      const storageKey = `inbox/${tenantId}/${alvo.msgId}`;
      await this.storage.enviar(storageKey, bruto, mime);
      anexo = { ...base, storageKey };
    } else if (bruto.length <= LIMITE_INLINE) {
      // Sem S3: mídia pequena (figurinha, foto, áudio curto) vai junto da mensagem.
      anexo = { ...base, dataUrl: `data:${mime};base64,${bruto.toString('base64')}` };
    }
    if (!anexo) return;
    await this.prisma.withTenant(tenantId, (tx) => tx.message.update({ where: { id: alvo.msgId! }, data: { anexo: anexo as Prisma.InputJsonValue } }));
    // A tela recarrega a conversa ao receber a atualização.
    this.realtime?.publicar(tenantId, 'conversation.updated', { id: conversationId });
  }

  /** Mídia por URL https (até 15 MB) ou base64 que veio no evento. */
  private async baixar(m: MidiaEntrada): Promise<Buffer | null> {
    if (m.base64) return Buffer.from(m.base64, 'base64');
    if (!m.url) return null;
    const res = await fetch(m.url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    if (!res.ok) { this.log.warn(`download da mídia recusado: HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 15 * 1024 * 1024 ? null : buf;
  }

  private async atualizarStatus(tenantId: string, ids: string[], novo: 'sent' | 'delivered' | 'read'): Promise<DesfechoEvento> {
    if (!ids.length) return 'ignorado';
    const avancaveis = Object.entries(ORDEM).filter(([, n]) => n < ORDEM[novo]).map(([s]) => s);
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.message.updateMany({
        where: { providerId: { in: ids }, deliveryStatus: { in: avancaveis } },
        data: { deliveryStatus: novo, ...(novo === 'sent' ? { sentAt: new Date() } : {}) },
      }),
    );
    return r.count ? 'status' : 'ignorado';
  }

  private async falhou(tenantId: string, ev: EventoStevoApi): Promise<DesfechoEvento> {
    if (!ev.messageId) return 'ignorado';
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.message.updateMany({
        where: { providerId: ev.messageId!, deliveryStatus: { notIn: ['delivered', 'read'] } },
        data: { deliveryStatus: 'failed', deliveryError: 'stevo: message.failed' },
      }),
    );
    return 'status';
  }

  /** Estado da instância → integração do tenant (o painel mostra conectado/caiu). */
  private async instancia(tenantId: string, ev: EventoStevoApi): Promise<DesfechoEvento> {
    const conectado = ev.tipo === 'instance.connected';
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({
        where: { provider: 'stevo_api', externalBusinessId: ev.instanciaId, status: { not: 'revoked' } },
        data: {
          status: conectado ? 'connected' : 'disconnected',
          health: conectado ? 'ok' : 'error',
          erro: conectado ? null : `${ev.tipo}${ev.motivo ? `: ${ev.motivo}` : ''}`.slice(0, 300),
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    );
    if (!conectado) this.log.warn(`instância ${ev.instanciaId.slice(0, 8)}… ${ev.tipo} (tenant ${tenantId.slice(0, 8)}…)`);
    return 'instancia';
  }
}
