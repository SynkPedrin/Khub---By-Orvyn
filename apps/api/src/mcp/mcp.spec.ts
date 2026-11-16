import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  assinarPedido, lerPedido, metadadosAutorizacao, metadadosRecurso, novoToken, origemPublica,
  pkceConfere, redirectValido, urlDeRetorno,
} from './oauth-util';
import { paraJsonSchema } from './json-schema';
import { negociarVersao, tratarCorpo, tratarMensagem, type Servidor } from './mcp-protocolo';
import { TOOLS } from '../nyro/tools';
import { McpFerramentasService } from './mcp-ferramentas.service';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';

describe('Conector MCP — OAuth (ADR-0049)', () => {
  it('PKCE S256: aceita o verifier certo e recusa qualquer outro', () => {
    const verifier = 'a'.repeat(43) + 'Bc-._~9';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceConfere(verifier, challenge)).toBe(true);
    expect(pkceConfere(verifier + 'x', challenge)).toBe(false);
    expect(pkceConfere(undefined, challenge)).toBe(false);
    expect(pkceConfere(verifier, null)).toBe(false);
    expect(pkceConfere('curto', createHash('sha256').update('curto').digest('base64url'))).toBe(false); // < 43 chars
  });

  it('redirect: https em qualquer host, http só em loopback, nada de fragmento/credencial/esquema estranho', () => {
    expect(redirectValido('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectValido('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(redirectValido('http://localhost:6274/oauth/callback')).toBe(true);
    expect(redirectValido('http://127.0.0.1:33418/cb')).toBe(true);
    expect(redirectValido('http://evil.com/cb')).toBe(false);
    expect(redirectValido('https://a.com/cb#frag')).toBe(false);
    expect(redirectValido('https://user:pw@a.com/cb')).toBe(false);
    expect(redirectValido('javascript:alert(1)')).toBe(false);
    expect(redirectValido('myapp://cb')).toBe(false);
    expect(redirectValido(42)).toBe(false);
  });

  it('pedido assinado: ida e volta, recusa adulteração, segredo errado e vencido', () => {
    const t = assinarPedido({ cid: 'kcl_x', ru: 'https://claude.ai/cb', cc: 'c'.repeat(43), st: 'abc' }, SEGREDO);
    expect(lerPedido(t, SEGREDO)).toMatchObject({ cid: 'kcl_x', ru: 'https://claude.ai/cb', st: 'abc' });
    const [corpo, sig] = t.split('.');
    const adulterado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, 'base64url').toString()), ru: 'https://evil.com/cb' })).toString('base64url');
    expect(lerPedido(`${adulterado}.${sig}`, SEGREDO)).toBeNull();
    expect(lerPedido(t, 'outro-segredo-qualquer-com-32-caracteres')).toBeNull();
    expect(lerPedido(t, SEGREDO, Date.now() + 16 * 60_000)).toBeNull();
    expect(lerPedido('lixo', SEGREDO)).toBeNull();
    expect(lerPedido('a.b.c', SEGREDO)).toBeNull();
  });

  it('tokens: opacos, com prefixo e sem repetir', () => {
    const a = novoToken('kha');
    expect(a).toMatch(/^kha_[A-Za-z0-9_-]{43}$/);
    expect(novoToken('kha')).not.toBe(a);
  });

  it('URL de retorno preserva a query do cliente e escapa valores', () => {
    const u = new URL(urlDeRetorno('https://a.com/cb?x=1', { code: 'k&c', state: 's t', vazio: undefined }));
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.searchParams.get('code')).toBe('k&c');
    expect(u.searchParams.get('state')).toBe('s t');
    expect(u.searchParams.has('vazio')).toBe(false);
  });

  it('origem pública: env manda; senão proxy (x-forwarded-*)', () => {
    expect(origemPublica('https://api.khub.com/', { headers: { host: 'x' } })).toBe('https://api.khub.com');
    expect(origemPublica(undefined, { headers: { host: 'interno:4000', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.khub.com' } })).toBe('https://api.khub.com');
    expect(origemPublica(undefined, { headers: { host: 'localhost:4010' }, protocol: 'http' })).toBe('http://localhost:4010');
  });

  it('metadados RFC 8414/9728 apontam para os endpoints certos e exigem S256', () => {
    const m = metadadosAutorizacao('https://api.khub.com');
    expect(m).toMatchObject({
      issuer: 'https://api.khub.com',
      authorization_endpoint: 'https://api.khub.com/oauth/authorize',
      token_endpoint: 'https://api.khub.com/oauth/token',
      registration_endpoint: 'https://api.khub.com/oauth/register',
      code_challenge_methods_supported: ['S256'],
    });
    expect(metadadosRecurso('https://api.khub.com')).toMatchObject({ resource: 'https://api.khub.com/mcp', authorization_servers: ['https://api.khub.com'] });
  });
});

describe('Conector MCP — JSON Schema das tools', () => {
  it('converte campos com descrição, limites, uuid, enum, lista, registro e default', () => {
    const s = paraJsonSchema(z.object({
      id: z.string().uuid().describe('id'),
      n: z.number().int().min(1).max(5).default(2),
      e: z.enum(['a', 'b']).optional(),
      l: z.array(z.string().min(1)).min(1).max(3),
      r: z.record(z.unknown()).optional(),
      b: z.boolean(),
    }));
    expect(s).toMatchObject({
      type: 'object',
      required: ['id', 'l', 'b'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', format: 'uuid', description: 'id' },
        n: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
        e: { type: 'string', enum: ['a', 'b'] },
        l: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 3 },
        r: { type: 'object' },
        b: { type: 'boolean' },
      },
    });
  });

  it('TODAS as tools da NICO convertem (nenhum tipo sem suporte)', () => {
    for (const t of TOOLS) expect(() => paraJsonSchema(t.schema)).not.toThrow();
  });

  it('resultado gigante é cortado com aviso', () => {
    const s = McpFerramentasService.serializar({ x: 'y'.repeat(100_000) });
    expect(s.length).toBeLessThan(61_000);
    expect(s).toContain('resultado cortado');
  });
});

describe('Conector MCP — protocolo JSON-RPC', () => {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = [];
  const srv: Servidor = {
    nome: 'khub',
    versao: '1.0.0',
    listarTools: () => [{ name: 'khub_visao_geral', inputSchema: { type: 'object' } }],
    chamarTool: async (nome, args) => {
      chamadas.push({ nome, args });
      if (nome === 'explode') throw new Error('falhou');
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };

  it('initialize negocia versão e anuncia tools + instruções', async () => {
    const r = (await tratarMensagem({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, srv)) as { result: Record<string, unknown> };
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(String(r.result.instructions)).toContain('aprovação');
    expect(negociarVersao('1999-01-01')).toBe('2025-11-25');
  });

  it('notificação não tem resposta (transporte devolve 202)', async () => {
    expect(await tratarMensagem({ jsonrpc: '2.0', method: 'notifications/initialized' }, srv)).toBeNull();
  });

  it('tools/list e tools/call', async () => {
    const l = (await tratarMensagem({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, srv)) as { result: { tools: unknown[] } };
    expect(l.result.tools).toHaveLength(1);
    const c = (await tratarMensagem({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'khub_visao_geral', arguments: { a: 1 } } }, srv)) as { id: number; result: unknown };
    expect(c.id).toBe(3);
    expect(chamadas.at(-1)).toEqual({ nome: 'khub_visao_geral', args: { a: 1 } });
  });

  it('falha da tool vira resultado com isError (o modelo lê e corrige)', async () => {
    const c = (await tratarMensagem({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'explode' } }, srv)) as { result: { isError: boolean } };
    expect(c.result.isError).toBe(true);
  });

  it('erros de protocolo: versão jsonrpc, método desconhecido, params inválidos, corpo não-JSON', async () => {
    expect(await tratarMensagem({ jsonrpc: '1.0', id: 5, method: 'ping' }, srv)).toMatchObject({ error: { code: -32600 } });
    expect(await tratarMensagem({ jsonrpc: '2.0', id: 6, method: 'sampling/x' }, srv)).toMatchObject({ error: { code: -32601 } });
    expect(await tratarMensagem({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} }, srv)).toMatchObject({ error: { code: -32602 } });
    expect(await tratarMensagem({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'x', arguments: [1] } }, srv)).toMatchObject({ error: { code: -32602 } });
    expect(await tratarCorpo('texto', srv)).toMatchObject({ error: { code: -32700 } });
  });

  it('lote: responde só as requisições, nunca as notificações', async () => {
    const r = await tratarCorpo([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ], srv);
    expect(r).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    expect(await tratarCorpo([{ jsonrpc: '2.0', method: 'notifications/initialized' }], srv)).toBeNull();
  });
});

