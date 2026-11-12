import type { Rede } from './canais.tipos';

/**
 * Evento de Conversas extraído do webhook da Meta. Formatos (doc oficial):
 * - DM (Messenger `object: 'page'` e Instagram `object: 'instagram'`):
 *   `entry[].messaging[]` com `sender.id`, `recipient.id`, `timestamp`,
 *   `message.mid`, `message.text`, `message.is_echo`
 *   (https://developers.facebook.com/docs/messenger-platform/webhooks ·
 *    https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook).
 * - Comentário do Instagram: `entry[].changes[]` com `field: 'comments'` e
 *   `value.{comment_id, parent_id, text, from.{id,username}, media.{id,media_product_type}}`
 *   (https://developers.facebook.com/documentation/instagram-platform/webhooks/examples).
 * - Comentário de post da página: `field: 'feed'`, `value.item: 'comment'`,
 *   `value.verb: 'add'`, `comment_id`, `post_id`, `parent_id`, `from.{id,name}`, `message`
 *   (https://developers.facebook.com/docs/graph-api/webhooks/reference/page/).
 */
export interface EventoCanal {
  rede: Extract<Rede, 'instagram' | 'messenger'>;
  /** Canal gravado na conversa: Instagram, Messenger ou Facebook (comentário da página). */
  canal: 'Instagram' | 'Messenger' | 'Facebook';
  tipo: 'dm' | 'comentario';
  /** Conta do tenant que recebeu (page id ou IG id): roteia o tenant. */
  contaId: string;
  /** Id do cliente na rede (IGSID/PSID/autor do comentário). */
  autorId: string;
  autorNome?: string;
  texto: string;
  /** Id único do evento na rede (mid ou comment_id): idempotência. */
  idExterno: string;
  /** Comentário: id do comentário RAIZ do fio (o próprio, se for de topo). */
  fioId?: string;
  /** Comentário: post/mídia de onde veio. */
  origem?: { postId?: string; midiaId?: string; tipoMidia?: string };
  recebidoEm: Date;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : undefined);

function quando(v: unknown): Date {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // A Meta manda ms (messaging) ou s (created_time do feed).
  return new Date(n < 1e12 ? n * 1000 : n);
}

/** Extrai DMs e comentários. Ignora eco (`is_echo`: enviado pela própria conta), leitura, reação e mídia sem texto. */
export function eventosDeConversa(body: unknown): EventoCanal[] {
  const b = obj(body);
  if (!b) return [];
  const objeto = b.object;
  if (objeto !== 'page' && objeto !== 'instagram') return [];
  const rede: EventoCanal['rede'] = objeto === 'instagram' ? 'instagram' : 'messenger';
  const out: EventoCanal[] = [];
  for (const e of Array.isArray(b.entry) ? b.entry : []) {
    const entry = obj(e);
    const contaId = str(entry?.id);
    if (!entry || !contaId) continue;

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const ev = obj(m);
      const msg = obj(ev?.message);
      const autorId = str(obj(ev?.sender)?.id);
      const mid = str(msg?.mid);
      const texto = str(msg?.text);
      if (!ev || !msg || !autorId || !mid || !texto) continue;
      if (msg.is_echo === true || autorId === contaId) continue;
      out.push({ rede, canal: rede === 'instagram' ? 'Instagram' : 'Messenger', tipo: 'dm', contaId, autorId, texto, idExterno: mid, recebidoEm: quando(ev.timestamp) });
    }

    for (const c of Array.isArray(entry.changes) ? entry.changes : []) {
      const ch = obj(c);
      const v = obj(ch?.value);
      if (!ch || !v) continue;
      if (rede === 'instagram' && ch.field === 'comments') {
        const from = obj(v.from);
        const idComentario = str(v.comment_id) ?? str(v.id);
        const texto = str(v.text);
        const autorId = str(from?.id);
        if (!idComentario || !texto || !autorId || autorId === contaId) continue;
        const media = obj(v.media);
        out.push({
          rede, canal: 'Instagram', tipo: 'comentario', contaId, autorId, autorNome: str(from?.username), texto,
          idExterno: idComentario, fioId: str(v.parent_id) ?? idComentario,
          origem: { midiaId: str(media?.id), tipoMidia: str(media?.media_product_type) },
          recebidoEm: quando(entry.time),
        });
      }
      if (rede === 'messenger' && ch.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        const from = obj(v.from);
        const idComentario = str(v.comment_id);
        const texto = str(v.message);
        const autorId = str(from?.id);
        const postId = str(v.post_id);
        if (!idComentario || !texto || !autorId || autorId === contaId) continue;
        const pai = str(v.parent_id);
        out.push({
          rede, canal: 'Facebook', tipo: 'comentario', contaId, autorId, autorNome: str(from?.name), texto,
          // Comentário de topo tem parent_id = post_id: o fio é ele mesmo.
          idExterno: idComentario, fioId: pai && pai !== postId ? pai : idComentario,
          origem: { postId },
          recebidoEm: quando(v.created_time ?? entry.time),
        });
      }
    }
  }
  return out;
}
