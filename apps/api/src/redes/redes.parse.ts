import { comEngajamento, duracaoIso } from './redes.metricas';
import type { PontoSerie, PostRede } from './redes.tipos';

/**
 * Parsers das respostas das redes (só campos documentados em DOC_REDES).
 * Ausente na resposta = `null`; nunca preenchido.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Número de JSON ou string numérica (o YouTube devolve contagens como string). */
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
};

/* ------------------------------------------------------------------ */
/* Instagram (DOC_REDES.igUsuario, igMidia, igInsightsMidia, igInsightsConta) */
/* ------------------------------------------------------------------ */

export interface IgConta {
  id: string | null;
  usuario: string | null;
  nome: string | null;
  foto: string | null;
  seguidores: number | null;
  seguindo: number | null;
  publicacoes: number | null;
}

export const CAMPOS_IG_CONTA = 'id,username,name,profile_picture_url,followers_count,follows_count,media_count';

export function parseIgConta(j: unknown): IgConta {
  const o = obj(j);
  return {
    id: str(o.id),
    usuario: str(o.username),
    nome: str(o.name),
    foto: str(o.profile_picture_url),
    seguidores: num(o.followers_count),
    seguindo: num(o.follows_count),
    publicacoes: num(o.media_count),
  };
}

export const CAMPOS_IG_MIDIA = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

export interface IgMidia {
  id: string;
  tipo: string;
  produto: string | null;
  legenda: string;
  miniatura: string | null;
  link: string | null;
  publicadoEm: string | null;
  curtidas: number | null;
  comentarios: number | null;
}

export function parseIgMidias(j: unknown): { itens: IgMidia[]; depois: string | null } {
  const o = obj(j);
  const itens: IgMidia[] = [];
  for (const raw of arr(o.data)) {
    const m = obj(raw);
    const id = str(m.id);
    if (!id) continue;
    const tipo = str(m.media_type) ?? 'IMAGE';
    itens.push({
      id,
      tipo,
      produto: str(m.media_product_type),
      legenda: str(m.caption) ?? '',
      // thumbnail_url só existe em VIDEO; media_url pode faltar (áudio licenciado): DOC_REDES.igMidia.
      miniatura: tipo === 'VIDEO' ? str(m.thumbnail_url) ?? null : str(m.media_url) ?? str(m.thumbnail_url),
      link: str(m.permalink),
      publicadoEm: str(m.timestamp),
      // like_count é omitido quando o dono esconde as curtidas.
      curtidas: num(m.like_count),
      comentarios: num(m.comments_count),
    });
  }
  const paging = obj(o.paging);
  return { itens, depois: paging.next ? str(obj(paging.cursors).after) : null };
}

/** Métricas de insights de mídia pedidas (DOC_REDES.igInsightsMidia; FEED e REELS). */
export const METRICAS_IG_MIDIA = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const;

/**
 * Valores de `/insights` por métrica. Aceita os dois formatos documentados:
 * `values: [{ value }]` (soma os pontos) e `total_value: { value }`.
 */
export function parseIgInsights(j: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of arr(obj(j).data)) {
    const d = obj(raw);
    const nome = str(d.name);
    if (!nome) continue;
    const total = num(obj(d.total_value).value);
    if (total != null) {
      out[nome] = total;
      continue;
    }
    const valores = arr(d.values).map((v) => num(obj(v).value)).filter((v): v is number => v != null);
    if (valores.length) out[nome] = valores.reduce((a, b) => a + b, 0);
  }
  return out;
}

/** Série diária de uma métrica `time_series` (`values: [{ value, end_time }]`). */
export function parseIgSerie(j: unknown, metrica: string): PontoSerie[] {
  for (const raw of arr(obj(j).data)) {
    const d = obj(raw);
    if (d.name !== metrica) continue;
    return arr(d.values)
      .map((v) => ({ fim: str(obj(v).end_time), valor: num(obj(v).value) }))
      .filter((p): p is { fim: string; valor: number } => !!p.fim && p.valor != null)
      .map((p) => ({ dia: p.fim.slice(0, 10), valor: p.valor }))
      .sort((a, b) => a.dia.localeCompare(b.dia));
  }
  return [];
}

