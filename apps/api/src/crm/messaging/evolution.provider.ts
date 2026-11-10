import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { CircuitBreaker } from '../../common/circuit-breaker';
import { DeliveryError } from './stevo.provider';
import type { MidiaSaida } from './provider.contract';

/**
 * EVOLUTION API — WhatsApp NÃO OFICIAL (Baileys), self-hosted.
 *
 * CANAL_MVP do projeto (CLAUDE.md: "WhatsApp (Evolution API primeiro, Cloud
 * API em F5)"). Contrato verificado contra uma instância real v2.3.7
 * (`GET /` → `{"version":"2.3.7", ...}`), não copiado de documentação de
 * outra versão — ver docs/EVOLUTION_SETUP.md para o histórico da verificação.
 *
 * Duas chaves, dois papéis — este é o ponto que mais gera bug em integrações
 * Evolution (Brief de recuperação, Fase 5):
 *   - `EVOLUTION_API_KEY` (env, "chave global"): dona do servidor. Cria,
 *     conecta, apaga instância. Só o backend do KHUB a conhece.
 *   - token por-instância (devolvido por `/instance/create`, no campo
 *     `hash`): identifica UMA instância. É o que fica cifrado em
 *     `integrations.credentials_encrypted` por tenant. A chave global
 *     TAMBÉM autentica qualquer instância — por isso todo método aqui usa
 *     sempre a global, nunca pede o token da instância de volta.
 */

export type EstadoConexao =
  | 'desconectado'
  | 'criando'
  | 'conectando'
  | 'qr_disponivel'
  | 'conectado'
  | 'erro';

export interface QrNormalizado {
  qrImageDataUrl?: string;
  qrText?: string;
  pairingCode?: string;
  /** Evolution não devolve validade explícita; QR de WhatsApp expira em ~30–60s. */
  expiresAt: string;
}

export interface InstanciaCriada {
  qr?: QrNormalizado;
  /** Nome da instância no servidor Evolution — vira `external_business_id`. */
  instanceName: string;
  /** Token específico desta instância (cifrado antes de persistir). */
  instanceToken: string;
}

export interface EstadoConexaoDetalhado {
  estado: EstadoConexao;
  /** Número conectado, quando `conectado`. Formato E.164 sem `+`. */
  numero?: string;
}

