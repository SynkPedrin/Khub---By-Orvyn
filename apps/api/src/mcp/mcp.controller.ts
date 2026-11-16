import { Body, Controller, Delete, Get, Headers, HttpCode, Logger, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, Public, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { SkipRateLimit } from '../common/rate-limit.guard';
import { RedisService } from '../common/redis.service';
import { ConfigService } from '../config/config.service';
import { ipDoCliente } from '../common/public-request';
import { McpOAuthService, OAuthErro } from './oauth.service';
import { McpFerramentasService } from './mcp-ferramentas.service';
import { metadadosAutorizacao, metadadosRecurso, origemPublica } from './oauth-util';
import { tratarCorpo, type ResultadoChamada } from './mcp-protocolo';

/** Por conexão: um agente do Claude/ChatGPT em loop não derruba a conta. */
const MAX_CHAMADAS_MIN = 120;

/** `Cache-Control: no-store` em tudo que carrega token (RFC 6749 §5.1). */
function semCache(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Rotas públicas do OAuth e o endpoint MCP — FORA do prefixo /v1 (descoberta
 * OAuth é na raiz do host, por especificação). Ver `main.ts` (exclude).
 */
@Public()
@SkipAudit()
@Controller()
export class McpOAuthController {
  constructor(
    private readonly oauth: McpOAuthService,
    private readonly config: ConfigService,
  ) {}

  private base(req: Request) {
    return origemPublica(this.config.get('API_PUBLIC_URL'), req);
  }

  @Get('.well-known/oauth-authorization-server')
  metadadosAs(@Req() req: Request) {
    return metadadosAutorizacao(this.base(req));
  }

  /** Alguns clientes só tentam o endereço do OpenID Connect. */
  @Get('.well-known/openid-configuration')
  metadadosOidc(@Req() req: Request) {
    return metadadosAutorizacao(this.base(req));
  }

  @Get('.well-known/oauth-protected-resource')
  metadadosRecurso(@Req() req: Request) {
    return metadadosRecurso(this.base(req));
  }

  @Get('.well-known/oauth-protected-resource/mcp')
  metadadosRecursoMcp(@Req() req: Request) {
    return metadadosRecurso(this.base(req));
  }

  @Post('oauth/register')
  async registrar(@Req() req: Request, @Res() res: Response) {
    semCache(res);
    try {
      res.status(201).json(await this.oauth.registrar((req.body ?? {}) as Record<string, unknown>, ipDoCliente(req)));
    } catch (e) {
      this.responderErro(res, e);
    }
  }

  @Get('oauth/authorize')
  async autorizar(@Query() q: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const r = await this.oauth.iniciar(q, `${this.base(req)}/mcp`);
    if ('redirecionar' in r) return res.redirect(302, r.redirecionar);
    res.status(400).type('text/html; charset=utf-8').send(paginaErro(r.erroLocal));
  }

  @Post('oauth/token')
  async token(@Req() req: Request, @Headers('authorization') auth: string | undefined, @Res() res: Response) {
    semCache(res);
    try {
      res.status(200).json(await this.oauth.token((req.body ?? {}) as Record<string, unknown>, auth));
    } catch (e) {
      this.responderErro(res, e);
    }
  }

  @Post('oauth/revoke')
  async revogar(@Req() req: Request, @Headers('authorization') auth: string | undefined, @Res() res: Response) {
    semCache(res);
    try {
      await this.oauth.revogarPorToken((req.body ?? {}) as Record<string, unknown>, auth);
      res.status(200).json({});
    } catch (e) {
      this.responderErro(res, e);
    }
  }

  private responderErro(res: Response, e: unknown) {
    if (e instanceof OAuthErro) {
      if (e.status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="khub"');
      res.status(e.status).json(e.corpo());
      return;
    }
    new Logger('McpOAuth').error(`falha no OAuth: ${(e as Error).message}`);
    res.status(500).json({ error: 'server_error', error_description: 'erro interno' });
  }
}

/** Endpoint MCP (Streamable HTTP, sem sessão, respostas JSON). */
@Public()
@SkipAudit()
@SkipRateLimit()
@Controller('mcp')
export class McpController {
  private readonly log = new Logger('Mcp');

  constructor(
    private readonly oauth: McpOAuthService,
    private readonly ferramentas: McpFerramentasService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response) {
    const base = origemPublica(this.config.get('API_PUBLIC_URL'), req);
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const ator = await this.oauth.autenticar(bearer);
    if (!ator) {
      // O 401 com resource_metadata é o que dispara o login OAuth no Claude/ChatGPT.
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"${bearer ? ', error="invalid_token"' : ''}`);
      res.status(401).json({ error: 'invalid_token', error_description: bearer ? 'token inválido, vencido ou revogado' : 'autenticação necessária' });
      return;
    }

    const n = await this.redis.incrWithTtl(`rl:mcp:${ator.conexaoId}:${Math.floor(Date.now() / 60_000)}`, 60);
    if (n !== null && n > MAX_CHAMADAS_MIN) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: `limite de ${MAX_CHAMADAS_MIN} chamadas por minuto` } });
      return;
    }

    const resposta = await tratarCorpo(req.body, {
      nome: 'khub',
      versao: '1.0.0',
      listarTools: () => this.ferramentas.listar(),
      chamarTool: async (nome, args): Promise<ResultadoChamada> => {
        const t0 = Date.now();
        const r = await this.ferramentas.chamar(nome, args, ator);
        this.log.log(`tool ${nome} · ${r.ok ? (r.aprovacao ? 'aprovação pedida' : 'ok') : 'erro'} · ${Date.now() - t0} ms · tenant ${ator.tenantId}`);
        if (!r.ok) return { content: [{ type: 'text', text: `Erro: ${r.erro}` }], isError: true };
        if (r.aprovacao) {
          const txt = `AGUARDANDO APROVAÇÃO — nada foi executado ainda. Pedido criado no KHUB: "${r.aprovacao.resumo}". Um dono/admin precisa aprovar em KHUB > NICO > Aprovações (vale 24 h). Avise o usuário; não diga que foi feito.`;
          return { content: [{ type: 'text', text: txt }], structuredContent: { pendente: true, aprovacaoId: r.aprovacao.id } };
        }
        return { content: [{ type: 'text', text: McpFerramentasService.serializar(r.dados) }] };
      },
    });
    if (resposta === null) {
      res.status(202).end();
      return;
    }
    res.status(200).json(resposta);
  }

  /** Sem stream servidor→cliente: este servidor só responde a POST. */
  @Get()
  get(@Res() res: Response) {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'use POST' });
  }

  @Delete()
  delete(@Res() res: Response) {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'servidor sem sessão' });
  }
}

