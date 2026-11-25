import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RealtimeService } from '../../../realtime/realtime.service';
import { AvatarContatoService } from '../avatar-contato.service';
import { acharContatoPorTelefone } from '../../telefone';
import { horaCurta } from '../../../common/hora';
import { ROTULO_MIDIA, type TipoEntrada } from '../midia-entrada';

/** Mensagem do histórico como o gateway manda (CONTRATO.md §2, `ChatHistorico`). */
export interface MensagemHistorico {
  id: string;
  deMim: boolean;
  texto: string;
  tipo: string;
  timestamp: number;
}
export interface ChatHistorico {
  numero: string;
  nome?: string | null;
  fotoUrl?: string | null;
  mensagens: MensagemHistorico[];
}

/** Chave de dedupe compartilhada com a entrada ao vivo (webhook_events, provider 'stevo'). */
export const eventoDaMensagem = (tenantId: string, waId: string) => `${tenantId}:openwa:${waId}`;

/** Texto que vai para `messages.corpo`: legenda/texto, ou o rótulo da mídia. */
export function corpoDaMensagem(m: { texto?: string | null; tipo?: string | null }): string {
  const t = (m.texto ?? '').trim();
  if (t) return t.slice(0, 4000);
  const tipo = (m.tipo ?? '') as TipoEntrada;
  return ROTULO_MIDIA[tipo] ?? (m.tipo && m.tipo !== 'texto' ? `[${m.tipo}]` : '');
}

/**
 * Importa o histórico do WhatsApp (open-wa) para o inbox — ADR-0058.
 *
 * Regras:
 *  - **Nada dispara:** a transação liga `khub.historico = on` (db/083) e o
 *    gatilho de outbox não gera `contact.created` nem `message.created` — a IA
 *    não responde mensagem antiga e o "Novo Lead" não roda para contato antigo.
 *  - **Sem duplicar:** cada mensagem reserva `webhook_events` com a MESMA chave
 *    da entrada ao vivo (`<tenant>:openwa:<id>`); a que já chegou ao vivo (ou
 *    que o próprio KHUB enviou, `provider_id`) é pulada. Reimportar é seguro.
 *  - Mensagens entram com a hora original (`created_at`), `delivery_status =
 *    'historico'`, sem mexer em não-lidas; a conversa vai para a posição da
 *    última mensagem (não para o topo).
 *  - Conversa criada aqui nasce com atendimento humano (ninguém responde sozinho).
 */
