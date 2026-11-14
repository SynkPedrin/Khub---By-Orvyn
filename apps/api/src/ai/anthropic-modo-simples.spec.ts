import { AnthropicProvider } from './anthropic.provider';
import { ErroProvedorIA } from './provider.contract';
import type { ConfigService } from '../config/config.service';

const cfg = { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'sk-teste' : undefined), isConfigured: () => true, require: () => undefined, missingVars: () => [] } as unknown as ConfigService;
const ok = { content: [{ type: 'text', text: 'oi!' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 }, model: 'claude-sonnet-5-5' };
const resp = (status: number, corpo: unknown) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo), body: null }) as unknown as Response;
const entrada = { modelo: 'claude-sonnet-5-5', provedor: 'anthropic' as const, system: 'ESTAVEL', systemDinamico: 'DINAMICO', mensagens: [{ role: 'user' as const, content: 'oi' }], tools: [{ name: 'a', description: 'a', input_schema: { type: 'object' } }, { name: 'b', description: 'b', input_schema: { type: 'object' } }], fallbackRecusa: true };

describe('Anthropic: modo avançado e modo simples', () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });

  it('modo avançado usa cache de prompt no bloco estável e na última tool', async () => {
    const f = jest.fn().mockResolvedValue(resp(200, ok));
    global.fetch = f as unknown as typeof fetch;
    await new AnthropicProvider(cfg).conversar(entrada);
    const corpo = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(corpo.system).toEqual([{ type: 'text', text: 'ESTAVEL', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'DINAMICO' }]);
    expect(corpo.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(corpo.tools[0].cache_control).toBeUndefined();
  });

  it('400 no modo avançado: repete UMA vez em modo simples e entrega a resposta', async () => {
    const f = jest.fn().mockResolvedValueOnce(resp(400, { type: 'error', error: { type: 'invalid_request_error', message: 'cache_control incompatível' } })).mockResolvedValueOnce(resp(200, ok));
    global.fetch = f as unknown as typeof fetch;
    const r = await new AnthropicProvider(cfg).conversar({ ...entrada, onTexto: () => undefined });
    expect(r.texto).toBe('oi!');
    expect(f).toHaveBeenCalledTimes(2);
    const simples = JSON.parse((f.mock.calls[1][1] as { body: string }).body);
    expect(simples.stream).toBeUndefined();
    expect(simples.system).toBe('ESTAVEL\n\nDINAMICO');
    expect(JSON.stringify(simples.tools)).not.toContain('cache_control');
    expect((f.mock.calls[1][1] as { headers: Record<string, string> }).headers['anthropic-beta']).toBeUndefined();
  });

  it('se o modo simples também falhar, o erro chega (sem loop)', async () => {
    const f = jest.fn().mockResolvedValue(resp(400, { type: 'error', error: { message: 'pedido inválido' } }));
    global.fetch = f as unknown as typeof fetch;
    await expect(new AnthropicProvider(cfg).conversar(entrada)).rejects.toBeInstanceOf(ErroProvedorIA);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('401 (chave inválida) NÃO é repetido: repetir só queima cota', async () => {
    const f = jest.fn().mockResolvedValue(resp(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    global.fetch = f as unknown as typeof fetch;
    const e = await new AnthropicProvider(cfg).conversar(entrada).catch((x) => x);
    expect(e).toBeInstanceOf(ErroProvedorIA);
    expect((e as ErroProvedorIA).causa).toBe('credencial');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
