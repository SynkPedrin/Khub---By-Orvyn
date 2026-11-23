import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { GENNA, assinarEstadoGenna, gerarPkce, urlAutorizacao, verificarEstadoGenna, VALIDADE_STATE_MS } from './genna-oauth';
import { GennaMcpError, SessaoGenna, dadosDoResultado, lerRespostaRpc, textoDoResultado } from './genna-mcp';
import { GennaConexaoService, type CredencialGenna } from './genna-conexao.service';
import { classificar, formatar, resumoPublicacao } from './genna.service';
import { hasPermission, permissionFor } from '../../auth/permissions.guard';
import type { ConfigService } from '../../config/config.service';
import type { CryptoService } from '../crypto.service';
import type { PrismaService } from '../../prisma/prisma.service';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const TENANT = '11111111-1111-1111-1111-111111111111';

describe('Genna: OAuth (PKCE + state)', () => {
  it('PKCE S256: desafio é o sha256 base64url do verificador', () => {
    const { verificador, desafio } = gerarPkce();
    expect(verificador.length).toBeGreaterThanOrEqual(43);
    expect(desafio).toBe(createHash('sha256').update(verificador).digest('base64url'));
  });

  it('state: ida e volta preserva tenant, cliente e verificador cifrado', () => {
    const s = assinarEstadoGenna({ tenantId: TENANT, identityId: 'id-1', clientId: 'mcp_client_x', verificadorCifrado: 'cif' }, SEGREDO, 1_000_000);
    expect(verificarEstadoGenna(s, SEGREDO, 1_005_000)).toMatchObject({ tenantId: TENANT, identityId: 'id-1', clientId: 'mcp_client_x', verificadorCifrado: 'cif', fluxo: 'genna' });
  });

  it('state: recusa troca de tenant, outro segredo e expiração', () => {
    const s = assinarEstadoGenna({ tenantId: TENANT, identityId: null, clientId: 'c', verificadorCifrado: 'v' }, SEGREDO, 1_000_000);
    const [corpo, sig] = s.split('.');
    const d = JSON.parse(Buffer.from(corpo!, 'base64url').toString());
    d.tenantId = '22222222-2222-2222-2222-222222222222';
    expect(() => verificarEstadoGenna(`${Buffer.from(JSON.stringify(d)).toString('base64url')}.${sig}`, SEGREDO, 1_000_000)).toThrow('state adulterado');
    expect(() => verificarEstadoGenna(s, 'outro-segredo-qualquer-com-tamanho', 1_000_000)).toThrow('state adulterado');
    expect(() => verificarEstadoGenna(s, SEGREDO, 1_000_000 + VALIDADE_STATE_MS + 1)).toThrow('expirado');
  });

  it('URL de autorização leva PKCE, escopos e resource do MCP', () => {
    const u = new URL(urlAutorizacao({ clientId: 'c1', redirectUri: 'https://app.x/api/integrations/genna/callback', state: 'st', desafio: 'dd' }));
    expect(u.origin + u.pathname).toBe(GENNA.autorizar);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'c1', code_challenge: 'dd', code_challenge_method: 'S256',
      scope: 'mcp:read mcp:write mcp:publish', resource: 'https://mcp.genna.co', state: 'st',
    });
  });
});