export function postDeIg(m: IgMidia, ins: Record<string, number> | null): PostRede {
  return {
    id: m.id,
    tipo: m.produto === 'REELS' ? 'reels' : m.tipo === 'CAROUSEL_ALBUM' ? 'carrossel' : m.tipo === 'VIDEO' ? 'video' : 'imagem',
    legenda: m.legenda,
    miniatura: m.miniatura,
    link: m.link,
    publicadoEm: m.publicadoEm,
    duracaoSeg: null,
    metricas: comEngajamento({
      visualizacoes: ins?.views ?? null,
      alcance: ins?.reach ?? null,
      curtidas: ins?.likes ?? m.curtidas,
      comentarios: ins?.comments ?? m.comentarios,
      compartilhamentos: ins?.shares ?? null,
      salvamentos: ins?.saved ?? null,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* TikTok (DOC_REDES.tiktokUsuario, tiktokVideos, tiktokVideoObjeto)   */
/* ------------------------------------------------------------------ */

export const CAMPOS_TIKTOK_USUARIO = 'open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count';
export const CAMPOS_TIKTOK_VIDEO = 'id,create_time,cover_image_url,share_url,video_description,duration,title,like_count,comment_count,share_count,view_count';

export interface TiktokUsuario {
  openId: string | null;
  nome: string | null;
  usuario: string | null;
  foto: string | null;
  seguidores: number | null;
  seguindo: number | null;
  curtidas: number | null;
  videos: number | null;
}

export function parseTiktokUsuario(j: unknown): TiktokUsuario {
  const u = obj(obj(obj(j).data).user);
  return {
    openId: str(u.open_id),
    nome: str(u.display_name),
    usuario: str(u.username),
    foto: str(u.avatar_url),
    seguidores: num(u.follower_count),
    seguindo: num(u.following_count),
    curtidas: num(u.likes_count),
    videos: num(u.video_count),
  };
}

export function parseTiktokVideos(j: unknown): { posts: PostRede[]; cursor: number | null; temMais: boolean } {
  const d = obj(obj(j).data);
  const posts: PostRede[] = [];
  for (const raw of arr(d.videos)) {
    const v = obj(raw);
    const id = str(v.id);
    if (!id) continue;
    const criado = num(v.create_time);
    posts.push({
      id,
      tipo: 'video',
      legenda: str(v.video_description) ?? str(v.title) ?? '',
      miniatura: str(v.cover_image_url),
      link: str(v.share_url),
      publicadoEm: criado != null ? new Date(criado * 1000).toISOString() : null,
      duracaoSeg: num(v.duration),
      metricas: comEngajamento({
        visualizacoes: num(v.view_count),
        alcance: null,
        curtidas: num(v.like_count),
        comentarios: num(v.comment_count),
        compartilhamentos: num(v.share_count),
        salvamentos: null,
      }),
    });
  }
  return { posts, cursor: num(d.cursor), temMais: d.has_more === true };
}

/* ------------------------------------------------------------------ */
/* YouTube (DOC_REDES.ytCanais, ytPlaylistItems, ytVideos, ytAnalytics) */
/* ------------------------------------------------------------------ */

export interface YtCanal {
  id: string | null;
  titulo: string | null;
  usuario: string | null;
  foto: string | null;
  /** null quando o canal esconde o número (hiddenSubscriberCount). */
  inscritos: number | null;
  visualizacoes: number | null;
  videos: number | null;
  uploads: string | null;
}

const miniaturaYt = (thumbs: unknown): string | null => {
  const t = obj(thumbs);
  return str(obj(t.medium).url) ?? str(obj(t.high).url) ?? str(obj(t.default).url);
};

export function parseYtCanal(j: unknown): YtCanal {
  const c = obj(arr(obj(j).items)[0]);
  const s = obj(c.snippet);
  const st = obj(c.statistics);
  return {
    id: str(c.id),
    titulo: str(s.title),
    usuario: str(s.customUrl),
    foto: miniaturaYt(s.thumbnails),
    inscritos: st.hiddenSubscriberCount === true ? null : num(st.subscriberCount),
    visualizacoes: num(st.viewCount),
    videos: num(st.videoCount),
    uploads: str(obj(obj(c.contentDetails).relatedPlaylists).uploads),
  };
}

export function parseYtPlaylist(j: unknown): { ids: string[]; proximo: string | null } {
  const o = obj(j);
  const ids = arr(o.items)
    .map((raw) => str(obj(obj(raw).contentDetails).videoId) ?? str(obj(obj(obj(raw).snippet).resourceId).videoId))
    .filter((x): x is string => !!x);
  return { ids, proximo: str(o.nextPageToken) };
}

export function parseYtVideos(j: unknown): PostRede[] {
  const posts: PostRede[] = [];
  for (const raw of arr(obj(j).items)) {
    const v = obj(raw);
    const id = str(v.id);
    if (!id) continue;
    const s = obj(v.snippet);
    const st = obj(v.statistics);
    const duracao = duracaoIso(str(obj(v.contentDetails).duration));
    posts.push({
      id,
      tipo: 'video',
      legenda: str(s.title) ?? '',
      miniatura: miniaturaYt(s.thumbnails),
      link: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      publicadoEm: str(s.publishedAt),
      duracaoSeg: duracao,
      metricas: comEngajamento({
        visualizacoes: num(st.viewCount),
        alcance: null,
        curtidas: num(st.likeCount),
        comentarios: num(st.commentCount),
        compartilhamentos: null,
        salvamentos: null,
      }),
    });
  }
  return posts;
}

/** Tabela do YouTube Analytics (`columnHeaders` + `rows`) → objetos por nome de coluna. */
export function parseYtRelatorio(j: unknown): Record<string, string | number>[] {
  const o = obj(j);
  const nomes = arr(o.columnHeaders).map((h) => str(obj(h).name) ?? '');
  return arr(o.rows).map((r) => {
    const linha: Record<string, string | number> = {};
    arr(r).forEach((v, i) => {
      if (!nomes[i]) return;
      linha[nomes[i]] = typeof v === 'number' ? v : String(v);
    });
    return linha;
  });
}
