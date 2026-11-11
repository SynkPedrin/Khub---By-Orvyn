import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { DeliveryError, type MessagingProvider } from './stevo.provider';
import type { MidiaSaida } from './provider.contract';

/**
 * STEVO — API de GESTÃO (`https://openapi.stevo.chat/v1`).
 *
 * Contrato tirado da especificação oficial (`openapi.stevo.chat/openapi.yaml`)
 * e dos tipos do SDK oficial `stevo-sdk` — nenhum endpoint inventado (ADR-0031:
 * a Stevo é só transporte; a inteligência é do KHUB).
 *
 * Diferente do `StevoProvider` antigo (API de instância, uma instância global
 * no .env): aqui cada TENANT tem sua instância, vinculada em `integrations`
 * (provider `stevo_api`, `external_business_id` = id da instância).
 */

/** Erro padrão da API: `{ error: { code, message, request_id, retryable } }`. */
export class StevoApiError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    readonly retryable: boolean,
    readonly requestId: string | null,
  ) {
    super(`stevo_api_${status}_${codigo}`);
    this.name = 'StevoApiError';
  }
}

export interface StevoInstancia {
  id: string;
  name: string;
  instance_name: string | null;
  status: string | null;
  engine: string | null;
  connected: boolean;
  profile_name: string | null;
  external_ref: string | null;
}

export interface StevoMe {
  key: { name: string; scopes: string[]; allowed_instance_ids: string[] | null; rate_limit_per_minute?: number };
}

/** Escopos que o KHUB usa (menor privilégio — doc 18 §5). */
export const ESCOPOS_NECESSARIOS: Record<string, string> = {
  'instances:read': 'listar instâncias e ver conexão',
  'instances:write': 'vincular instância (external_ref)',
  'messages:send': 'enviar mensagens',
  'messages:read': 'consultar status de entrega',
  'webhooks:write': 'criar o webhook de conta',
};
/** `instances:manage` é sinônimo legado de `instances:write` (doc oficial). */
const SINONIMOS: Record<string, string> = { 'instances:manage': 'instances:write', 'ai:manage': 'ai:write' };

