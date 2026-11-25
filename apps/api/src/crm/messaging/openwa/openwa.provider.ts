import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '../../../config/config.service';
import { DeliveryError, type MessagingProvider } from '../stevo.provider';
import type { MidiaSaida } from '../provider.contract';

/**
 * Cliente HTTP do wa-gateway (open-wa na VPS própria, ADR-0058). Contrato em
 * `services/wa-gateway/CONTRATO.md` — o KHUB nunca importa open-wa.
 * Uma sessão por tenant: `khub-<tenantId>` (vai em `integrations.external_business_id`).
 */

export type EstadoSessaoWa = 'iniciando' | 'aguardando_qr' | 'conectado' | 'desconectado' | 'erro';

export interface EstadoGateway {
  estado: EstadoSessaoWa;
  qr?: string;
  qrAtualizadoEm?: string;
  numero?: string;
  nome?: string;
  fotoUrl?: string;
  erro?: string;
}

export const sessaoDoTenant = (tenantId: string) => `khub-${tenantId}`;
const SESSAO = /^khub-([0-9a-f-]{36})$/;
export function tenantDaSessao(sessionId: string): string | null {
  const m = SESSAO.exec(sessionId);
  return m ? m[1] : null;
}

export class GatewayError extends Error {
  constructor(readonly status: number, readonly codigo: string) {
    super(`openwa_${status}_${codigo}`);
    this.name = 'GatewayError';
  }
}

@Injectable()
export class OpenWaProvider implements MessagingProvider {
  /** O gateway aceita base64 de até ~5 MB: mídia sem storage também sai. */
  readonly aceitaBase64 = true;

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('openwa');
  }
  missing(): string[] {
    return this.config.missingVars('openwa');
  }

  private async req<T>(metodo: string, caminho: string, corpo?: unknown, timeoutMs = 20_000): Promise<T> {
    this.config.require('openwa');
    const base = this.config.get('OPENWA_GATEWAY_URL')!.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: { 'x-gateway-key': this.config.get('OPENWA_GATEWAY_KEY')!, accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new GatewayError(0, 'gateway_inacessivel');
    }
    const j = (await res.json().catch(() => ({}))) as T & { erro?: string };
    if (!res.ok) throw new GatewayError(res.status, j.erro ?? 'desconhecido');
    return j;
  }

  iniciar(sessionId: string): Promise<EstadoGateway> {
    return this.req<EstadoGateway>('POST', `/sessions/${sessionId}/start`, {}, 60_000);
  }

  /** `null` = o gateway não conhece a sessão (nunca iniciada ou apagada). */
  async estado(sessionId: string): Promise<EstadoGateway | null> {
    try {
      return await this.req<EstadoGateway>('GET', `/sessions/${sessionId}`);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return null;
      throw e;
    }
  }

  async encerrar(sessionId: string): Promise<void> {
    try {
      await this.req('DELETE', `/sessions/${sessionId}`, undefined, 30_000);
    } catch (e) {
      if (!(e instanceof GatewayError && e.status === 404)) throw e;
    }
  }

  pedirHistorico(sessionId: string, opts: { dias?: number; maxPorChat?: number } = {}): Promise<{ loteId: string }> {
    return this.req<{ loteId: string }>('POST', `/sessions/${sessionId}/historico`, opts);
  }

  async foto(sessionId: string, numero: string): Promise<string | null> {
    try {
      return (await this.req<{ url: string | null }>('GET', `/sessions/${sessionId}/foto/${numero.replace(/\D/g, '')}`)).url;
    } catch {
      return null;
    }
  }

  /**
   * 409 desconectada / 422 (`numero_invalido`, `licenca_necessaria` = contato que nunca escreveu
   * sem licença open-wa, `envio_recusado`) = nada saiu; 504 / sem resposta = aceite incerto (nunca reenviar).
   */
  private erroDeEnvio(e: unknown): never {
    if (e instanceof GatewayError) {
      if (e.status === 0) throw new DeliveryError(503, { retryable: true, uncertain: false, codigo: 'gateway_inacessivel' });
      if (e.status === 409 || e.status === 422 || e.status === 400) throw new DeliveryError(e.status, { retryable: false, uncertain: false, codigo: e.codigo });
      if (e.status === 429) throw new DeliveryError(429, { retryable: true, uncertain: false, codigo: e.codigo });
      throw new DeliveryError(e.status, { uncertain: true, codigo: e.codigo });
    }
    throw new DeliveryError(504, { uncertain: true, codigo: 'aceite_incerto' });
  }

  async sendText(number: string, text: string, tenantInstance?: string, idempotencyKey?: string): Promise<{ providerId?: string }> {
    if (!tenantInstance) throw new DeliveryError(400, { retryable: false, uncertain: false, codigo: 'sem_sessao' });
    try {
      return await this.req<{ providerId: string }>('POST', `/sessions/${tenantInstance}/messages/text`, { to: number.replace(/\D/g, ''), texto: text, idempotencyKey: idempotencyKey ?? randomUUID() }, 45_000);
    } catch (e) {
      this.erroDeEnvio(e);
    }
  }

  async sendMedia(number: string, midia: MidiaSaida, tenantInstance?: string, idempotencyKey?: string): Promise<{ providerId?: string }> {
    if (!tenantInstance) throw new DeliveryError(400, { retryable: false, uncertain: false, codigo: 'sem_sessao' });
    const corpo = { to: number.replace(/\D/g, ''), tipo: midia.tipo, mime: midia.mime, nome: midia.nome, legenda: midia.legenda, ...(midia.url ? { url: midia.url } : { base64: midia.base64 }), idempotencyKey: idempotencyKey ?? randomUUID() };
    try {
      return await this.req<{ providerId: string }>('POST', `/sessions/${tenantInstance}/messages/media`, corpo, 90_000);
    } catch (e) {
      this.erroDeEnvio(e);
    }
  }
}
