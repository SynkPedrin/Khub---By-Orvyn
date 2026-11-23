/**
 * Cliente MCP mínimo (Streamable HTTP, JSON-RPC 2.0) para o servidor do Genna.
 * Sem SDK novo (stack congelada): só `fetch`. Aceita resposta em JSON ou em
 * `text/event-stream` (o servidor escolhe; a spec permite os dois).
 *
 * Funções puras + uma classe com `fetch` injetável, para teste sem rede.
 * Spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

export const VERSAO_PROTOCOLO = '2025-03-26';

export interface FerramentaMcp {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ConteudoMcp {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  resource?: { uri?: string; mimeType?: string; text?: string };
}

export interface ResultadoFerramenta {
  content: ConteudoMcp[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Erro do lado do Genna. `status` 401 = token recusado; 404 = sessão MCP expirou. */
export class GennaMcpError extends Error {
  constructor(message: string, readonly status: number, readonly codigoRpc: number | null = null) {
    super(message);
    this.name = 'GennaMcpError';
  }
}

interface RespostaRpc {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * Extrai a resposta JSON-RPC de id `id` do corpo. Em SSE pode haver vários
 * eventos (notificações de progresso antes do resultado): vale o do id.
 */
export function lerRespostaRpc(corpo: string, contentType: string, id: number): RespostaRpc | null {
  const candidatos: RespostaRpc[] = [];
  if (contentType.includes('text/event-stream')) {
    let dados: string[] = [];
    const fechar = () => {
      if (dados.length) {
        try {
          candidatos.push(JSON.parse(dados.join('\n')) as RespostaRpc);
        } catch {
          /* evento que não é JSON (comentário/keep-alive) */
        }
      }
      dados = [];
    };
    for (const linha of corpo.split(/\r?\n/)) {
      if (linha === '') fechar();
      else if (linha.startsWith('data:')) dados.push(linha.slice(5).replace(/^ /, ''));
    }
    fechar();
  } else if (corpo.trim()) {
    try {
      const j = JSON.parse(corpo) as RespostaRpc | RespostaRpc[];
      candidatos.push(...(Array.isArray(j) ? j : [j]));
    } catch {
      return null;
    }
  }
  return candidatos.find((c) => c && c.id === id && ('result' in c || 'error' in c)) ?? null;
}

/** Texto legível do resultado de uma ferramenta (o que a tela e o log mostram). */
export function textoDoResultado(r: ResultadoFerramenta): string {
  return (r.content ?? [])
    .map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'resource' ? c.resource?.text ?? c.resource?.uri ?? '' : ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Conteúdo estruturado do resultado: `structuredContent` quando o servidor
 * manda; senão, o primeiro bloco de texto que for JSON válido; senão null.
 */
export function dadosDoResultado(r: ResultadoFerramenta): unknown {
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  for (const c of r.content ?? []) {
    if (c.type !== 'text' || !c.text) continue;
    const t = c.text.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      return JSON.parse(t);
    } catch {
      /* texto comum */
    }
  }
  return null;
}

type Fetch = typeof fetch;

/**
 * Uma sessão MCP com o Genna para UM access token. Barata de criar: o serviço
 * abre uma por chamada (o servidor pode exigir `Mcp-Session-Id` entre
 * initialize e as chamadas seguintes, e a sessão não sobrevive a deploys).
 */
export class SessaoGenna {
  private sessaoId: string | null = null;
  private proximoId = 1;
  private iniciada = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly f: Fetch = fetch,
    private readonly timeoutMs = 60_000,
  ) {}

  private async enviar(corpo: Record<string, unknown>, esperaResposta: boolean): Promise<RespostaRpc | null> {
    let r: Response;
    try {
      r = await this.f(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': VERSAO_PROTOCOLO,
          ...(this.sessaoId ? { 'mcp-session-id': this.sessaoId } : {}),
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new GennaMcpError(`Genna sem resposta (${(e as Error).message})`, 0);
    }
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.sessaoId = sid;
    const texto = await r.text();
    if (!r.ok && r.status !== 202) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = JSON.parse(texto) as { error?: unknown; error_description?: string; message?: string };
        msg = j.error_description ?? j.message ?? (typeof j.error === 'string' ? j.error : msg);
      } catch {
        /* corpo não JSON */
      }
      throw new GennaMcpError(msg, r.status);
    }
    if (!esperaResposta) return null;
    const id = corpo.id as number;
    const resp = lerRespostaRpc(texto, r.headers.get('content-type') ?? '', id);
    if (!resp) throw new GennaMcpError('resposta do Genna em formato inesperado', r.status);
    if (resp.error) throw new GennaMcpError(resp.error.message ?? 'erro do Genna', r.status, resp.error.code ?? null);
    return resp;
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.proximoId++;
    const r = await this.enviar({ jsonrpc: '2.0', id, method, params }, true);
    return r?.result;
  }

  async iniciar(): Promise<{ servidor: string | null; versao: string | null }> {
    if (this.iniciada) return { servidor: null, versao: null };
    const r = (await this.rpc('initialize', {
      protocolVersion: VERSAO_PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'KHUB', version: '1.0.0' },
    })) as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
    await this.enviar({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
    this.iniciada = true;
    return { servidor: r?.serverInfo?.name ?? null, versao: r?.protocolVersion ?? null };
  }

  async listarFerramentas(): Promise<FerramentaMcp[]> {
    await this.iniciar();
    const todas: FerramentaMcp[] = [];
    let cursor: string | undefined;
    // Teto de páginas: um servidor com cursor quebrado não prende a requisição.
    for (let pagina = 0; pagina < 20; pagina++) {
      const r = (await this.rpc('tools/list', cursor ? { cursor } : {})) as { tools?: FerramentaMcp[]; nextCursor?: string } | undefined;
      todas.push(...(r?.tools ?? []));
      cursor = r?.nextCursor;
      if (!cursor) break;
    }
    return todas;
  }

  async chamar(nome: string, argumentos: Record<string, unknown>): Promise<ResultadoFerramenta> {
    await this.iniciar();
    const r = (await this.rpc('tools/call', { name: nome, arguments: argumentos })) as ResultadoFerramenta | undefined;
    return { content: r?.content ?? [], structuredContent: r?.structuredContent, isError: !!r?.isError };
  }
}
