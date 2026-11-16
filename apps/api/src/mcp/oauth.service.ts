import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { RedisService } from '../common/redis.service';
import type { AuthUser } from '../auth/decorators';
import {
  ESCOPO_KHUB, TTL_ACESSO_S, TTL_CODIGO_S, TTL_RENOVACAO_S,
  assinarPedido, lerPedido, novoToken, pkceConfere, redirectValido, sha256, urlDeRetorno,
} from './oauth-util';

/** Erro no formato do OAuth (RFC 6749 §5.2): `{ error, error_description }`. */
export class OAuthErro extends Error {
  constructor(readonly status: number, readonly codigo: string, readonly descricao: string) {
    super(descricao);
  }
  corpo() {
    return { error: this.codigo, error_description: this.descricao };
  }
}

/** Quem pode ligar Claude/ChatGPT na conta: eles configuram agentes e automações. */
export const PAPEIS_MCP = ['owner', 'admin'];

export interface AtorMcp {
  tenantId: string;
  identityId: string;
  role: string;
  conexaoId: string;
  nomeCliente: string;
}

interface LinhaResolvida {
  tenant_id: string;
  conexao_id: string;
  identity_id: string;
  cliente_id: string;
  code_challenge: string | null;
  redirect_uri: string | null;
  escopos: string[];
}

/**
 * Servidor de autorização OAuth 2.1 do conector MCP (ADR-0049).
 *
 * Fluxo: o Claude/ChatGPT se cadastra (`/oauth/register`), manda a pessoa para
 * `/oauth/authorize`, que devolve a tela de consentimento do KHUB (web). Lá um
 * dono/admin logado aprova → nasce a conexão + código de uso único → o app
 * troca o código (com PKCE) por token de acesso (1 h) e de renovação (60 d,
 * rotativo). O MCP age na subconta COMO a pessoa que aprovou; revogar a
 * conexão (ou tirar o papel da pessoa) corta na hora.
 */
@Injectable()
export class McpOAuthService {
  private readonly log = new Logger('McpOAuth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  private get segredo(): string {
    const s = this.config.get('JWT_SECRET');
    if (!s) throw new Error('JWT_SECRET ausente');
    return s;
  }

  webUrl(): string {
    return (this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/+$/, '');
  }

  // ------------------------------------------------------------ cadastro (RFC 7591)