describe('Genna: cliente MCP', () => {
  it('lê resposta JSON e SSE (ignora notificação antes do resultado)', () => {
    expect(lerRespostaRpc('{"jsonrpc":"2.0","id":3,"result":{"a":1}}', 'application/json', 3)?.result).toEqual({ a: 1 });
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n';
    expect(lerRespostaRpc(sse, 'text/event-stream', 2)?.result).toEqual({ tools: [] });
    expect(lerRespostaRpc('lixo', 'application/json', 1)).toBeNull();
  });

  it('dados: structuredContent > texto JSON > null; texto junta blocos', () => {
    expect(dadosDoResultado({ content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { y: 2 } })).toEqual({ y: 2 });
    expect(dadosDoResultado({ content: [{ type: 'text', text: 'oi' }, { type: 'text', text: ' [1,2]' }] })).toEqual([1, 2]);
    expect(dadosDoResultado({ content: [{ type: 'text', text: 'sem json' }] })).toBeNull();
    expect(textoDoResultado({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] })).toBe('a\n\nb');
  });

  it('sessão: initialize → initialized → tools/list (com cursor) repassando o Mcp-Session-Id', async () => {
    const chamadas: { metodo: string; sessao: string | null; auth: string | null }[] = [];
    const f = jest.fn(async (_u: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      const corpo = JSON.parse(String(init.body));
      chamadas.push({ metodo: corpo.method, sessao: h['mcp-session-id'] ?? null, auth: h.authorization ?? null });
      const res = (body: unknown, extra: Record<string, string> = {}) =>
        new Response(body === null ? null : JSON.stringify(body), { status: body === null ? 202 : 200, headers: { 'content-type': 'application/json', ...extra } });
      if (corpo.method === 'initialize') return res({ jsonrpc: '2.0', id: corpo.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'genna' } } }, { 'mcp-session-id': 'S1' });
      if (corpo.method === 'notifications/initialized') return res(null);
      if (corpo.method === 'tools/list' && !corpo.params.cursor) return res({ jsonrpc: '2.0', id: corpo.id, result: { tools: [{ name: 'a' }], nextCursor: 'p2' } });
      return res({ jsonrpc: '2.0', id: corpo.id, result: { tools: [{ name: 'b' }] } });
    });
    const s = new SessaoGenna('https://mcp.genna.co', 'TOK', f as unknown as typeof fetch);
    const tools = await s.listarFerramentas();
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(chamadas.map((c) => c.metodo)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    expect(chamadas.slice(1).every((c) => c.sessao === 'S1')).toBe(true);
    expect(chamadas.every((c) => c.auth === 'Bearer TOK')).toBe(true);
  });

  it('sessão: 401 vira GennaMcpError com status (o serviço renova o token)', async () => {
    const f = jest.fn(async () => new Response('{"error":"Missing or malformed Authorization header"}', { status: 401, headers: { 'content-type': 'application/json' } }));
    const s = new SessaoGenna('https://mcp.genna.co', 'TOK', f as unknown as typeof fetch);
    await expect(s.listarFerramentas()).rejects.toMatchObject({ name: 'GennaMcpError', status: 401, message: 'Missing or malformed Authorization header' });
  });

  it('sessão: erro JSON-RPC vira GennaMcpError com o código', async () => {
    const f = jest.fn(async (_u: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, result: {} }), { headers: { 'content-type': 'application/json' } });
      if (!corpo.id) return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: corpo.id, error: { code: -32602, message: 'brand_id obrigatório' } }), { headers: { 'content-type': 'application/json' } });
    });
    const s = new SessaoGenna('https://mcp.genna.co', 'TOK', f as unknown as typeof fetch);
    const e = await s.chamar('x', {}).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(GennaMcpError);
    expect(e).toMatchObject({ codigoRpc: -32602, message: 'brand_id obrigatório' });
  });
});

describe('Genna: classificação e formato', () => {
  it('só readOnlyHint=true é leitura; publicar/agendar é publicação mesmo anotado como leitura', () => {
    expect(classificar({ name: 'get_profile_analytics', annotations: { readOnlyHint: true } })).toBe('leitura');
    expect(classificar({ name: 'list_posts' })).toBe('escrita');
    expect(classificar({ name: 'create_carousel', annotations: { readOnlyHint: false } })).toBe('escrita');
    expect(classificar({ name: 'publish_post', annotations: { readOnlyHint: true } })).toBe('publicacao');
    expect(classificar({ name: 'schedule_post' })).toBe('publicacao');
    expect(classificar({ name: 'delete_post', annotations: { destructiveHint: true } })).toBe('publicacao');
  });

  it('formatar: imagens viram data URL, links só https', () => {
    const r = formatar('x', 'leitura', {
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'resource_link', uri: 'https://app.genna.co/p/1' },
        { type: 'resource_link', uri: 'javascript:alert(1)' },
      ],
    });
    expect(r).toMatchObject({ ok: true, texto: 'ok', imagens: ['data:image/png;base64,AAAA'], links: ['https://app.genna.co/p/1'] });
  });

  it('resumo de publicação cita a ferramenta e só argumentos simples', () => {
    expect(resumoPublicacao('publish_post', { post_id: 'p1', canais: ['ig'], quando: '2026-11-23T09:00' })).toBe('[Genna] publish_post (post_id: p1, quando: 2026-11-23T09:00)');
  });
});