@Injectable()
export class EvolutionProvider {
  readonly nome = 'evolution' as const;
  private readonly log = new Logger('Evolution');
  // Só no envio (hot path, alto volume): uma instância self-hosted lenta não
  // pode fazer cada mensagem travar os 15s de timeout — depois de falhas
  // seguidas, falha rápido por um cooldown em vez de martelar o servidor.
  // Não aplicado em connect/QR/logout — ações manuais do usuário sempre
  // merecem uma tentativa fresca, não bloqueada por um circuito de outra causa.
  private readonly envioCircuito = new CircuitBreaker({ nome: 'Evolution (envio)', limiteFalhas: 4, cooldownMs: 20_000 });

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('evolution');
  }
  missing(): string[] {
    return this.config.missingVars('evolution');
  }

  private baseUrl(): string {
    return this.config.get('EVOLUTION_BASE_URL')!.replace(/\/+$/, '');
  }
  private globalKey(): string {
    return this.config.get('EVOLUTION_API_KEY')!;
  }

  /** GET / — verificado ao vivo: `{"status":200,"version":"2.x.x",...}`. */
  async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const r = await fetch(`${this.baseUrl()}/`, { signal: AbortSignal.timeout(6_000) });
      if (!r.ok) return { ok: false };
      const j = (await r.json()) as { version?: string };
      return { ok: true, version: j.version };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Cria ou reaproveita a instância do tenant.
   *
   * Nome determinístico (`khub-<tenantId>`): clicar "Conectar" várias vezes
   * não cria instância nova — a rota que chama isto primeiro checa
   * `integrations.external_business_id` e só cai aqui se ainda não existir.
   * `POST /instance/create` com a instância já existente devolve 403; nesse
   * caso a instância já existe no servidor (drift entre banco e Evolution) e
   * reaproveitamos o nome sem tratar como falha.
   */
  async createInstance(tenantId: string): Promise<InstanciaCriada> {
    this.config.require('evolution');
    const instanceName = this.nomeInstancia(tenantId);

    const r = await fetch(`${this.baseUrl()}/instance/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.globalKey() },
      body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
      signal: AbortSignal.timeout(15_000),
    });

    if (r.status === 403) {
      // Um 403 também pode ser autorização negada. Só reaproveitar após
      // confirmar que esta chave consegue consultar a instância exata.
      const check = await fetch(`${this.baseUrl()}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
        headers: { apikey: this.globalKey() }, signal: AbortSignal.timeout(8_000),
      });
      if (!check.ok) throw new EvolutionError('Não foi possível acessar a instância do WhatsApp.', check.status);
      this.log.warn(`instância ${instanceName} já existe na Evolution; reaproveitando`);
      return { instanceName, instanceToken: '' };
    }
    if (!r.ok) {
      throw new EvolutionError(`falha ao criar instância: ${r.status}`, r.status);
    }
    const j = (await r.json()) as Record<string, unknown> & { hash?: string | { apikey?: string } };
    const instanceToken = typeof j.hash === 'string' ? j.hash : (j.hash?.apikey ?? '');
    return { instanceName, instanceToken, qr: normalizeQrResponse(j) };
  }

  /**
   * Gera/renova o QR da instância. Sempre com a chave global — não depende
   * de já termos o token da instância salvo (útil em drift/recuperação).
   */
  async getQrCode(instanceName: string): Promise<QrNormalizado> {
    this.config.require('evolution');
    const r = await fetch(`${this.baseUrl()}/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
      headers: { apikey: this.globalKey() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new EvolutionError(`falha ao gerar QR: ${r.status}`, r.status);
    const j = (await r.json()) as Record<string, unknown>;
    return normalizeQrResponse(j);
  }

  /** GET /instance/connectionState/{instance} — estado REAL, não o do banco. */
  async getConnectionState(instanceName: string): Promise<EstadoConexaoDetalhado> {
    this.config.require('evolution');
    const r = await fetch(`${this.baseUrl()}/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: this.globalKey() },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.status === 404) return { estado: 'desconectado' };
    if (!r.ok) return { estado: 'erro' };
    const j = (await r.json()) as { instance?: { state?: string } };
    return { estado: mapearEstado(j.instance?.state) };
  }

  /** Registra o webhook KHUB na instância, para eventos de conexão e mensagem. */
  async configureWebhook(instanceName: string, url: string): Promise<void> {
    this.config.require('evolution');
    const r = await fetch(`${this.baseUrl()}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.globalKey() },
      body: JSON.stringify({
        webhook: { enabled: true, url, byEvents: false, events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT'] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      // Webhook não configurado não deve travar o fluxo de conexão — a
      // instância conecta e vira modo "sem entrada automática" até religar.
      this.log.error(`falha ao configurar webhook da instância ${instanceName}: HTTP ${r.status}`);
    }
  }

  async logout(instanceName: string): Promise<void> {
    this.config.require('evolution');
    await fetch(`${this.baseUrl()}/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
      headers: { apikey: this.globalKey() },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  /**
   * Envio de texto — assinatura compatível com `StevoProvider.sendText`, para
   * `MessagesService` poder trocar de provider sem mudar o call site.
   * `number` já deve vir só com dígitos (o helper de telefone faz isso).
   */
  async sendText(number: string, text: string, instanceName?: string): Promise<{ providerId?: string }> {
    this.config.require('evolution');
    // Sem instância = nada a chamar. `messages.service.ts` já barra este
    // caminho antes (`config_required` quando falta `externalBusinessId`);
    // isto aqui é só a defesa em profundidade. 400 é sintético (não veio de
    // resposta HTTP nenhuma) mas dá o `retryable=false, uncertain=false`
    // correto — não adianta reprocessar um envio sem instância configurada.
    if (!instanceName) throw new DeliveryError(400);

    try {
      return await this.envioCircuito.run(async () => {
        const res = await fetch(`${this.baseUrl()}/message/sendText/${encodeURIComponent(instanceName)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: this.globalKey() },
          body: JSON.stringify({ number: number.replace(/\D/g, ''), text }),
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });

        const j = await res.json().catch(() => ({}) as Record<string, unknown>);
        if (!res.ok) throw new DeliveryError(res.status);
        const key = (j as { key?: { id?: string } }).key;
        return { providerId: key?.id };
      });
    } catch (e) {
      if (e instanceof DeliveryError) throw e;
      // Circuito aberto: NENHUMA chamada HTTP real aconteceu (fail-fast), então
      // não há ambiguidade sobre ter sido enviado ou não — 429 é o único status
      // de DeliveryError com `retryable=true` (ver stevo.provider.ts). Um 5xx
      // cairia em `uncertain` e o MessagesService NUNCA reprocessaria sozinho.
      throw new DeliveryError(429);
    }
  }

  /** A Evolution aceita `media` como URL OU base64 (fonte abaixo): dá para enviar sem storage. */
  readonly aceitaBase64 = true;

  /**
   * Envio de mídia (Q2.5). Contrato tirado do código-fonte oficial da
   * Evolution API v2 (github.com/EvolutionAPI/evolution-api):
   * `src/api/routes/sendMessage.router.ts` → `POST /message/sendMedia/{instance}`;
   * `src/api/dto/sendMessage.dto.ts` (`SendMediaDto`: `number`, `mediatype`,
   * `mimetype?`, `caption?`, `fileName?`, `media` = "url or base64");
   * `src/validate/message.schema.ts` (`mediatype` ∈ image|document|video|audio).
   * Áudio vai como `mediatype: 'audio'` (arquivo); nota de voz (PTT) é outro
   * endpoint e não é usado aqui. Mesma semântica de erro/circuito do texto.
   */
  async sendMedia(number: string, midia: MidiaSaida, instanceName?: string): Promise<{ providerId?: string }> {
    this.config.require('evolution');
    if (!instanceName) throw new DeliveryError(400);
    const media = midia.url ?? midia.base64;
    if (!media) throw new DeliveryError(400, { retryable: false, uncertain: false, codigo: 'sem_midia' });
    const mediatype = midia.tipo === 'imagem' ? 'image' : midia.tipo === 'audio' ? 'audio' : 'document';
    try {
      return await this.envioCircuito.run(async () => {
        const res = await fetch(`${this.baseUrl()}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: this.globalKey() },
          body: JSON.stringify({
            number: number.replace(/\D/g, ''),
            mediatype,
            mimetype: midia.mime,
            media,
            fileName: midia.nome,
            ...(midia.legenda ? { caption: midia.legenda } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
          redirect: 'error',
        });
        const j = await res.json().catch(() => ({}) as Record<string, unknown>);
        if (!res.ok) throw new DeliveryError(res.status);
        return { providerId: (j as { key?: { id?: string } }).key?.id };
      });
    } catch (e) {
      if (e instanceof DeliveryError) throw e;
      throw new DeliveryError(429); // circuito aberto: nada saiu (ver sendText)
    }
  }

  private nomeInstancia(tenantId: string): string {
    return `khub-${tenantId}`;
  }
}

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EvolutionError';
  }
}

