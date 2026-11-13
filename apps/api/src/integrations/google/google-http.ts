import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from '../../common/circuit-breaker';
import { GoogleApiError, erroDeResposta, type ProdutoGoogle } from './google-erros';

export type Json = Record<string, unknown>;

/**
 * Transporte HTTP das APIs Google (injetável, para mock nos testes).
 * Um circuito por produto: o Perfil da Empresa sem acesso aprovado não pode
 * derrubar o Search Console do mesmo tenant.
 *
 * OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
 *   POST https://oauth2.googleapis.com/token (authorization_code | refresh_token)
 *   POST https://oauth2.googleapis.com/revoke?token=
 */
@Injectable()
export class GoogleHttp {
  private readonly circuitos: Record<ProdutoGoogle, CircuitBreaker> = {
    oauth: new CircuitBreaker({ nome: 'Google OAuth', limiteFalhas: 5, cooldownMs: 30_000 }),
    tag_manager: new CircuitBreaker({ nome: 'Google Tag Manager', limiteFalhas: 5, cooldownMs: 30_000 }),
    search_console: new CircuitBreaker({ nome: 'Google Search Console', limiteFalhas: 5, cooldownMs: 30_000 }),
    meu_negocio: new CircuitBreaker({ nome: 'Google Perfil da Empresa', limiteFalhas: 5, cooldownMs: 30_000 }),
  };

  async token(form: Record<string, string>): Promise<Json> {
    return this.chamar('oauth', 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  }

  /** Melhor esforço: a desconexão local acontece mesmo se a revogação falhar. */
  async revogar(token: string): Promise<void> {
    await this.chamar('oauth', `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined);
  }

  get(produto: ProdutoGoogle, url: string, token: string): Promise<Json> {
    return this.chamar(produto, url, { headers: { Authorization: `Bearer ${token}` } });
  }

  enviar(produto: ProdutoGoogle, metodo: 'POST' | 'PUT', url: string, token: string, corpo?: Json): Promise<Json> {
    return this.chamar(produto, url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  }

  private async chamar(produto: ProdutoGoogle, url: string, init: RequestInit): Promise<Json> {
    let resp: Response;
    try {
      // Erros 4xx não contam como falha do circuito (são do pedido, não do serviço).
      resp = await this.circuitos[produto].run(async () => {
        const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
        if (r.status >= 500) throw new GoogleApiError(`HTTP ${r.status}`, r.status, produto, null, null, true);
        return r;
      });
    } catch (e) {
      if (e instanceof GoogleApiError) throw e;
      throw new GoogleApiError(`sem resposta (${(e as Error).message})`, 0, produto, null, null, true);
    }
    const texto = await resp.text();
    let corpo: unknown = {};
    if (texto) {
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = {};
      }
    }
    if (!resp.ok) throw erroDeResposta(resp.status, corpo, produto);
    return (corpo && typeof corpo === 'object' ? corpo : {}) as Json;
  }
}
