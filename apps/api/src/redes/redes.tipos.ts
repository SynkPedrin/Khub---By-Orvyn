/**
 * Redes sociais da subconta (db/068): Instagram, TikTok e YouTube.
 *
 * Cada endpoint, campo, métrica e permissão usado no módulo foi conferido na
 * documentação OFICIAL citada em `DOC_REDES` (consulta de 2026-11-13). O que
 * a doc não garante não é usado nem simulado.
 */
import type { CredencialCanal } from '../crm/messaging/canais/canais.tipos';

export type RedeSocial = 'instagram' | 'tiktok' | 'youtube';
export const REDES_SOCIAIS: readonly RedeSocial[] = ['instagram', 'tiktok', 'youtube'];
export const ehRedeSocial = (v: string): v is RedeSocial => (REDES_SOCIAIS as readonly string[]).includes(v);

export const DOC_REDES = {
  /** `GET /{ig-user-id}/media`: instagram_basic + pages_read_engagement (ou pages_show_list); até 10 mil mídias; paginação por since/until. */
  igMidiaLista: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
  /** Campos da IG Media (like_count some quando o dono esconde curtidas; thumbnail_url só em VIDEO; media_url pode faltar). */
  igMidia: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media',
  /** Campos da IG User (followers_count, follows_count, media_count, username, profile_picture_url). */
  igUsuario: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user',
  /**
   * `GET /{ig-media-id}/insights`: instagram_basic + instagram_manage_insights + pages_read_engagement.
   * Métricas: views, reach, likes, comments, shares, saved, total_interactions (FEED e REELS).
   * `impressions` descontinuada para mídia criada depois de 2024-07-02. Sem insights em filhos de carrossel.
   * Erro #10 "Not enough viewers" quando o valor é menor que 5.
   */
  igInsightsMidia: 'https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights',
  /**
   * `GET /{ig-user-id}/insights`: mesmas permissões. `reach` aceita time_series (period=day);
   * views, accounts_engaged, total_interactions, likes, comments, shares, saves só total_value.
   * `impressions` descontinuada na v22.0 e em todas as versões desde 2025-04-21. Conta com menos de 100 seguidores não tem insights de seguidores.
   */
  igInsightsConta: 'https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights',
  /**
   * Publicação: `POST /{ig-user-id}/media` (image_url JPEG público | video_url + media_type=REELS, caption),
   * `GET /{container-id}?fields=status_code` (EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED; consultar 1x/min),
   * `POST /{ig-user-id}/media_publish` (creation_id). Permissões: instagram_basic, instagram_content_publish,
   * pages_read_engagement. 100 publicações por 24 h. A API não agenda: o agendamento é do KHUB.
   */
  igPublicacao: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
  /** Erros da Graph API: 190 token, 10 e 200 a 299 permissão, 4/17/341 limite, 368 bloqueio. */
  metaErros: 'https://developers.facebook.com/docs/graph-api/guides/error-handling',
  /** Token longo: `GET oauth/access_token?grant_type=fb_exchange_token` (cerca de 60 dias); token de página derivado não expira. */
  metaTokenLongo: 'https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived',

  /** Login Kit Web: `https://www.tiktok.com/v2/auth/authorize/` (client_key, scope separado por vírgula, response_type=code, redirect_uri https sem query, state). */
  tiktokLogin: 'https://developers.tiktok.com/doc/login-kit-web',
  /** `POST https://open.tiktokapis.com/v2/oauth/token/` (form): client_key, client_secret, code, grant_type, redirect_uri. Access 2 h, refresh 180 dias, refresh rotaciona. */
  tiktokToken: 'https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token',
  tiktokRefresh: 'https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token',
  /** `POST https://open.tiktokapis.com/v2/oauth/revoke/` (client_key, client_secret, token). */
  tiktokRevogar: 'https://developers.tiktok.com/docs/en/oauth-revoke-a-user-access-token',
  /** `GET /v2/user/info/?fields=`: user.info.basic (open_id, avatar_url, display_name), user.info.profile (username), user.info.stats (follower_count, following_count, likes_count, video_count). */
  tiktokUsuario: 'https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info',
  /** `POST /v2/video/list/?fields=` body {cursor, max_count ≤ 20}, escopo video.list; resposta data.videos, cursor, has_more. */
  tiktokVideos: 'https://developers.tiktok.com/doc/tiktok-api-v2-video-list',
  /** Campos do vídeo: id, create_time, cover_image_url (TTL 6 h), share_url, video_description, duration, title, like_count, comment_count, share_count, view_count. */
  tiktokVideoObjeto: 'https://developers.tiktok.com/doc/tiktok-api-v2-video-object',
  /** `POST /v2/post/publish/creator_info/query/` (video.publish): privacy_level_options, creator_nickname, max_video_post_duration_sec. */
  tiktokCriador: 'https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info',
  /** `POST /v2/post/publish/video/init/` post_info {title, privacy_level, disable_*} + source_info {source: PULL_FROM_URL, video_url}. Cliente sem auditoria só publica privado. */
  tiktokPublicar: 'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post',
  /** `POST /v2/post/publish/status/fetch/` {publish_id}: PROCESSING_DOWNLOAD, PUBLISH_COMPLETE, FAILED (fail_reason), publicaly_available_post_id. */
  tiktokStatus: 'https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status',
  tiktokInicio: 'https://developers.tiktok.com/doc/content-posting-api-get-started',

  /** `channels.list?part=snippet,statistics,contentDetails&mine=true` (1 unidade): statistics.viewCount, subscriberCount, hiddenSubscriberCount, videoCount; contentDetails.relatedPlaylists.uploads. */
  ytCanais: 'https://developers.google.com/youtube/v3/docs/channels',
  /** `playlistItems.list` (1 unidade, maxResults 0 a 50, pageToken). */
  ytPlaylistItems: 'https://developers.google.com/youtube/v3/docs/playlistItems/list',
  /** `videos.list` statistics: viewCount, likeCount, commentCount (dislikeCount privado, favoriteCount sempre 0); contentDetails.duration ISO 8601. */
  ytVideos: 'https://developers.google.com/youtube/v3/docs/videos',
  /** `videos.insert` (escopos youtube.upload, youtube, youtubepartner ou youtube.force-ssl); status.privacyStatus; status.publishAt só com privado. */
  ytInsert: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  /** Envio retomável: POST ...upload/youtube/v3/videos?uploadType=resumable (X-Upload-Content-Length/Type) → Location → PUT bytes → 201. */
  ytUploadRetomavel: 'https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol',
  /** Erros: 403 insufficientPermissions, 403 quotaExceeded. */
  ytErros: 'https://developers.google.com/youtube/v3/docs/errors',
  /** `GET https://youtubeanalytics.googleapis.com/v2/reports` ids=channel==MINE, startDate, endDate, metrics, dimensions; escopo yt-analytics.readonly. */
  ytAnalytics: 'https://developers.google.com/youtube/analytics/reference/reports/query',
  /** Relatório por dia (views, likes, comments, shares, subscribersGained, subscribersLost, estimatedMinutesWatched). */
  ytAnalyticsRelatorios: 'https://developers.google.com/youtube/analytics/channel_reports',
} as const;

