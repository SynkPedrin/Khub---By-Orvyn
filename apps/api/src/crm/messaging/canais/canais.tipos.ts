/**
 * Canais conectados de Conversas (db/063). Fonte de cada endpoint, escopo e
 * campo usado no módulo: a documentação OFICIAL citada em `DOC`. O que não foi
 * confirmável nela fica gated, com o motivo dito na tela.
 */

export type Rede = 'instagram' | 'messenger' | 'youtube' | 'tiktok';
/** Provedor de OAuth da conexão (Instagram e Messenger saem do mesmo login da Meta). */
export type ProvedorCanal = 'meta' | 'youtube' | 'tiktok';

export const DOC = {
  /** Envio de DM do Instagram: `POST /{PAGE-ID}/messages` com token da página, `instagram_manage_messages`. */
  instagramEnvio: 'https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message',
  /** Webhook `messages` do Instagram (`object: 'instagram'`, `entry[].messaging[]`, `is_echo`). */
  instagramWebhook: 'https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook',
  /** Payload do campo `comments` (Facebook Login): `comment_id`, `parent_id`, `from`, `media`. */
  instagramWebhookExemplos: 'https://developers.facebook.com/documentation/instagram-platform/webhooks/examples',
  /** Permissões por campo de webhook do Instagram (Facebook Login). */
  instagramWebhookCampos: 'https://developers.facebook.com/documentation/instagram-platform/webhooks/fields',
  /** Assinatura do webhook: `POST /{page-id}/subscribed_apps?subscribed_fields=...` com token da página. */
  instagramWebhookSetup: 'https://developers.facebook.com/documentation/instagram-platform/webhooks/setup',
  /** Responder comentário do Instagram: `POST /{ig-comment-id}/replies?message=`. */
  instagramResposta: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies',
  /** Messenger: `POST /{PAGE-ID}/messages`, `messaging_type: RESPONSE`, `pages_messaging`, janela de 24 h. */
  messengerEnvio: 'https://developers.facebook.com/docs/messenger-platform/send-messages',
  /** Webhook do Messenger e `subscribed_apps` (`pages_messaging`, `pages_manage_metadata`). */
  messengerWebhook: 'https://developers.facebook.com/docs/messenger-platform/webhooks',
  /** Campo `feed` da página (comentários: `item: 'comment'`, `verb: 'add'`). */
  paginaFeed: 'https://developers.facebook.com/docs/graph-api/webhooks/reference/page/',
  /** Responder comentário da página: `POST /{comment-id}/comments`, `pages_manage_engagement`. */
  paginaResposta: 'https://developers.facebook.com/docs/graph-api/reference/object/comments/',
  /** YouTube: `GET /youtube/v3/commentThreads` (`allThreadsRelatedToChannelId`). */
  youtubeLista: 'https://developers.google.com/youtube/v3/docs/commentThreads/list',
  /** YouTube: `POST /youtube/v3/comments?part=snippet` (`snippet.parentId`, `snippet.textOriginal`), escopo `youtube.force-ssl`. */
  youtubeResposta: 'https://developers.google.com/youtube/v3/docs/comments/insert',
  /** OAuth 2.0 do Google para apps web (`accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token`). */
  googleOauth: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
  /** Canal do usuário: `GET /youtube/v3/channels?part=id,snippet&mine=true`. */
  youtubeCanal: 'https://developers.google.com/youtube/v3/docs/channels/list',
  /** TikTok API for Business (visão geral): Business Messaging API e Organic API. */
  tiktok: 'https://ads.tiktok.com/help/article?aid=11971',
} as const;

/**
 * Escopos da Meta pedidos SÓ para Conversas (nunca junto com Ads/Lead Ads:
 * um escopo não liberado derruba o diálogo inteiro — ver MetaAdsConnector).
 * Cada um vem da doc citada:
 * - pages_show_list, pages_manage_metadata: listar a página e assinar o webhook (messengerWebhook, instagramWebhookSetup);
 * - pages_messaging: DM do Messenger (messengerEnvio);
 * - instagram_basic, instagram_manage_messages: DM do Instagram (instagramEnvio, instagramWebhook);
 * - instagram_manage_comments, pages_read_engagement: comentários do Instagram (instagramWebhookCampos, instagramResposta);
 * - pages_manage_engagement: responder comentário da página (paginaResposta).
 */
export const ESCOPOS_META_CONVERSAS = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
] as const;

/** Escopo do YouTube exigido por `comments.insert` (DOC.youtubeResposta); também cobre a leitura. */
export const ESCOPO_YOUTUBE = 'https://www.googleapis.com/auth/youtube.force-ssl';

/** Credencial guardada CIFRADA em `channel_connections.credentials_encrypted`. */
export interface CredencialCanal {
  /** Token da página (Meta) ou access token do Google. */
  accessToken: string;
  /** Token do usuário que conectou (Meta): a doc de `/{ig-comment-id}/replies` pede token de usuário. */
  userAccessToken?: string;
  refreshToken?: string;
  /** ISO. */
  expiresAt?: string;
}

/** Valor de `conversations.canal` por rede (e para comentário de página do Facebook). */
export const CANAL_POR_REDE: Record<Rede, string> = {
  instagram: 'Instagram',
  messenger: 'Messenger',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};
export const CANAL_FACEBOOK = 'Facebook';
