import type { RedeSocial, SecaoStatus } from './redes.tipos';
import { DOC_REDES } from './redes.tipos';

/**
 * Tradução PRECISA dos erros de cada rede para a tela: qual permissão, escopo
 * ou revisão falta, ou se é token vencido/limite. Nunca "algo deu errado".
 *
 * Fontes: DOC_REDES.metaErros (Graph API), DOC_REDES.tiktokPublicar e
 * tiktokStatus (códigos do TikTok), DOC_REDES.ytErros (Google).
 */
export type TipoErroRede = 'permissao' | 'token' | 'limite' | 'config' | 'dados' | 'indisponivel' | 'outro';

export interface InfoErroRede {
  tipo: TipoErroRede;
  mensagem: string;
  /** Permissões/escopos/revisões que faltam (quando dá para saber). */
  faltando: string[];
  /** Código cru da rede (para suporte). */
  codigo: string | null;
  httpStatus: number;
  doc: string;
}

export class ErroRede extends Error {
  constructor(
    readonly rede: RedeSocial,
    readonly info: InfoErroRede,
  ) {
    super(info.mensagem);
    this.name = 'ErroRede';
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : undefined);

const PERMISSAO_META = /\b(instagram_[a-z_]+|pages_[a-z_]+|business_management|ads_management|ads_read|read_insights)\b/g;

/** Erro da Graph API (`{ error: { message, type, code, error_subcode } }`). */
export function mapearErroMeta(httpStatus: number, corpo: unknown, esperadas: readonly string[]): InfoErroRede {
  const e = obj(obj(corpo).error);
  const code = typeof e.code === 'number' ? e.code : Number(e.code ?? NaN);
  const sub = typeof e.error_subcode === 'number' ? e.error_subcode : Number(e.error_subcode ?? NaN);
  const msg = str(e.error_user_msg) ?? str(e.message) ?? `HTTP ${httpStatus}`;
  const codigo = Number.isFinite(code) ? `${code}${Number.isFinite(sub) ? `/${sub}` : ''}` : null;
  const base = { codigo, httpStatus, doc: DOC_REDES.metaErros };

  // (#10) "Not enough viewers": é falta de dado (menos de 5), não de permissão.
  if (/not enough viewers/i.test(msg)) return { ...base, tipo: 'dados', mensagem: 'Poucas visualizações: a Meta só mostra insights a partir de 5.', faltando: [] };
  if (code === 190 || [458, 460, 463, 467].includes(sub)) {
    return { ...base, tipo: 'token', mensagem: 'O acesso à conta da Meta expirou ou foi revogado. Conecte o Instagram de novo.', faltando: [] };
  }
  if (code === 10 || code === 3 || (code >= 200 && code <= 299)) {
    const citadas = [...new Set(msg.match(PERMISSAO_META) ?? [])];
    const faltando = citadas.length ? citadas : [...esperadas];
    return {
      ...base,
      tipo: 'permissao',
      mensagem: `A Meta recusou por falta de permissão (${faltando.join(', ')}). Reconecte aceitando todas as permissões; fora do modo de desenvolvimento, o app precisa da Revisão do App aprovada para elas.`,
      faltando,
    };
  }
  if ([4, 17, 32, 341, 613].includes(code)) return { ...base, tipo: 'limite', mensagem: 'Limite de chamadas da Meta atingido. Tente de novo em alguns minutos.', faltando: [] };
  if (code === 368) return { ...base, tipo: 'limite', mensagem: 'A Meta bloqueou temporariamente esta ação por política da plataforma.', faltando: [] };
  if (code === 1 || code === 2 || httpStatus >= 500) return { ...base, tipo: 'indisponivel', mensagem: 'A Meta está instável agora. Tente de novo em instantes.', faltando: [] };
  if (code === 100) return { ...base, tipo: 'dados', mensagem: `A Meta não aceitou a consulta: ${msg}`, faltando: [] };
  return { ...base, tipo: 'outro', mensagem: `A Meta recusou: ${msg}`, faltando: [] };
}

/**
 * Erro do TikTok: API v2 `{ error: { code, message, log_id } }` (200 com
 * code != 'ok' também é erro) ou OAuth `{ error, error_description }`.
 */
export function mapearErroTiktok(httpStatus: number, corpo: unknown, esperados: readonly string[]): InfoErroRede {
  const c = obj(corpo);
  const e = obj(c.error);
  const code = str(e.code) ?? str(c.error) ?? `http_${httpStatus}`;
  const msg = str(e.message) ?? str(c.error_description) ?? '';
  const base = { codigo: code, httpStatus, doc: DOC_REDES.tiktokPublicar };
  switch (code) {
    case 'scope_not_authorized':
      return { ...base, doc: DOC_REDES.tiktokUsuario, tipo: 'permissao', mensagem: `O TikTok não autorizou o escopo (${esperados.join(', ')}). Reconecte aceitando todos os acessos; o app precisa ter esse escopo aprovado no portal do TikTok.`, faltando: [...esperados] };
    case 'access_token_invalid':
    case 'invalid_grant':
      return { ...base, tipo: 'token', mensagem: 'O acesso ao TikTok expirou ou foi revogado. Conecte o TikTok de novo.', faltando: [] };
    case 'unaudited_client_can_only_post_to_private_accounts':
      return { ...base, tipo: 'permissao', mensagem: 'O app do TikTok ainda não passou na auditoria do Content Posting API: só publica em modo privado (Somente eu).', faltando: ['Auditoria do Content Posting API (TikTok)'] };
    case 'url_ownership_unverified':
      return { ...base, tipo: 'config', mensagem: 'O domínio da URL do vídeo não foi verificado no portal do TikTok (exigido para PULL_FROM_URL).', faltando: ['Verificação do domínio/prefixo de URL no portal do TikTok'] };
    case 'privacy_level_option_mismatch':
      return { ...base, tipo: 'dados', mensagem: 'A privacidade escolhida não está entre as permitidas para esta conta do TikTok.', faltando: [] };
    case 'spam_risk_too_many_posts':
      return { ...base, tipo: 'limite', mensagem: 'A conta atingiu o limite diário de publicações do TikTok.', faltando: [] };
    case 'spam_risk_user_banned_from_posting':
      return { ...base, tipo: 'permissao', mensagem: 'O TikTok bloqueou esta conta de publicar.', faltando: [] };
    case 'reached_active_user_cap':
      return { ...base, tipo: 'limite', mensagem: 'O app atingiu a cota diária de usuários publicando no TikTok.', faltando: [] };
    case 'rate_limit_exceeded':
      return { ...base, tipo: 'limite', mensagem: 'Limite de chamadas do TikTok atingido. Tente de novo em um minuto.', faltando: [] };
    default:
      if (httpStatus === 401) return { ...base, tipo: 'token', mensagem: 'O acesso ao TikTok expirou ou foi revogado. Conecte o TikTok de novo.', faltando: [] };
      if (httpStatus >= 500) return { ...base, tipo: 'indisponivel', mensagem: 'O TikTok está instável agora. Tente de novo em instantes.', faltando: [] };
      return { ...base, tipo: 'outro', mensagem: `O TikTok recusou (${code})${msg ? `: ${msg}` : ''}`, faltando: [] };
  }
}

/** Erro do Google (`{ error: { code, message, status, errors:[{reason}], details:[{reason}] } }` ou OAuth `{ error }`). */
export function mapearErroGoogle(httpStatus: number, corpo: unknown, esperados: readonly string[]): InfoErroRede {
  const c = obj(corpo);
  const e = obj(c.error);
  const motivos = [
    ...(Array.isArray(e.errors) ? e.errors : []).map((x) => str(obj(x).reason)),
    ...(Array.isArray(e.details) ? e.details : []).map((x) => str(obj(x).reason)),
    str(e.status),
    typeof c.error === 'string' ? c.error : undefined,
  ].filter((x): x is string => !!x);
  const tem = (...r: string[]) => r.some((x) => motivos.includes(x));
  const msg = str(e.message) ?? str(c.error_description) ?? `HTTP ${httpStatus}`;
  const base = { codigo: motivos[0] ?? `http_${httpStatus}`, httpStatus, doc: DOC_REDES.ytErros };

  if (tem('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return { ...base, tipo: 'permissao', mensagem: `O Google não liberou o escopo necessário (${esperados.join(', ')}). Reconecte o YouTube aceitando todos os acessos.`, faltando: [...esperados] };
  }
  if (tem('accessNotConfigured', 'SERVICE_DISABLED')) {
    return { ...base, tipo: 'config', mensagem: `A API não está ativada no projeto do Google Cloud: ${msg}`, faltando: ['Ativar a API no Google Cloud Console (YouTube Data API v3 e YouTube Analytics API)'] };
  }
  if (tem('invalid_grant', 'authError', 'UNAUTHENTICATED') || httpStatus === 401) {
    return { ...base, tipo: 'token', mensagem: 'O acesso ao YouTube expirou ou foi revogado. Conecte o YouTube de novo.', faltando: [] };
  }
  if (tem('quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED', 'uploadLimitExceeded')) {
    return { ...base, tipo: 'limite', mensagem: 'A cota diária da API do YouTube acabou. Tente de novo amanhã.', faltando: [] };
  }
  if (httpStatus === 403) return { ...base, tipo: 'permissao', mensagem: `O YouTube recusou o acesso: ${msg}`, faltando: [...esperados] };
  if (httpStatus >= 500) return { ...base, tipo: 'indisponivel', mensagem: 'O YouTube está instável agora. Tente de novo em instantes.', faltando: [] };
  return { ...base, tipo: 'outro', mensagem: `O YouTube recusou: ${msg}`, faltando: [] };
}

/** Converte qualquer erro numa seção da tela (partes do painel falham sozinhas). */
export function secaoDeErro(err: unknown): SecaoStatus {
  if (err instanceof ErroRede) {
    const status: SecaoStatus['status'] =
      err.info.tipo === 'permissao' ? 'sem_permissao' : err.info.tipo === 'token' ? 'token' : err.info.tipo === 'limite' ? 'limite' : err.info.tipo === 'config' ? 'config' : err.info.tipo === 'dados' ? 'sem_dados' : 'erro';
    return { status, mensagem: err.info.mensagem, faltando: err.info.faltando.length ? err.info.faltando : undefined, doc: err.info.doc };
  }
  return { status: 'erro', mensagem: `Falha ao consultar a rede: ${(err as Error)?.message ?? 'erro desconhecido'}` };
}