@Injectable()
export class StevoApiProvider implements MessagingProvider {
  private readonly log = new Logger('StevoApi');

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('stevo_api');
  }
  missing(): string[] {
    return this.config.missingVars('stevo_api');
  }

  private base(): string {
    return (this.config.get('STEVO_API_BASE_URL') ?? 'https://openapi.stevo.chat').replace(/\/+$/, '');
  }

  /** Chamada autenticada. Nunca loga a chave nem o corpo (pode ter dado pessoal). */
  private async req<T>(metodo: string, caminho: string, opts: { corpo?: unknown; idempotencyKey?: string } = {}): Promise<{ status: number; dados: T; replay: boolean }> {
    this.config.require('stevo_api'); // 501 config_required se faltar a chave
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.get('STEVO_REVENUE_API_KEY')}`,
      accept: 'application/json',
      'user-agent': 'khub-revenue-os/1.0',
    };
    if (opts.corpo !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    const res = await fetch(`${this.base()}${caminho}`, {
      method: metodo,
      headers,
      body: opts.corpo !== undefined ? JSON.stringify(opts.corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    const j = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; retryable?: boolean; request_id?: string } };
    if (!res.ok) {
      const e = j.error ?? {};
      throw new StevoApiError(res.status, e.code ?? 'desconhecido', e.retryable ?? (res.status === 429 || res.status >= 500), e.request_id ?? null);
    }
    return { status: res.status, dados: j.data as T, replay: res.headers.get('idempotent-replayed') === 'true' };
  }

  /** `GET /v1/me` — conta, escopos e restrição de instâncias da chave. */
  async me(): Promise<StevoMe> {
    return (await this.req<StevoMe>('GET', '/v1/me')).dados;
  }

  /** Escopos que faltam para o KHUB (para a UI dizer "falta permissão X"). */
  async escoposFaltando(): Promise<{ escopo: string; para: string }[]> {
    const { key } = await this.me();
    const tem = new Set(key.scopes.map((s) => SINONIMOS[s] ?? s));
    return Object.entries(ESCOPOS_NECESSARIOS).filter(([e]) => !tem.has(e)).map(([escopo, para]) => ({ escopo, para }));
  }

  async listarInstancias(): Promise<StevoInstancia[]> {
    return (await this.req<StevoInstancia[]>('GET', '/v1/instances')).dados ?? [];
  }

  async obterInstancia(id: string): Promise<StevoInstancia> {
    return (await this.req<StevoInstancia>('GET', `/v1/instances/${encodeURIComponent(id)}`)).dados;
  }

  /** `GET /v1/instances/{id}/connection` → conectado / logado / número pareado. */
  async conexao(id: string): Promise<{ connected: boolean; logged_in: boolean; phone_number: string | null }> {
    return (await this.req<{ connected: boolean; logged_in: boolean; phone_number: string | null }>('GET', `/v1/instances/${encodeURIComponent(id)}/connection`)).dados;
  }

  /**
   * `GET /v1/instances/{id}/qr` — `qr` já vem como data URI (`data:image/png;base64,…`),
   * pronto pra `<img src>`; `null` até o servidor gerar (chamador relê em instantes).
   * O campo `pairing_code` da API NÃO é um código curto digitável — é o payload
   * bruto do QR (string gigante do protocolo Baileys) — por isso não é exposto
   * aqui: mostrar isso como "código" na UI enganaria o usuário.
   */
  async obterQrCode(id: string): Promise<{ qr: string | null }> {
    const { dados } = await this.req<{ qr: string | null }>('GET', `/v1/instances/${encodeURIComponent(id)}/qr`);
    return { qr: dados.qr };
  }

  /** `POST /v1/instances/{id}/qr/refresh` — força QR novo (o anterior pode ter expirado). */
  async atualizarQrCode(id: string): Promise<{ qr: string | null }> {
    const { dados } = await this.req<{ qr: string | null }>('POST', `/v1/instances/${encodeURIComponent(id)}/qr/refresh`);
    return { qr: dados.qr };
  }

  /** `PATCH /v1/instances/{id}` — `external_ref` = tenant dono (verificação cruzada no webhook). */
  async definirExternalRef(id: string, externalRef: string | null): Promise<StevoInstancia> {
    return (await this.req<StevoInstancia>('PATCH', `/v1/instances/${encodeURIComponent(id)}`, { corpo: { external_ref: externalRef } })).dados;
  }

  /**
   * `GET /v1/instances/{id}` — resolve `server_url` + `token` (a apikey da
   * instância SM v2). CREDENCIAL FORTE: nunca logar, nunca persistir em
   * claro; usar só na hora e descartar.
   */
  async acessoInstancia(id: string): Promise<{ serverUrl: string; token: string } | null> {
    const { dados } = await this.req<{ server_url?: string | null; token?: string | null }>('GET', `/v1/instances/${encodeURIComponent(id)}`);
    return dados.server_url && dados.token ? { serverUrl: dados.server_url, token: dados.token } : null;
  }

  /**
   * SM v2 da instância: `POST /user/avatar` → URL assinada da foto de perfil
   * do WhatsApp (pps.whatsapp.net — expira; quem grava deve guardar o
   * timestamp junto, ver db/037). `null` quando o número não tem foto ou a
   * instância recusa.
   */
  async avatarDoNumero(serverUrl: string, token: string, numero: string): Promise<string | null> {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/user/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: token, authorization: `Bearer ${token}` },
      body: JSON.stringify({ number: numero, preview: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { data?: { url?: string } };
    return j.data?.url ?? null;
  }

  /** `POST /v1/webhooks` — o `secret` (whsec_…) só volta NESTA resposta. */
  async criarWebhookConta(url: string, eventos: string[], descricao: string): Promise<{ id: string; secret: string }> {
    const { dados } = await this.req<{ id: string; secret: string }>('POST', '/v1/webhooks', { corpo: { url, events: eventos, description: descricao } });
    return { id: dados.id, secret: dados.secret };
  }

  async listarWebhooks(): Promise<{ id: string; url: string; events: string[]; active: boolean; disabled_reason: string | null }[]> {
    return (await this.req<{ id: string; url: string; events: string[]; active: boolean; disabled_reason: string | null }[]>('GET', '/v1/webhooks')).dados ?? [];
  }

  /**
   * `POST /v1/instances/{id}/messages` (texto). `to` = só dígitos, com DDI.
   * Com `Idempotency-Key` a repetição é segura: replay devolve o mesmo resultado
   * sem reenviar. Erros viram `DeliveryError` com a semântica DOCUMENTADA:
   *  - 429 rate_limited, 409 idempotency_in_progress, 502 upstream_unavailable,
   *    503 idempotency_unavailable → nada enviado, pode repetir;
   *  - 504 upstream_timeout e demais 5xx → PODE ter enviado (incerto);
   *  - `send_failed` (502, recusa do motor), `not_ready`, `idempotency_conflict` e
   *    4xx restantes → falha definitiva.
   */
  async sendText(number: string, text: string, instanceId?: string, idempotencyKey?: string): Promise<{ providerId?: string }> {
    return this.enviar(number, { text }, instanceId, idempotencyKey);
  }

  /** A API de gestão só aceita `media_url` (sem base64): mídia exige storage. */
  readonly aceitaBase64 = false;

  /**
   * Mídia pelo MESMO endpoint do texto. Especificação oficial
   * (`openapi.stevo.chat/openapi.yaml`, `POST /v1/instances/{id}/messages`):
   * `to` + `media_url` + `media_type` (image|video|audio|document) +
   * `caption?` + `filename?`. Não há campo de base64 — sem URL, recusa.
   */
  async sendMedia(number: string, midia: MidiaSaida, instanceId?: string, idempotencyKey?: string): Promise<{ providerId?: string }> {
    if (!midia.url) throw new DeliveryError(400, { retryable: false, uncertain: false, codigo: 'midia_sem_url' });
    const media_type = midia.tipo === 'imagem' ? 'image' : midia.tipo === 'audio' ? 'audio' : 'document';
    return this.enviar(number, { media_url: midia.url, media_type, filename: midia.nome, ...(midia.legenda ? { caption: midia.legenda } : {}) }, instanceId, idempotencyKey);
  }

  private async enviar(number: string, conteudo: Record<string, string>, instanceId?: string, idempotencyKey?: string): Promise<{ providerId?: string }> {
    if (!instanceId) throw new DeliveryError(400, { retryable: false, uncertain: false, codigo: 'sem_instancia' });
    const to = (number || '').replace(/\D/g, '');
    try {
      const { dados } = await this.req<{ message_id: string | null; sent: boolean }>('POST', `/v1/instances/${encodeURIComponent(instanceId)}/messages`, {
        corpo: { to, ...conteudo },
        idempotencyKey,
      });
      return { providerId: dados?.message_id ?? undefined };
    } catch (e) {
      if (!(e instanceof StevoApiError)) {
        // Rede/timeout do nosso lado: a Stevo pode ter recebido → incerto.
        throw new DeliveryError(0, { retryable: false, uncertain: true, codigo: 'rede' });
      }
      const seguroRepetir = ['rate_limited', 'idempotency_in_progress', 'upstream_unavailable', 'idempotency_unavailable'].includes(e.codigo);
      // `send_failed` chega como 502 mas é recusa do motor (4xx) — falha definitiva, não incerta.
      const definitivo = ['send_failed', 'not_ready', 'idempotency_conflict'].includes(e.codigo);
      const incerto = !seguroRepetir && !definitivo && (e.codigo === 'upstream_timeout' || e.status >= 500);
      this.log.warn(`envio recusado: ${e.status} ${e.codigo} (request ${e.requestId ?? '-'})`);
      throw new DeliveryError(e.status, { retryable: seguroRepetir, uncertain: incerto, codigo: e.codigo });
    }
  }
}