/**
 * Permissões da Meta para a gestão de redes (Instagram com login do Facebook).
 * Pedidas JUNTO com as de Conversas (`ESCOPOS_META_CONVERSAS`): a conta do
 * Instagram é a mesma linha de `channel_connections` nos dois módulos, então o
 * token guardado precisa servir aos dois.
 */
export const ESCOPOS_META_REDES = ['instagram_basic', 'instagram_manage_insights', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'] as const;
/** Permissões exigidas por recurso (DOC_REDES.igMidiaLista, igInsightsMidia, igPublicacao). */
export const PERMISSOES_IG = {
  midias: ['instagram_basic', 'pages_read_engagement'],
  insights: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement'],
  publicar: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'],
} as const;

/** Escopos do Google: leitura/escrita do canal (Data API e videos.insert) + YouTube Analytics. */
export const ESCOPOS_GOOGLE_REDES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const;
export const ESCOPO_YT_ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';

/** Escopos do TikTok (Login Kit + Display API + Content Posting API). */
export const ESCOPOS_TIKTOK = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.publish'] as const;

/** Credencial cifrada em `channel_connections.credentials_encrypted` (superset da de Conversas). */
export interface CredencialRede extends CredencialCanal {
  /** TikTok: validade do refresh token (ISO). */
  refreshExpiresAt?: string;
  /** TikTok: open_id do usuário. */
  openId?: string;
}

/* ------------------------------------------------------------------ */
/* Contrato devolvido para a tela                                      */
/* ------------------------------------------------------------------ */

/** Estado de uma seção que depende de permissão/credencial (nunca número inventado). */
export interface SecaoStatus {
  status: 'ok' | 'sem_permissao' | 'token' | 'limite' | 'config' | 'sem_dados' | 'erro';
  mensagem?: string;
  /** Permissões, escopos ou revisões que faltam, quando a rede disse qual. */
  faltando?: string[];
  doc?: string;
}

export interface MetricasPost {
  visualizacoes: number | null;
  alcance: number | null;
  curtidas: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
  salvamentos: number | null;
  /** Interações / base (alcance, ou visualizações quando a rede não dá alcance), em %. */
  engajamento: number | null;
}

export interface PostRede {
  id: string;
  tipo: string;
  legenda: string;
  miniatura: string | null;
  link: string | null;
  publicadoEm: string | null;
  duracaoSeg: number | null;
  metricas: MetricasPost;
}

export interface PontoSerie {
  dia: string;
  valor: number;
}

export interface Kpi {
  chave: string;
  rotulo: string;
  valor: number | null;
  /** Variação no período (%), quando há base de comparação real. */
  variacao: number | null;
  formato: 'numero' | 'percentual' | 'minutos';
}

export interface ContaRedeResumo {
  conexaoId: string;
  nome: string;
  externalId: string;
  usuario: string | null;
  foto: string | null;
  seguidores: number | null;
  publicacoes: number | null;
}

export interface PainelRede {
  rede: RedeSocial;
  conectado: boolean;
  /** 501 de credencial do app: a tela mostra a variável que falta. */
  gate: { provider: string; missing: string[] } | null;
  contas: { id: string; nome: string; status: string; erro: string | null }[];
  conta: ContaRedeResumo | null;
  periodoDias: number;
  kpis: Kpi[];
  kpisStatus: SecaoStatus;
  posts: PostRede[];
  postsStatus: SecaoStatus;
  metricasPostStatus: SecaoStatus;
  ranking: PostRede[];
  crescimento: { seguidores: PontoSerie[]; alcance: PontoSerie[]; fonteSeguidores: 'snapshots' | 'rede'; status: SecaoStatus };
  publicacao: { disponivel: boolean; formatos: string[]; motivo?: string; faltando?: string[]; doc: string };
  docs: string[];
}
