import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';
import { CryptoService } from '../crypto.service';
import {
  EstadoGennaInvalidoError,
  GENNA,
  assinarEstadoGenna,
  gerarPkce,
  urlAutorizacao,
  verificarEstadoGenna,
} from './genna-oauth';

/** O que fica cifrado em `integrations.credentials_encrypted` (AES-256-GCM). */
export interface CredencialGenna {
  accessToken: string;
  refreshToken: string | null;
  /** ISO. */
  expiresAt: string;
  scopes: string[];
  /** Cliente do cadastro dinâmico usado na autorização: o refresh exige o mesmo. */
  clientId: string;
}

export interface StatusGenna {
  configurado: boolean;
  missing: string[];
  conectado: boolean;
  status: string | null;
  erro: string | null;
  conectadoEm: string | null;
  escopos: string[];
  podePublicar: boolean;
}

type Json = Record<string, unknown>;
type Fetch = typeof fetch;

/**
 * Conexão OAuth do Genna por tenant (ADR-0053). Reaproveita a tabela
 * `integrations` (provider `genna`), como o Google Presença: sem tabela nova.
 * O Genna não publica endpoint de revogação; desconectar apaga a credencial
 * do KHUB e a pessoa pode remover o acesso também no painel do Genna.
 */
@Injectable()
export class GennaConexaoService {
  private readonly log = new Logger('Genna');
  /** client_id do cadastro dinâmico por redirect URI (um por processo). */
  private readonly clientes = new Map<string, Promise<string>>();
  /** Renovação em andamento por tenant: duas chamadas juntas não queimam o refresh token. */
  private readonly renovando = new Map<string, Promise<string>>();
  private f: Fetch = (...a) => fetch(...a);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  /** Só para testes. */
  usarFetch(f: Fetch): void {
    this.f = f;
  }

  redirectUri(): string {
    const base = this.config.get('WEB_URL') ?? 'http://localhost:3210';
    return `${base.replace(/\/+$/, '')}/api/integrations/genna/callback`;
  }

  private segredo(): string {
    const s = this.config.get('JWT_SECRET');
    if (!s) throw new HttpException({ status: 'config_required', provider: 'genna', missing: ['JWT_SECRET'], title: 'Configuração pendente: genna' }, 501);
    return s;
  }