class DecidirDto {
  @IsString() @MaxLength(4000) pedido!: string;
  @IsBoolean() aprovar!: boolean;
}

/** Tela de consentimento e gestão das conexões (logado, sob /v1). */
@SkipAudit()
@Controller('conector-ia')
export class ConectorIaController {
  constructor(
    private readonly oauth: McpOAuthService,
    private readonly ferramentas: McpFerramentasService,
    private readonly config: ConfigService,
  ) {}

  /** URL a colar no Claude/ChatGPT + o que o conector sabe fazer. */
  @Get('info')
  info(@Req() req: Request) {
    const base = origemPublica(this.config.get('API_PUBLIC_URL'), req);
    const tools = this.ferramentas.listar();
    return {
      url: `${base}/mcp`,
      totalFerramentas: tools.length,
      ferramentas: tools.map((t) => ({ nome: t.name, titulo: t.title, tipo: t.annotations.destructiveHint ? 'aprovacao' : t.annotations.readOnlyHint ? 'leitura' : 'escrita' })),
    };
  }

  @Get('pedido/:pedido')
  pedido(@CurrentUser() u: AuthUser, @Param('pedido') pedido: string) {
    return this.oauth.detalhesPedido(u, pedido);
  }

  @Post('decidir')
  @HttpCode(200)
  decidir(@CurrentUser() u: AuthUser, @Body() dto: DecidirDto) {
    return this.oauth.decidir(u, dto.pedido, dto.aprovar);
  }

  @Get('conexoes')
  conexoes(@TenantId() t: string) {
    return this.oauth.listarConexoes(t);
  }

  @Delete('conexoes/:id')
  @HttpCode(200)
  revogar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.oauth.revogarConexao(t, id, u.identityId);
  }
}

function paginaErro(msg: string): string {
  const esc = msg.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KHUB — conexão</title>
<body style="font-family:system-ui,sans-serif;background:#0b0a10;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:440px;background:#16141f;border:1px solid #2a2638;border-radius:16px;padding:28px"><h1 style="font-size:18px;margin:0 0 8px">Não foi possível conectar</h1>
<p style="color:#bbb;line-height:1.5;margin:0">${esc}</p></main></body></html>`;
}