@Injectable()
export class OpenWaHistoricoService {
  private readonly log = new Logger('OpenWaHistorico');

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly avatares?: AvatarContatoService,
  ) {}

  async importarLote(tenantId: string, chats: ChatHistorico[]): Promise<{ conversas: number; mensagens: number }> {
    let conversas = 0;
    let mensagens = 0;
    for (const chat of chats) {
      try {
        const r = await this.importarChat(tenantId, chat);
        if (!r) continue;
        conversas++;
        mensagens += r.inseridas;
        if (r.inseridas) this.realtime?.publicar(tenantId, 'conversation.updated', { id: r.conversationId });
        if (chat.fotoUrl && r.semFoto) void this.avatares?.guardarDeUrl(tenantId, r.contactId, chat.fotoUrl, 'whatsapp');
      } catch (e) {
        // Um chat ruim não derruba o lote; o próximo pedido de histórico tenta de novo (idempotente).
        this.log.warn(`chat do histórico não importado: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    return { conversas, mensagens };
  }

  private async importarChat(tenantId: string, chat: ChatHistorico) {
    const numero = String(chat.numero ?? '').replace(/\D/g, '');
    if (numero.length < 8) return null;
    const linhas = (chat.mensagens ?? [])
      .filter((m) => m && typeof m.id === 'string' && m.id && Number.isFinite(m.timestamp))
      .map((m) => ({ id: m.id.slice(0, 200), deMim: !!m.deMim, corpo: corpoDaMensagem(m), em: new Date(m.timestamp * 1000) }))
      .filter((m) => m.corpo)
      .sort((a, b) => a.em.getTime() - b.em.getTime());
    if (!linhas.length) return null;

    return this.prisma.withTenant(tenantId, async (tx) => {
      // Só nesta transação: o outbox ignora o que for gravado aqui (db/083).
      await tx.$executeRaw`SELECT set_config('khub.historico', 'on', true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + numero},0))`;

      const achadoId = await acharContatoPorTelefone(tx, numero);
      const nome = (chat.nome ?? '').trim().slice(0, 120) || numero;
      const contato = achadoId
        ? await tx.contact.findUnique({ where: { id: achadoId }, select: { id: true, nome: true, fotoUrl: true, lastInboundAt: true } })
        : await tx.contact.create({ data: { tenantId, nome, telefone: numero, tag: 'Lead', origem: 'WhatsApp' }, select: { id: true, nome: true, fotoUrl: true, lastInboundAt: true } });
      if (!contato) return null;

      const ultima = linhas[linhas.length - 1];
      let conv = await tx.conversation.findFirst({ where: { contactId: contato.id, canal: 'WhatsApp' }, select: { id: true, updatedAt: true } });
      if (!conv) {
        conv = await tx.conversation.create({
          data: { tenantId, contactId: contato.id, nome: contato.nome, canal: 'WhatsApp', atendimento: 'humano', status: 'aberta', naoLidas: 0, ultimaPrevia: ultima.corpo.slice(0, 140), ultimaHora: horaCurta(ultima.em), updatedAt: ultima.em, createdAt: linhas[0].em },
          select: { id: true, updatedAt: true },
        });
      }

      const lote = JSON.stringify(linhas.map((l) => ({ ev: eventoDaMensagem(tenantId, l.id), wa: l.id, autor: l.deMim ? 'humano' : 'contato', corpo: l.corpo, hora: horaCurta(l.em), em: l.em.toISOString() })));
      const inseridas = await tx.$executeRaw`
        WITH entrada AS (
          SELECT * FROM jsonb_to_recordset(${lote}::jsonb) AS r(ev text, wa text, autor text, corpo text, hora text, em timestamptz)
        ), reservadas AS (
          INSERT INTO webhook_events (tenant_id, provider, event_id, payload, processed_at)
          SELECT ${tenantId}::uuid, 'stevo', e.ev, '{}'::jsonb, now() FROM entrada e
          WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.tenant_id = ${tenantId}::uuid AND m.provider_id = e.wa)
          ON CONFLICT (provider, event_id) DO NOTHING
          RETURNING event_id
        )
        INSERT INTO messages (tenant_id, conversation_id, autor_tipo, corpo, hora, created_at, delivery_status, idempotency_key, provider_id)
        SELECT ${tenantId}::uuid, ${conv.id}::uuid, e.autor, e.corpo, e.hora, e.em, 'historico', 'wa:' || e.wa, e.wa
        FROM entrada e JOIN reservadas r ON r.event_id = e.ev
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`;

      // A conversa só "anda" se o histórico tiver mensagem mais nova que a última conhecida.
      if (inseridas && ultima.em > conv.updatedAt) {
        await tx.conversation.update({ where: { id: conv.id }, data: { ultimaPrevia: ultima.corpo.slice(0, 140), ultimaHora: horaCurta(ultima.em), updatedAt: ultima.em } });
      }
      const ultimaDoContato = [...linhas].reverse().find((l) => !l.deMim);
      if (inseridas && ultimaDoContato && (!contato.lastInboundAt || contato.lastInboundAt < ultimaDoContato.em)) {
        await tx.contact.update({ where: { id: contato.id }, data: { lastInboundAt: ultimaDoContato.em } });
      }
      return { conversationId: conv.id, contactId: contato.id, inseridas, semFoto: !contato.fotoUrl?.startsWith('/api/fotos/') };
    });
  }

  /** Quanto do histórico já está no KHUB (para a tela de Integrações). */
  async resumo(tenantId: string): Promise<{ mensagens: number; conversas: number }> {
    const [r] = await this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<{ mensagens: bigint; conversas: bigint }[]>`
        SELECT count(*)::bigint AS mensagens, count(DISTINCT conversation_id)::bigint AS conversas
        FROM messages WHERE delivery_status = 'historico'`,
    );
    return { mensagens: Number(r?.mensagens ?? 0), conversas: Number(r?.conversas ?? 0) };
  }
}
