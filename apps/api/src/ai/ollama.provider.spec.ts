import { OllamaProvider } from './ollama.provider';
import { AnthropicProvider } from './anthropic.provider';
import { ConfigService } from '../config/config.service';
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });
it('Ollama usa API nativa, think false e schema estruturado sem chave externa', async () => {
  process.env.NODE_ENV = 'test';
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
  process.env.OLLAMA_MODEL_ROTEADOR = 'qwen3.5:4b';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ model: 'qwen3.5:4b', message: { content: '{"ok":true}' }, done_reason: 'stop' }), { status: 200 }));
  const p = new OllamaProvider(new AnthropicProvider(new ConfigService()));
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  expect(p.configured()).toBe(true);
  const result = await p.conversar({ modelo: p.modeloPara('roteador'), system: 'Classifique', mensagens: [{ role: 'user', content: 'oi' }], jsonSchema: schema });
  expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ model: 'qwen3.5:4b', think: false, format: schema });
  expect(result.texto).toBe('{"ok":true}');
  expect(result.uso.custoUsd).toBe(0);
});
it('sem endereço de Ollama recusa configuração, sem cair para fornecedor pago', async () => {
  delete process.env.OLLAMA_BASE_URL;
  const p = new OllamaProvider({} as AnthropicProvider);
  expect(p.configured()).toBe(false);
  await expect(p.conversar({ modelo: 'qwen', system: '', mensagens: [] })).rejects.toThrow('OLLAMA_BASE_URL');
});
