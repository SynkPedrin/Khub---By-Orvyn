import { HttpException } from '@nestjs/common';

/**
 * Erros das APIs do Google traduzidos para algo que o operador entende.
 *
 * Formato do corpo de erro do Google (AIP-193, https://google.aip.dev/193):
 * `{ error: { code, message, status, details: [{ '@type': '...ErrorInfo', reason, domain, metadata }] } }`.
 * OAuth (https://developers.google.com/identity/protocols/oauth2/web-server) devolve
 * `{ error: 'invalid_grant', error_description }` no endpoint de token.
 *
 * Nunca devolvemos 401 ao browser: o cliente web trata 401 como sessão KHUB
 * expirada e faria logout. Token Google revogado vira 409 `google_reconectar`.
 */
export type ProdutoGoogle = 'oauth' | 'tag_manager' | 'search_console' | 'meu_negocio';

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly produto: ProdutoGoogle,
    readonly googleStatus: string | null,
    readonly reason: string | null,
    /** true quando não sabemos se o Google executou (timeout/5xx). */
    readonly incerto: boolean,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

interface CorpoErro {
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] } | string;
  error_description?: string;
}

/** Monta o GoogleApiError a partir da resposta crua (sem confiar no formato). */
export function erroDeResposta(httpStatus: number, corpo: unknown, produto: ProdutoGoogle): GoogleApiError {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as CorpoErro;
  if (typeof c.error === 'string') {
    return new GoogleApiError(c.error_description ?? c.error, httpStatus, produto, c.error, c.error, httpStatus >= 500);
  }
  const e = c.error ?? {};
  const reason = Array.isArray(e.details) ? e.details.map((d) => d?.reason).find((r): r is string => typeof r === 'string') ?? null : null;
  return new GoogleApiError(e.message ?? `HTTP ${httpStatus}`, httpStatus, produto, e.status ?? null, reason, httpStatus >= 500);
}

export type TipoErroGoogle =
  | 'reconectar'
  | 'escopo_insuficiente'
  | 'api_desativada'
  | 'meu_negocio_sem_acesso'
  | 'sem_permissao'
  | 'nao_encontrado'
  | 'limite'
  | 'invalido'
  | 'indisponivel';

const API_DESATIVADA = /has not been used in project|it is disabled|accessNotConfigured|API not enabled|is not enabled/i;
const ESCOPO = /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i;

/** Classificação pura (testada): decide a mensagem e o status HTTP que a UI recebe. */
export function classificarErroGoogle(e: Pick<GoogleApiError, 'httpStatus' | 'produto' | 'googleStatus' | 'reason' | 'message'>): TipoErroGoogle {
  const texto = `${e.reason ?? ''} ${e.googleStatus ?? ''} ${e.message}`;
  if (e.produto === 'oauth' && (e.googleStatus === 'invalid_grant' || e.httpStatus === 400 || e.httpStatus === 401)) return 'reconectar';
  if (e.httpStatus === 401) return 'reconectar';
  if (e.httpStatus === 403 || e.httpStatus === 429) {
    if (ESCOPO.test(texto)) return 'escopo_insuficiente';
    const desativada = e.reason === 'SERVICE_DISABLED' || API_DESATIVADA.test(texto);
    // Perfil da Empresa: projeto sem acesso aprovado responde 403 (API não
    // habilitada/não permitida) ou 429 com cota 0 por minuto (doc "prereqs":
    // "0 QPM means the project has not been approved yet").
    if (e.produto === 'meu_negocio' && (desativada || e.httpStatus === 429 || /not allowed|has not been approved|quota/i.test(texto))) {
      return 'meu_negocio_sem_acesso';
    }
    if (desativada) return 'api_desativada';
    if (e.httpStatus === 429) return 'limite';
    return 'sem_permissao';
  }
  if (e.httpStatus === 404) return 'nao_encontrado';
  if (e.httpStatus === 400) return 'invalido';
  return 'indisponivel';
}

const NOME_API: Record<ProdutoGoogle, string> = {
  oauth: 'Google OAuth',
  tag_manager: 'Tag Manager API',
  search_console: 'Google Search Console API',
  meu_negocio: 'APIs do Perfil da Empresa',
};

export const MENSAGEM_MEU_NEGOCIO_SEM_ACESSO =
  'O Google bloqueou as APIs do Perfil da Empresa (Google Meu Negócio) para o projeto do Google Cloud do KHUB. ' +
  'Essas APIs exigem aprovação: o dono do projeto precisa enviar o formulário de contato da GBP API escolhendo ' +
  '"Application for Basic API Access" e, depois de aprovado (cota de 300 requisições por minuto), ativar no Google Cloud ' +
  'as APIs "Google My Business API", "My Business Account Management API", "My Business Business Information API" e ' +
  '"Business Profile Performance API". Enquanto a cota estiver em 0, nenhuma chamada passa.';

/** Converte em exceção HTTP com `code` estável (o filtro RFC 7807 preserva). */
export function paraHttp(e: GoogleApiError): HttpException {
  const tipo = classificarErroGoogle(e);
  const api = NOME_API[e.produto];
  switch (tipo) {
    case 'reconectar':
      return new HttpException({ code: 'google_reconectar', title: 'A conexão com o Google expirou ou foi revogada. Conecte de novo em Integrações.' }, 409);
    case 'escopo_insuficiente':
      return new HttpException({ code: 'google_escopo_insuficiente', produto: e.produto, title: `A conta Google conectada não autorizou o acesso necessário para ${api}. Reconecte e marque todas as permissões.` }, 409);
    case 'meu_negocio_sem_acesso':
      return new HttpException({ code: 'google_meu_negocio_sem_acesso', title: MENSAGEM_MEU_NEGOCIO_SEM_ACESSO, detalhe: e.message }, 403);
    case 'api_desativada':
      return new HttpException({ code: 'google_api_desativada', produto: e.produto, title: `A ${api} não está ativada no projeto do Google Cloud. Ative a API no console do Google Cloud e tente de novo.`, detalhe: e.message }, 403);
    case 'sem_permissao':
      return new HttpException({ code: 'google_sem_permissao', produto: e.produto, title: `A conta Google conectada não tem permissão nesse recurso (${api}).`, detalhe: e.message }, 403);
    case 'nao_encontrado':
      return new HttpException({ code: 'google_nao_encontrado', produto: e.produto, title: 'O Google não encontrou esse recurso. Ele pode ter sido removido ou a conta perdeu o acesso.' }, 404);
    case 'limite':
      return new HttpException({ code: 'google_limite', produto: e.produto, title: `O Google limitou as chamadas da ${api}. Aguarde um minuto e tente de novo.` }, 429);
    case 'invalido':
      return new HttpException({ code: 'google_requisicao_invalida', produto: e.produto, title: `O Google recusou o pedido: ${e.message}` }, 400);
    default:
      return new HttpException({ code: 'google_indisponivel', produto: e.produto, title: `${api} indisponível no momento. Tente de novo em instantes.` }, 502);
  }
}

/** Executa uma chamada ao Google e converte a falha na exceção HTTP legível. */
export async function viaGoogle<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GoogleApiError) throw paraHttp(e);
    throw e;
  }
}