  private async post(url: string, corpo: string, tipo: string): Promise<{ ok: boolean; status: number; json: Json }> {
    let r: Response;
    try {
      r = await this.f(url, { method: 'POST', headers: { 'content-type': tipo, accept: 'application/json' }, body: corpo, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new HttpException({ code: 'genna_indisponivel', title: `O Genna não respondeu (${(e as Error).message}). Tente de novo.` }, 502);
    }
    let json: Json = {};
    try {
      json = (await r.json()) as Json;
    } catch {
      /* corpo vazio */
    }
    return { ok: r.ok, status: r.status, json };
  }

  /** Cadastro dinâmico (RFC 7591). Feito uma vez por processo e redirect URI. */
  private clienteId(redirectUri: string): Promise<string> {
    let p = this.clientes.get(redirectUri);
    if (!p) {
      p = (async () => {
        const r = await this.post(
          GENNA.registrar,
          JSON.stringify({
            client_name: 'KHUB',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            scope: GENNA.escopos.join(' '),
          }),
          'application/json',
        );
        const id = typeof r.json.client_id === 'string' ? r.json.client_id : null;
        if (!r.ok || !id) throw new HttpException({ code: 'genna_cadastro', title: 'O Genna recusou o cadastro do KHUB como aplicativo. Tente de novo em instantes.' }, 502);
        return id;
      })();
      this.clientes.set(redirectUri, p);
      p.catch(() => this.clientes.delete(redirectUri));
    }
    return p;
  }

  async status(tenantId: string): Promise<StatusGenna> {
    const missing = this.config.missingVars('integrations_crypto');
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: { tenantId, provider: GENNA.provider },
        select: { status: true, erro: true, connectedAt: true, scopes: true, credentialsEncrypted: true },
      }),
    );
    const conectado = !!integ?.credentialsEncrypted && integ.status === 'connected';
    const escopos = conectado ? integ!.scopes : [];
    return {
      configurado: missing.length === 0,
      missing,
      conectado,
      status: integ?.status ?? null,
      erro: integ?.erro ?? null,
      conectadoEm: integ?.connectedAt?.toISOString() ?? null,
      escopos,
      podePublicar: escopos.includes('mcp:publish'),
    };
  }

  async urlConexao(tenantId: string, identityId: string | null): Promise<{ url: string }> {
    this.config.require('integrations_crypto');
    const redirectUri = this.redirectUri();
    const clientId = await this.clienteId(redirectUri);
    const { verificador, desafio } = gerarPkce();
    // O redirect URI vai junto (cifrado com o verificador) porque a troca do
    // código precisa repetir exatamente o mesmo valor.
    const verificadorCifrado = this.crypto.encryptJson({ v: verificador, r: redirectUri });
    const state = assinarEstadoGenna({ tenantId, identityId, clientId, verificadorCifrado }, this.segredo());
    return { url: urlAutorizacao({ clientId, redirectUri, state, desafio }) };
  }

  /** Rota pública: o web recebe o redirect do Genna e repassa code + state. */
  async callback(code: string, state: string): Promise<{ ok: true; podePublicar: boolean }> {
    let e;
    try {
      e = verificarEstadoGenna(state, this.segredo());
    } catch (err) {
      if (err instanceof EstadoGennaInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
    this.config.require('integrations_crypto');
    let segredoPkce: { v: string; r: string };
    try {
      segredoPkce = this.crypto.decryptJson<{ v: string; r: string }>(e.verificadorCifrado);
    } catch {
      throw new BadRequestException('state inválido');
    }

    const t = await this.post(
      GENNA.token,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: segredoPkce.r, client_id: e.clientId, code_verifier: segredoPkce.v, resource: GENNA.mcpUrl }).toString(),
      'application/x-www-form-urlencoded',
    );
    const accessToken = typeof t.json.access_token === 'string' ? t.json.access_token : null;
    if (!t.ok || !accessToken) {
      const motivo = typeof t.json.error_description === 'string' ? t.json.error_description : typeof t.json.error === 'string' ? t.json.error : `HTTP ${t.status}`;
      throw new BadRequestException(`O Genna recusou a autorização: ${motivo}`);
    }
    const cred = this.credencialDe(t.json, accessToken, e.clientId, null);
    const tenantId = e.tenantId;
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await tx.integration.findFirst({ where: { tenantId, provider: GENNA.provider }, select: { id: true } });
      const data = {
        status: 'connected',
        credentialsEncrypted: this.crypto.encryptJson(cred),
        scopes: cred.scopes,
        connectedAt: new Date(),
        connectedBy: e.identityId,
        erro: null,
        health: 'ok',
        updatedAt: new Date(),
      };
      let id: string;
      if (existente) {
        await tx.integration.update({ where: { id: existente.id }, data });
        id = existente.id;
      } else {
        id = (await tx.integration.create({ data: { tenantId, provider: GENNA.provider, ...data }, select: { id: true } })).id;
      }
      await this.auditarTx(tx, tenantId, e.identityId, 'genna.conectar', 'integration', id, { escopos: cred.scopes });
    });
    return { ok: true, podePublicar: cred.scopes.includes('mcp:publish') };
  }

  private credencialDe(t: Json, accessToken: string, clientId: string, anterior: CredencialGenna | null): CredencialGenna {
    const expiresIn = typeof t.expires_in === 'number' ? t.expires_in : 3600;
    const escopos = typeof t.scope === 'string' ? t.scope.split(' ').filter(Boolean) : anterior?.scopes ?? [...GENNA.escopos];
    return {
      accessToken,
      refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : anterior?.refreshToken ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: escopos,
      clientId,
    };
  }

  async desconectar(tenantId: string, identityId: string | null): Promise<{ ok: true }> {
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: GENNA.provider }, select: { id: true } }),
    );
    if (!integ) return { ok: true };
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.integration.update({ where: { id: integ.id }, data: { status: 'revoked', credentialsEncrypted: null, scopes: [], health: 'unknown', erro: null, updatedAt: new Date() } });
      await this.auditarTx(tx, tenantId, identityId, 'genna.desconectar', 'integration', integ.id, {});
    });
    return { ok: true };
  }

  /**
   * Access token válido do tenant. `forcar` renova mesmo dentro da validade
   * (o Genna respondeu 401 a um token que ainda parecia válido).
   * Sem conexão: 409 `genna_nao_conectado`, que a tela vira "Conectar Genna".
   */
  async token(tenantId: string, forcar = false): Promise<string> {
    this.config.require('integrations_crypto');
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: GENNA.provider }, select: { id: true, status: true, credentialsEncrypted: true } }),
    );
    if (!integ?.credentialsEncrypted || integ.status !== 'connected') {
      throw new HttpException({ code: 'genna_nao_conectado', title: 'Esta conta ainda não conectou o Genna.' }, 409);
    }
    const cred = this.crypto.decryptJson<CredencialGenna>(integ.credentialsEncrypted);
    if (!forcar && new Date(cred.expiresAt).getTime() - Date.now() > 60_000) return cred.accessToken;

    const emAndamento = this.renovando.get(tenantId);
    if (emAndamento) return emAndamento;
    const p = this.renovar(tenantId, integ.id, cred).finally(() => this.renovando.delete(tenantId));
    this.renovando.set(tenantId, p);
    return p;
  }

  private async renovar(tenantId: string, integId: string, cred: CredencialGenna): Promise<string> {
    if (!cred.refreshToken) return this.marcarExpirada(tenantId, integId);
    const t = await this.post(
      GENNA.token,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refreshToken, client_id: cred.clientId, resource: GENNA.mcpUrl }).toString(),
      'application/x-www-form-urlencoded',
    );
    const accessToken = typeof t.json.access_token === 'string' ? t.json.access_token : null;
    if (!t.ok || !accessToken) {
      // 400/401 = refresh recusado (revogado no Genna ou expirado). 5xx = instabilidade: não derruba a conexão.
      if (t.status === 400 || t.status === 401) return this.marcarExpirada(tenantId, integId);
      throw new HttpException({ code: 'genna_indisponivel', title: 'O Genna não renovou o acesso agora. Tente de novo.' }, 502);
    }
    const nova = this.credencialDe(t.json, accessToken, cred.clientId, cred);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.update({ where: { id: integId }, data: { credentialsEncrypted: this.crypto.encryptJson(nova), scopes: nova.scopes, health: 'ok', updatedAt: new Date() } }),
    );
    return accessToken;
  }

  private async marcarExpirada(tenantId: string, integId: string): Promise<never> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.update({ where: { id: integId }, data: { status: 'error', health: 'down', erro: 'O acesso ao Genna expirou ou foi removido. Conecte de novo.', updatedAt: new Date() } }),
    );
    this.log.warn(`tenant ${tenantId}: acesso ao Genna expirado/revogado`);
    throw new HttpException({ code: 'genna_nao_conectado', title: 'O acesso ao Genna expirou ou foi removido. Conecte de novo.' }, 409);
  }

  async auditar(tenantId: string, identityId: string | null, acao: string, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) => this.auditarTx(tx, tenantId, identityId, acao, 'integration', null, payload));
  }

  private async auditarTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    identityId: string | null,
    acao: string,
    entidade: string,
    entidadeId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${acao}, ${entidade}, ${entidadeId}, ${JSON.stringify(payload)}::jsonb)`;
  }
}