describe('Conector MCP — catálogo de ferramentas', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const registradas: string[] = [];
  const executor = { registrarExtra: (t: { nome: string }) => registradas.push(t.nome) } as any;
  const svc = new McpFerramentasService(null as any, executor, null as any, null as any, null as any, null as any, null as any, null as any, null as any);
  const tools = svc.listar();

  it('nomes únicos, schema de objeto e anotações coerentes', () => {
    const nomes = tools.map((t) => t.name);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z0-9_]{3,64}$/);
      expect((t.inputSchema as { type: string }).type).toBe('object');
      expect(t.annotations.readOnlyHint && t.annotations.destructiveHint).toBe(false);
    }
  });

  it('o que muda a operação real é SENSÍVEL (vira aprovação no KHUB)', () => {
    const sensiveis = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
    for (const n of ['publicar_agente', 'mudar_status_agente', 'configurar_canais_agente', 'publicar_automacao', 'enviar_mensagem', 'mudar_status_automacao', 'mover_etapa']) {
      expect(sensiveis).toContain(n);
    }
    // editar rascunho e testar NÃO tocam a operação: não precisam de aprovação
    for (const n of ['editar_agente', 'testar_agente', 'testar_automacao', 'salvar_rascunho_automacao']) expect(sensiveis).not.toContain(n);
  });

  it('memória/plano internos da NICO ficam fora; gestão de agentes entra', () => {
    const nomes = tools.map((t) => t.name);
    for (const n of ['lembrar', 'esquecer', 'atualizar_plano']) expect(nomes).not.toContain(n);
    for (const n of ['khub_visao_geral', 'listar_agentes', 'ver_agente', 'testar_agente', 'buscar_contatos', 'resumo_financeiro']) expect(nomes).toContain(n);
  });

  it('as próprias entram no executor da NICO (é por lá que a aprovação executa)', () => {
    svc.onModuleInit();
    expect(registradas).toEqual(expect.arrayContaining(['publicar_agente', 'mudar_status_agente', 'publicar_automacao', 'editar_agente']));
    expect(registradas).not.toContain('enviar_mensagem'); // essa já é da NICO
  });
});
