import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';
import { CryptoService } from '../crypto.service';
import { GoogleHttp, type Json } from './google-http';
import { GoogleApiError, paraHttp } from './google-erros';
import { assinarEstado, verificarEstado, EstadoInvalidoError } from './google-oauth-state';
import {
  ESCOPOS_POR_CAPACIDADE,
  PROVIDER_GOOGLE_PRESENCA,
  capacidadesDe,
  type CapacidadeGoogle,
  type CapacidadesConcedidas,
} from './google-escopos';
import { str } from './google-json';

/** O que fica cifrado em `integrations.credentials_encrypted` (AES-256-GCM, CryptoService). */
export interface CredencialGoogle {
  accessToken: string;
  refreshToken: string;
  /** ISO; o access token do Google vale ~1h. */
  expiresAt: string;
  scopes: string[];
}

export interface StatusGoogle {
  configurado: boolean;
  missing: string[];
  conectado: boolean;
  status: string | null;
  erro: string | null;
  conectadoEm: string | null;
  escopos: string[];
  capacidades: CapacidadesConcedidas;
}

const SEM_CAPACIDADE: CapacidadesConcedidas = { tagManager: false, tagManagerEscrita: false, tagManagerPublicar: false, searchConsole: false, meuNegocio: false };

/**
 * Conexão OAuth do Google por tenant (subconta) para Tag Manager, Search
 * Console e Perfil da Empresa. Reaproveita a tabela `integrations`
 * (provider `google_presenca`): não precisa de tabela nova.
 *
 * Doc OAuth (web server, acesso offline + refresh):
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */
@Injectable()
export class GoogleConexaoService {
  private readonly log = new Logger('GooglePresenca');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly http: GoogleHttp,
  ) {}

  redirectUri(): string {
    return `${(this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/+$/, '')}/api/integrations/google/callback`;
  }

  private segredo(): string {
    const s = this.config.get('JWT_SECRET');
    if (!s) throw new HttpException({ status: 'config_required', provider: 'google_presenca', missing: ['JWT_SECRET'], title: 'Configuração pendente: google_presenca' }, 501);
    return s;
  }

  private exigirConfig(): void {
    this.config.require('google_presenca');
    this.config.require('integrations_crypto');
  }

  async status(tenantId: string): Promise<StatusGoogle> {
    const missing = [...this.config.missingVars('google_presenca'), ...this.config.missingVars('integrations_crypto')];
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: { tenantId, provider: PROVIDER_GOOGLE_PRESENCA },
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
      capacidades: conectado ? capacidadesDe(escopos) : SEM_CAPACIDADE,
    };
  }

  urlConexao(tenantId: string, identityId: string | null, capacidade: CapacidadeGoogle): { url: string } {
    this.exigirConfig();
    const state = assinarEstado({ tenantId, identityId, capacidade }, this.segredo());
    const p = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID')!,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: ESCOPOS_POR_CAPACIDADE[capacidade].join(' '),
      // offline = refresh token; consent = o Google reemite o refresh token
      // mesmo em reconexão; include_granted_scopes = autorização incremental
      // (pedir escrita do GTM soma aos escopos de leitura já concedidos).
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` };
  }

  /** Rota pública: o web recebe o redirect do Google e repassa code + state. */
  async callback(code: string, state: string): Promise<{ ok: true; capacidades: CapacidadesConcedidas }> {
    let e;
    try {
      e = verificarEstado(state, this.segredo());
    } catch (err) {
      if (err instanceof EstadoInvalidoError) throw new BadRequestException(err.message);
      throw err;
    }
    this.exigirConfig();

    let t: Json;
    try {
      t = await this.http.token({
        code,
        client_id: this.config.get('GOOGLE_CLIENT_ID')!,
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      });
    } catch (err) {
      if (err instanceof GoogleApiError) throw new BadRequestException(`O Google recusou a autorização: ${err.message}`);
      throw err;
    }
    const accessToken = str(t.access_token);
    if (!accessToken) throw new BadRequestException('O Google não devolveu o token de acesso.');
    const escopos = (str(t.scope) ?? '').split(' ').filter(Boolean);
    const expiresIn = typeof t.expires_in === 'number' ? t.expires_in : 3600;

    const tenantId = e.tenantId;
    await this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await tx.integration.findFirst({ where: { tenantId, provider: PROVIDER_GOOGLE_PRESENCA }, select: { id: true, credentialsEncrypted: true } });
      let refreshToken = str(t.refresh_token);
      if (!refreshToken && existente?.credentialsEncrypted) {
        // Reconexão sem refresh novo: mantém o anterior (continua válido).
        refreshToken = this.crypto.decryptJson<CredencialGoogle>(existente.credentialsEncrypted).refreshToken;
      }
      if (!refreshToken) throw new BadRequestException('O Google não devolveu o token de atualização. Remova o acesso do KHUB em myaccount.google.com/permissions e conecte de novo.');
      const cred: CredencialGoogle = { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scopes: escopos };
      const data = {
        status: 'connected',
        credentialsEncrypted: this.crypto.encryptJson(cred),
        scopes: escopos,
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
        const criado = await tx.integration.create({ data: { tenantId, provider: PROVIDER_GOOGLE_PRESENCA, ...data }, select: { id: true } });
        id = criado.id;
      }
      await this.auditarTx(tx, tenantId, e.identityId, 'google.conectar', 'integration', id, { capacidade: e.capacidade, escopos });
    });
    return { ok: true, capacidades: capacidadesDe(escopos) };
  }

  async desconectar(tenantId: string, identityId: string | null): Promise<{ ok: true }> {
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: PROVIDER_GOOGLE_PRESENCA }, select: { id: true, credentialsEncrypted: true } }),
    );
    if (!integ) return { ok: true };
    if (integ.credentialsEncrypted && this.crypto.configured()) {
      try {
        const cred = this.crypto.decryptJson<CredencialGoogle>(integ.credentialsEncrypted);
        // Revogar o refresh token derruba o access token junto (doc OAuth).
        await this.http.revogar(cred.refreshToken);
      } catch (err) {
        this.log.warn(`tenant ${tenantId}: credencial Google ilegível na desconexão (${(err as Error).message})`);
      }
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.integration.update({ where: { id: integ.id }, data: { status: 'revoked', credentialsEncrypted: null, scopes: [], health: 'unknown', erro: null, updatedAt: new Date() } });
      await this.auditarTx(tx, tenantId, identityId, 'google.desconectar', 'integration', integ.id, {});
    });
    return { ok: true };
  }

  /**
   * Access token válido do tenant (renova pelo refresh token quando faltar
   * menos de 1 minuto). Sem conexão: 409 `google_nao_conectado`, que a tela
   * transforma no botão "Conectar Google" em Integrações.
   */
  async token(tenantId: string): Promise<{ accessToken: string; escopos: string[] }> {
    this.exigirConfig();
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: PROVIDER_GOOGLE_PRESENCA }, select: { id: true, status: true, credentialsEncrypted: true } }),
    );
    if (!integ?.credentialsEncrypted || integ.status !== 'connected') {
      throw new HttpException({ code: 'google_nao_conectado', title: 'Esta conta ainda não conectou o Google. Conecte em Integrações.' }, 409);
    }
    const cred = this.crypto.decryptJson<CredencialGoogle>(integ.credentialsEncrypted);
    if (new Date(cred.expiresAt).getTime() - Date.now() > 60_000) return { accessToken: cred.accessToken, escopos: cred.scopes };

    let t: Json;
    try {
      t = await this.http.token({
        client_id: this.config.get('GOOGLE_CLIENT_ID')!,
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: cred.refreshToken,
        grant_type: 'refresh_token',
      });
    } catch (err) {
      if (err instanceof GoogleApiError && !err.incerto) {
        // invalid_grant: o usuário revogou o acesso ou o token caducou.
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.integration.update({ where: { id: integ.id }, data: { status: 'error', health: 'down', erro: 'Acesso ao Google revogado ou expirado. Conecte de novo.', updatedAt: new Date() } }),
        );
      }
      if (err instanceof GoogleApiError) throw paraHttp(err);
      throw err;
    }
    const accessToken = str(t.access_token);
    if (!accessToken) throw new HttpException({ code: 'google_indisponivel', title: 'O Google não devolveu um token novo. Tente de novo.' }, 502);
    const escopos = str(t.scope)?.split(' ').filter(Boolean) ?? cred.scopes;
    const novo: CredencialGoogle = {
      accessToken,
      refreshToken: str(t.refresh_token) ?? cred.refreshToken,
      expiresAt: new Date(Date.now() + (typeof t.expires_in === 'number' ? t.expires_in : 3600) * 1000).toISOString(),
      scopes: escopos,
    };
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.update({ where: { id: integ.id }, data: { credentialsEncrypted: this.crypto.encryptJson(novo), scopes: escopos, health: 'ok', updatedAt: new Date() } }),
    );
    return { accessToken, escopos };
  }

  /** Linha em `audit_logs` (append-only) com o payload da ação no Google. */
  async auditar(tenantId: string, identityId: string | null, acao: string, entidade: string, entidadeId: string | null, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) => this.auditarTx(tx, tenantId, identityId, acao, entidade, entidadeId, payload));
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