/**
 * Normaliza a resposta de QR da Evolution.
 *
 * Verificado ao vivo (instância v2.3.7): `{code, base64, pairingCode, count}`,
 * com `base64` já prefixado `data:image/png;base64,...`. Mantido defensivo
 * porque outras versões/forks podem devolver o base64 SEM prefixo, ou
 * aninhado em `qrcode: {...}` — não custa nada tratar os dois formatos.
 */
export function normalizeQrResponse(raw: Record<string, unknown>): QrNormalizado {
  const fonte = (raw.qrcode as Record<string, unknown> | undefined) ?? raw;

  const base64 = pickString(fonte, ['base64', 'qrcode', 'qr']);
  const code = pickString(fonte, ['code', 'qr']);
  const pairingCode = pickString(fonte, ['pairingCode', 'pairing_code']);

  let qrImageDataUrl: string | undefined;
  if (base64) {
    qrImageDataUrl = base64.startsWith('data:image') ? base64 : `data:image/png;base64,${base64}`;
  }

  // QR de WhatsApp expira rápido; 45s é uma margem segura entre os polls
  // registrados na prática do Baileys (a UI renova antes de chegar lá).
  const expiresAt = new Date(Date.now() + 45_000).toISOString();

  return { qrImageDataUrl, qrText: code, pairingCode, expiresAt };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** `open` = conectado; `connecting` = aguardando pareamento; `close` = caiu. */
function mapearEstado(estadoBruto: string | undefined): EstadoConexao {
  switch (estadoBruto) {
    case 'open':
      return 'conectado';
    case 'connecting':
      return 'conectando';
    case 'close':
      return 'desconectado';
    default:
      return 'erro';
  }
}
