/**
 * Mídia RECEBIDA pelo WhatsApp (figurinha, imagem, áudio, vídeo, documento).
 *
 * A documentação da Stevo diz que mensagens de mídia "usam `media`", mas não
 * documenta os campos (doc lida em 2026-11-11). Por isso a extração é
 * defensiva: aceita as grafias comuns (url/link/media_url, mimetype/mime_type,
 * base64/data) e o webhook registra só os NOMES das chaves que chegaram (nunca
 * valores) para confirmarmos o formato real no primeiro evento.
 */
export type TipoEntrada = 'figurinha' | 'imagem' | 'audio' | 'video' | 'documento';

export interface MidiaEntrada {
  tipo: TipoEntrada;
  url: string | null;
  base64: string | null;
  mime: string | null;
  nome: string | null;
  legenda: string | null;
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Tipo da mensagem da Stevo → tipo de anexo do KHUB. `null` = não é mídia. */
export function tipoDeEntrada(tipo: string | null): TipoEntrada | null {
  switch ((tipo ?? '').toLowerCase()) {
    case 'sticker': case 'stickermessage': return 'figurinha';
    case 'image': case 'imagemessage': return 'imagem';
    case 'audio': case 'audiomessage': case 'ptt': case 'voice': return 'audio';
    case 'video': case 'videomessage': return 'video';
    case 'document': case 'documentmessage': return 'documento';
    default: return null;
  }
}

/** Extrai a mídia do `data` do evento (campos na raiz ou em `media`). */
export function extrairMidia(data: Record<string, unknown> | null | undefined): MidiaEntrada | null {
  const d = data ?? {};
  const tipo = tipoDeEntrada(s(d.type));
  if (!tipo) return null;
  const m = (d.media && typeof d.media === 'object' && !Array.isArray(d.media) ? d.media : {}) as Record<string, unknown>;
  const pega = (...k: string[]) => { for (const c of k) { const v = s(m[c]) ?? s(d[c]); if (v) return v; } return null; };
  const url = pega('url', 'link', 'media_url', 'mediaUrl', 'download_url', 'downloadUrl', 'direct_path');
  const base64 = pega('base64', 'data', 'media_base64');
  return {
    tipo,
    url: url && /^https:\/\//i.test(url) ? url : null,
    base64: base64 && /^[A-Za-z0-9+/=\r\n]+$/.test(base64.slice(0, 200)) ? base64 : null,
    mime: pega('mimetype', 'mime_type', 'mimeType', 'mime'),
    nome: pega('filename', 'file_name', 'fileName', 'name'),
    legenda: pega('caption'),
  };
}

/** Só os nomes das chaves (diagnóstico do formato real, sem dado pessoal). */
export function chavesDaMidia(data: Record<string, unknown> | null | undefined): string {
  const d = data ?? {};
  const media = d.media && typeof d.media === 'object' ? Object.keys(d.media as object) : [];
  return `data:[${Object.keys(d).sort().join(',')}] media:[${media.sort().join(',')}]`;
}

/** Limite para guardar mídia pequena direto na mensagem quando não há storage S3. */
export const LIMITE_INLINE = 1_500_000;

/** Texto que aparece no Inbox enquanto/caso a mídia não esteja disponível. */
export const ROTULO_MIDIA: Record<TipoEntrada, string> = {
  figurinha: '🖼️ Figurinha',
  imagem: '📷 Imagem',
  audio: '🎤 Áudio',
  video: '🎬 Vídeo',
  documento: '📎 Documento',
};
