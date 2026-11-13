import { consumirNdjsonOllama, consumirSseAnthropic, linhasDe } from './stream-parsers';

/** Corpo de resposta que entrega o texto em pedaços de `n` bytes (corta no meio de linha/UTF-8, como a rede faz). */
function corpo(texto: string, n = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(texto);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + n));
      i += n;
    },
  });
}
const sse = (...evs: object[]) => evs.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');

describe('stream SSE da Anthropic', () => {
  const fixture = sse(
    { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 100 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pensando…' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Olá, ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'João 👋' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'resumo_do_funil', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"dias":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '7}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  );

  it('monta texto, tool_use e thinking (com assinatura) e avisa cada trecho de texto', async () => {
    const deltas: string[] = [];
    const r = await consumirSseAnthropic(corpo(fixture), (d) => deltas.push(d));
    expect(deltas).toEqual(['Olá, ', 'João 👋']);
    expect(r.content[0]).toMatchObject({ type: 'thinking', thinking: 'pensando…', signature: 'SIG' });
    expect(r.content[1]).toMatchObject({ type: 'text', text: 'Olá, João 👋' });
    expect(r.content[2]).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 'resumo_do_funil', input: { dias: 7 } });
    expect(r.stop_reason).toBe('tool_use');
    expect(r.model).toBe('claude-x');
    expect(r.usage).toMatchObject({ input_tokens: 120, output_tokens: 42, cache_read_input_tokens: 100 });
  });

  it('funciona com pedaços de 1 byte (UTF-8 cortado no meio)', async () => {
    const r = await consumirSseAnthropic(corpo(fixture, 1));
    expect(r.content[1].text).toBe('Olá, João 👋');
  });

  it('JSON de tool inválido vira {} (não derruba o turno) e erro do stream vira exceção', async () => {
    const ruim = sse(
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'x', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{quebrado' } },
      { type: 'content_block_stop', index: 0 },
    );
    expect((await consumirSseAnthropic(corpo(ruim))).content[0].input).toEqual({});
    await expect(consumirSseAnthropic(corpo(sse({ type: 'error', error: { type: 'overloaded_error', message: 'cheio' } })))).rejects.toThrow(/overloaded_error/);
  });
});

describe('stream NDJSON do Ollama', () => {
  const linhas = [
    { model: 'qwen', message: { content: 'Oi' } },
    { message: { content: ' tudo bem?' } },
    { message: { content: '', tool_calls: [{ function: { name: 'listar_rotinas', arguments: {} } }] } },
    { done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 },
  ].map((l) => JSON.stringify(l)).join('\n');

  it('junta o texto, as tool calls e o uso', async () => {
    const d: string[] = [];
    const r = await consumirNdjsonOllama(corpo(linhas), (x) => d.push(x));
    expect(d).toEqual(['Oi', ' tudo bem?']);
    expect(r.message.content).toBe('Oi tudo bem?');
    expect(r.message.tool_calls).toHaveLength(1);
    expect(r).toMatchObject({ model: 'qwen', done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 });
  });

  it('erro no meio do stream vira exceção', async () => {
    await expect(consumirNdjsonOllama(corpo(JSON.stringify({ error: 'modelo caiu' })))).rejects.toThrow(/modelo caiu/);
  });
});

it('linhasDe entrega a última linha mesmo sem \\n final', async () => {
  const out: string[] = [];
  for await (const l of linhasDe(corpo('a\nb\r\nc'))) out.push(l);
  expect(out).toEqual(['a', 'b', 'c']);
});