describe('Genna: conexão e renovação do token', () => {
  function montar(cred: CredencialGenna | null, respostaToken?: { status: number; corpo: Record<string, unknown> }) {
    const env: Record<string, string> = { INTEGRATIONS_ENCRYPTION_KEY: 'k', JWT_SECRET: SEGREDO, WEB_URL: 'https://app.exemplo.com/' };
    const config = {
      get: (k: string) => env[k],
      missingVars: () => [],
      require: () => undefined,
    } as unknown as ConfigService;
    const crypto = {
      encryptJson: (o: unknown) => `cifrado:${JSON.stringify(o)}`,
      decryptJson: <T>(s: string) => JSON.parse(s.replace(/^cifrado:/, '')) as T,
    } as unknown as CryptoService;
    const tx = {
      integration: {
        findFirst: jest.fn().mockResolvedValue(cred ? { id: 'i1', status: 'connected', credentialsEncrypted: `cifrado:${JSON.stringify(cred)}` } : null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'novo' }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService;
    const svc = new GennaConexaoService(prisma, config, crypto);
    const f = jest.fn(async (url: string, init: RequestInit) => {
      if (url === GENNA.registrar) return new Response(JSON.stringify({ client_id: 'mcp_client_novo' }), { status: 201 });
      const corpo = new URLSearchParams(String(init.body));
      f.ultimoCorpo = Object.fromEntries(corpo);
      return new Response(JSON.stringify(respostaToken?.corpo ?? {}), { status: respostaToken?.status ?? 200 });
    }) as jest.Mock & { ultimoCorpo?: Record<string, string> };
    svc.usarFetch(f as unknown as typeof fetch);
    return { svc, tx, f };
  }

  const base: CredencialGenna = { accessToken: 'A1', refreshToken: 'R1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ['mcp:read'], clientId: 'mcp_client_x' };

  it('token ainda válido: não chama o Genna', async () => {
    const { svc, f } = montar(base);
    await expect(svc.token(TENANT)).resolves.toBe('A1');
    expect(f).not.toHaveBeenCalled();
  });

  it('token vencendo: renova com o mesmo client_id e grava a credencial nova', async () => {
    const { svc, f, tx } = montar({ ...base, expiresAt: new Date(Date.now() + 10_000).toISOString() }, { status: 200, corpo: { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'mcp:read mcp:publish' } });
    await expect(svc.token(TENANT)).resolves.toBe('A2');
    expect(f.ultimoCorpo).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'R1', client_id: 'mcp_client_x', resource: 'https://mcp.genna.co' });
    const gravado = tx.integration.update.mock.calls[0][0].data;
    expect(JSON.parse(gravado.credentialsEncrypted.replace(/^cifrado:/, ''))).toMatchObject({ accessToken: 'A2', refreshToken: 'R2', clientId: 'mcp_client_x' });
    expect(gravado.scopes).toEqual(['mcp:read', 'mcp:publish']);
  });

  it('duas chamadas ao mesmo tempo renovam UMA vez (refresh rotativo não se queima)', async () => {
    const { svc, f } = montar({ ...base, expiresAt: new Date(0).toISOString() }, { status: 200, corpo: { access_token: 'A2', expires_in: 3600 } });
    const [a, b] = await Promise.all([svc.token(TENANT), svc.token(TENANT)]);
    expect([a, b]).toEqual(['A2', 'A2']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refresh recusado (400): marca a conexão como expirada e devolve 409', async () => {
    const { svc, tx } = montar({ ...base, expiresAt: new Date(0).toISOString() }, { status: 400, corpo: { error: 'invalid_grant' } });
    const e = await svc.token(TENANT).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(409);
    expect(tx.integration.update.mock.calls[0][0].data).toMatchObject({ status: 'error', health: 'down' });
  });

  it('Genna fora do ar (503) no refresh: 502 e a conexão continua ativa', async () => {
    const { svc, tx } = montar({ ...base, expiresAt: new Date(0).toISOString() }, { status: 503, corpo: {} });
    const e = await svc.token(TENANT).catch((err: unknown) => err);
    expect((e as HttpException).getStatus()).toBe(502);
    expect(tx.integration.update).not.toHaveBeenCalled();
  });

  it('sem conexão: 409 genna_nao_conectado', async () => {
    const { svc } = montar(null);
    const e = await svc.token(TENANT).catch((err: unknown) => err);
    expect((e as HttpException).getStatus()).toBe(409);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'genna_nao_conectado' });
  });

  it('URL de conexão: cadastro dinâmico uma vez, redirect do WEB_URL, verificador só cifrado', async () => {
    const { svc, f } = montar(null);
    const { url } = await svc.urlConexao(TENANT, 'id-1');
    await svc.urlConexao(TENANT, 'id-1');
    expect(f.mock.calls.filter((c) => c[0] === GENNA.registrar)).toHaveLength(1);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('mcp_client_novo');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.exemplo.com/api/integrations/genna/callback');
    const e = verificarEstadoGenna(u.searchParams.get('state')!, SEGREDO);
    const segredoPkce = JSON.parse(e.verificadorCifrado.replace(/^cifrado:/, '')) as { v: string };
    expect(createHash('sha256').update(segredoPkce.v).digest('base64url')).toBe(u.searchParams.get('code_challenge'));
  });

  it('callback: troca o código com o verificador e grava conectado', async () => {
    const { svc, f, tx } = montar(null, { status: 200, corpo: { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, scope: 'mcp:read mcp:write mcp:publish' } });
    const { url } = await svc.urlConexao(TENANT, 'id-1');
    const state = new URL(url).searchParams.get('state')!;
    await expect(svc.callback('CODE', state)).resolves.toEqual({ ok: true, podePublicar: true });
    expect(f.ultimoCorpo).toMatchObject({ grant_type: 'authorization_code', code: 'CODE', client_id: 'mcp_client_novo', redirect_uri: 'https://app.exemplo.com/api/integrations/genna/callback' });
    expect(f.ultimoCorpo?.code_verifier).toBeTruthy();
    expect(tx.integration.create.mock.calls[0][0].data).toMatchObject({ tenantId: TENANT, provider: 'genna', status: 'connected', connectedBy: 'id-1' });
  });
});

describe('Genna: permissões das rotas /v1/genna', () => {
  const u = (role: string) => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
  it('ver status/ferramentas e consultar é de quem vê a tela (member inclusive)', () => {
    for (const [rota, metodo] of [['status', 'GET'], ['ferramentas', 'GET'], ['consultar/:nome', 'POST']] as const) {
      const p = permissionFor('genna', rota, metodo);
      expect(hasPermission(u('member'), p)).toBe(true);
    }
  });
  it('conectar, desconectar e executar (criar/publicar) é só de owner/admin', () => {
    for (const [rota, metodo] of [['auth-url', 'GET'], ['conexao', 'DELETE'], ['executar/:nome', 'POST']] as const) {
      const p = permissionFor('genna', rota, metodo);
      expect(hasPermission(u('manager'), p)).toBe(false);
      expect(hasPermission(u('member'), p)).toBe(false);
      expect(hasPermission(u('admin'), p)).toBe(true);
    }
  });
});