  async registrar(corpo: Record<string, unknown>, ip: string) {
    // Cadastro é anônimo por especificação: limite por IP para não virar lixão.
    const n = await this.redis.incrWithTtl(`rl:mcp:registro:${ip}:${Math.floor(Date.now() / 3_600_000)}`, 3600);
    if (n !== null && n > 30) throw new OAuthErro(429, 'too_many_requests', 'muitos cadastros deste endereço; tente em uma hora');

    const uris = corpo.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(redirectValido)) {
      throw new OAuthErro(400, 'invalid_redirect_uri', 'redirect_uris precisa ser uma lista de URLs https (ou http em localhost)');
    }
    const metodo = String(corpo.token_endpoint_auth_method ?? 'none');
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(metodo)) {
      throw new OAuthErro(400, 'invalid_client_metadata', `token_endpoint_auth_method não suportado: ${metodo}`);
    }
    const tipos = Array.isArray(corpo.grant_types) ? corpo.grant_types.map(String) : ['authorization_code', 'refresh_token'];
    if (tipos.some((t) => !['authorization_code', 'refresh_token'].includes(t))) {
      throw new OAuthErro(400, 'invalid_client_metadata', 'grant_types aceitos: authorization_code e refresh_token');
    }
    const nome = (typeof corpo.client_name === 'string' && corpo.client_name.trim() ? corpo.client_name.trim() : 'Aplicativo MCP').slice(0, 100);
    const clientId = novoToken('kcl');
    const segredo = metodo === 'none' ? null : novoToken('kcs');
    const c = await this.prisma.mcpCliente.create({
      data: { clientId, segredoHash: segredo ? sha256(segredo) : null, nome, redirectUris: uris as string[] },
    });
    this.log.log(`cliente MCP cadastrado: "${nome}" (${uris.length} redirect)`);
    return {
      client_id: clientId,
      ...(segredo ? { client_secret: segredo, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(c.createdAt.getTime() / 1000),
      client_name: nome,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: metodo,
      scope: ESCOPO_KHUB,
    };
  }

  // ------------------------------------------------------------ autorização

  /**
   * Valida o pedido e devolve para onde mandar o navegador: a tela de
   * consentimento (sucesso) ou de volta ao app com `error=` (pedido inválido
   * depois de o redirect_uri já ser confiável). Antes disso, erro é exibido
   * aqui mesmo — nunca redirecionar para URL não cadastrada (open redirect).
   */
  async iniciar(q: Record<string, unknown>, recursoEsperado: string): Promise<{ redirecionar: string } | { erroLocal: string }> {
    const clientId = String(q.client_id ?? '');
    const cliente = clientId ? await this.prisma.mcpCliente.findUnique({ where: { clientId } }) : null;
    if (!cliente) return { erroLocal: 'Aplicativo não cadastrado (client_id desconhecido). Remova o conector e adicione de novo.' };
    let ru = typeof q.redirect_uri === 'string' ? q.redirect_uri : undefined;
    if (!ru && cliente.redirectUris.length === 1) ru = cliente.redirectUris[0];
    if (!ru || !cliente.redirectUris.includes(ru)) return { erroLocal: 'redirect_uri não confere com o cadastro do aplicativo.' };

    const state = typeof q.state === 'string' ? q.state.slice(0, 1000) : undefined;
    const volta = (error: string, desc: string) => ({ redirecionar: urlDeRetorno(ru!, { error, error_description: desc, state }) });
    if (q.response_type !== 'code') return volta('unsupported_response_type', 'só response_type=code');
    const cc = typeof q.code_challenge === 'string' ? q.code_challenge : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(cc) || q.code_challenge_method !== 'S256') return volta('invalid_request', 'PKCE S256 obrigatório');
    if (typeof q.scope === 'string' && q.scope.trim() && !q.scope.split(/\s+/).every((s) => s === ESCOPO_KHUB || s === 'offline_access')) {
      return volta('invalid_scope', `escopo suportado: ${ESCOPO_KHUB}`);
    }
    if (typeof q.resource === 'string' && q.resource && !this.recursoConfere(q.resource, recursoEsperado)) {
      return volta('invalid_target', 'resource não é este servidor MCP');
    }
    const pedido = assinarPedido({ cid: clientId, ru, cc, st: state }, this.segredo);
    return { redirecionar: `${this.webUrl()}/conectar-ia/${pedido}` };
  }

  private recursoConfere(recebido: string, esperado: string): boolean {
    const norm = (s: string) => s.replace(/\/+$/, '');
    return norm(recebido) === norm(esperado) || norm(recebido) === norm(esperado).replace(/\/mcp$/, '');
  }

  /** Dados da tela de consentimento (pessoa já logada no KHUB). */
  async detalhesPedido(user: AuthUser, token: string) {
    const p = lerPedido(token, this.segredo);
    if (!p) throw new NotFoundException('pedido de conexão inválido ou expirado — volte ao Claude/ChatGPT e conecte de novo');
    const cliente = await this.prisma.mcpCliente.findUnique({ where: { clientId: p.cid }, select: { nome: true, redirectUris: true } });
    if (!cliente) throw new NotFoundException('aplicativo não cadastrado');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { nome: true } });
    return {
      aplicativo: cliente.nome,
      destino: new URL(p.ru).host,
      subconta: tenant?.nome ?? '',
      papel: user.role,
      podeAutorizar: PAPEIS_MCP.includes(user.role),
      expiraEm: new Date(p.exp * 1000).toISOString(),
      // Negar não exige papel nenhum: qualquer pessoa pode recusar e voltar ao app.
      negar: cliente.redirectUris.includes(p.ru) ? urlDeRetorno(p.ru, { error: 'access_denied', error_description: 'acesso negado no KHUB', state: p.st }) : null,
    };
  }

  /** Aprovar (cria conexão + código) ou negar. Devolve a URL de retorno ao app. */
  async decidir(user: AuthUser, token: string, aprovar: boolean): Promise<{ redirect: string }> {
    const p = lerPedido(token, this.segredo);
    if (!p) throw new NotFoundException('pedido de conexão inválido ou expirado — volte ao Claude/ChatGPT e conecte de novo');
    const cliente = await this.prisma.mcpCliente.findUnique({ where: { clientId: p.cid } });
    if (!cliente || !cliente.redirectUris.includes(p.ru)) throw new NotFoundException('aplicativo não cadastrado');
    if (!aprovar) return { redirect: urlDeRetorno(p.ru, { error: 'access_denied', error_description: 'acesso negado no KHUB', state: p.st }) };
    if (!PAPEIS_MCP.includes(user.role)) throw new ForbiddenException('só dono ou admin da subconta conecta Claude/ChatGPT');

    const codigo = novoToken('khc');
    await this.prisma.withTenant(user.tenantId, async (tx) => {
      const conexao = await tx.mcpConexao.create({
        data: { tenantId: user.tenantId, identityId: user.identityId, clienteId: cliente.id, nomeCliente: cliente.nome, escopos: [ESCOPO_KHUB] },
      });
      await tx.mcpToken.create({
        data: {
          tenantId: user.tenantId, conexaoId: conexao.id, tipo: 'codigo', hash: sha256(codigo),
          codeChallenge: p.cc, redirectUri: p.ru, expiraEm: new Date(Date.now() + TTL_CODIGO_S * 1000),
        },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${user.tenantId}::uuid, 'humano', ${user.identityId}, 'mcp.conexao_autorizada', 'mcp_conexao', ${conexao.id}, ${JSON.stringify({ aplicativo: cliente.nome })}::jsonb)`;
    });
    return { redirect: urlDeRetorno(p.ru, { code: codigo, state: p.st }) };
  }

  // ------------------------------------------------------------ token

  private async autenticarCliente(corpo: Record<string, unknown>, authorization?: string) {
    let clientId = typeof corpo.client_id === 'string' ? corpo.client_id : undefined;
    let segredo = typeof corpo.client_secret === 'string' ? corpo.client_secret : undefined;
    if (authorization?.startsWith('Basic ')) {
      const [id, sec] = Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':');
      clientId = decodeURIComponent(id ?? '');
      segredo = decodeURIComponent(sec ?? '');
    }
    if (!clientId) throw new OAuthErro(401, 'invalid_client', 'client_id ausente');
    const cliente = await this.prisma.mcpCliente.findUnique({ where: { clientId } });
    if (!cliente) throw new OAuthErro(401, 'invalid_client', 'cliente desconhecido');
    if (cliente.segredoHash && (!segredo || sha256(segredo) !== cliente.segredoHash)) {
      throw new OAuthErro(401, 'invalid_client', 'client_secret inválido');
    }
    return cliente;
  }

  private async resolver(token: string, tipo: 'codigo' | 'acesso' | 'renovacao'): Promise<LinhaResolvida | null> {
    if (!token || token.length > 200) return null;
    const rows = await this.prisma.$queryRawUnsafe<LinhaResolvida[]>(
      'SELECT tenant_id, conexao_id, identity_id, cliente_id, code_challenge, redirect_uri, escopos FROM mcp_resolver_token($1, $2)',
      sha256(token), tipo,
    );
    return rows[0] ?? null;
  }

  async token(corpo: Record<string, unknown>, authorization?: string) {
    const cliente = await this.autenticarCliente(corpo, authorization);
    const tipo = corpo.grant_type;

    if (tipo === 'authorization_code') {
      const r = await this.resolver(String(corpo.code ?? ''), 'codigo');
      if (!r || r.cliente_id !== cliente.id) throw new OAuthErro(400, 'invalid_grant', 'código inválido, vencido ou já usado');
      if (corpo.redirect_uri !== undefined && corpo.redirect_uri !== r.redirect_uri) throw new OAuthErro(400, 'invalid_grant', 'redirect_uri não confere');
      if (!pkceConfere(typeof corpo.code_verifier === 'string' ? corpo.code_verifier : undefined, r.code_challenge)) {
        throw new OAuthErro(400, 'invalid_grant', 'code_verifier não confere (PKCE)');
      }
      return this.emitir(r);
    }
    if (tipo === 'refresh_token') {
      const r = await this.resolver(String(corpo.refresh_token ?? ''), 'renovacao');
      if (!r || r.cliente_id !== cliente.id) throw new OAuthErro(400, 'invalid_grant', 'token de renovação inválido, vencido ou revogado');
      return this.emitir(r);
    }
    throw new OAuthErro(400, 'unsupported_grant_type', 'grant_type aceitos: authorization_code, refresh_token');
  }

  private async emitir(r: LinhaResolvida) {
    const acesso = novoToken('kha');
    const renovacao = novoToken('khr');
    const agora = Date.now();
    await this.prisma.withTenant(r.tenant_id, (tx) =>
      tx.mcpToken.createMany({
        data: [
          { tenantId: r.tenant_id, conexaoId: r.conexao_id, tipo: 'acesso', hash: sha256(acesso), expiraEm: new Date(agora + TTL_ACESSO_S * 1000) },
          { tenantId: r.tenant_id, conexaoId: r.conexao_id, tipo: 'renovacao', hash: sha256(renovacao), expiraEm: new Date(agora + TTL_RENOVACAO_S * 1000) },
        ],
      }),
    );
    if (Math.random() < 0.05) void this.prisma.$queryRawUnsafe('SELECT mcp_limpar_tokens()').catch(() => undefined);
    return { access_token: acesso, token_type: 'Bearer', expires_in: TTL_ACESSO_S, refresh_token: renovacao, scope: r.escopos.join(' ') || ESCOPO_KHUB };
  }

  /** RFC 7009: revogar um token desliga a conexão inteira. Sempre 200. */
  async revogarPorToken(corpo: Record<string, unknown>, authorization?: string) {
    const cliente = await this.autenticarCliente(corpo, authorization);
    const t = String(corpo.token ?? '');
    const r = (await this.resolver(t, 'acesso')) ?? (await this.resolver(t, 'renovacao'));
    if (r && r.cliente_id === cliente.id) await this.revogarConexao(r.tenant_id, r.conexao_id, r.identity_id, 'aplicativo');
  }

  // ------------------------------------------------------------ uso do token no /mcp

  async autenticar(bearer: string | undefined): Promise<AtorMcp | null> {
    if (!bearer) return null;
    const r = await this.resolver(bearer, 'acesso');
    if (!r) return null;
    // O papel é lido a cada chamada: quem perde o admin perde o MCP na hora.
    const [membership, tenant, conexao] = await Promise.all([
      this.prisma.membership.findUnique({ where: { identityId_tenantId: { identityId: r.identity_id, tenantId: r.tenant_id } }, select: { role: true } }),
      this.prisma.tenant.findUnique({ where: { id: r.tenant_id }, select: { status: true } }),
      this.prisma.withTenant(r.tenant_id, (tx) => tx.mcpConexao.findUnique({ where: { id: r.conexao_id }, select: { nomeCliente: true } })),
    ]);
    if (!membership || !PAPEIS_MCP.includes(membership.role) || tenant?.status !== 'active' || !conexao) return null;
    return { tenantId: r.tenant_id, identityId: r.identity_id, role: membership.role, conexaoId: r.conexao_id, nomeCliente: conexao.nomeCliente };
  }

  // ------------------------------------------------------------ tela de Integrações

  async listarConexoes(tenantId: string) {
    const linhas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.mcpConexao.findMany({ where: { revogadaEm: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
    );
    const pessoas = await this.prisma.identity.findMany({
      where: { id: { in: [...new Set(linhas.map((l) => l.identityId))] } },
      select: { id: true, email: true },
    });
    const email = new Map(pessoas.map((p) => [p.id, p.email]));
    return linhas.map((l) => ({
      id: l.id,
      aplicativo: l.nomeCliente,
      autorizadoPor: email.get(l.identityId) ?? null,
      criadaEm: l.createdAt,
      ultimoUsoEm: l.ultimoUsoEm,
    }));
  }

  async revogarConexao(tenantId: string, id: string, identityId: string, por: 'humano' | 'aplicativo' = 'humano') {
    const ok = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.mcpConexao.findFirst({ where: { id, revogadaEm: null }, select: { id: true, nomeCliente: true } });
      if (!c) return false;
      await tx.mcpConexao.update({ where: { id }, data: { revogadaEm: new Date() } });
      await tx.mcpToken.deleteMany({ where: { conexaoId: id } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, ${por === 'humano' ? 'humano' : 'mcp'}, ${identityId}, 'mcp.conexao_revogada', 'mcp_conexao', ${id}, ${JSON.stringify({ aplicativo: c.nomeCliente })}::jsonb)`;
      return true;
    });
    if (!ok && por === 'humano') throw new NotFoundException('conexão inexistente ou já revogada');
    return { ok: true };
  }
}
