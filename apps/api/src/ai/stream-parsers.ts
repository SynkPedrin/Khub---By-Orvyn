/**
 * Parsers de streaming (SSE da Anthropic, NDJSON do Ollama) — funções puras,
 * testadas com fixtures. Devolvem o MESMO formato do modo não-streaming, para
 * o loop de tools da NICO rodar intacto (inclusive blocos de thinking, que
 * precisam voltar INTACTOS no histórico).
 */

export interface BlocoAnthropic {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
  signature?: string;
  [k: string]: unknown;
}
export interface RespostaAnthropicStream {
  content: BlocoAnthropic[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model: string;
}

/** Lê um corpo de resposta como linhas, juntando pedaços que chegam cortados no meio. */
export async function* linhasDe(corpo: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = corpo.getReader();
  const dec = new TextDecoder();
  let resto = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resto += dec.decode(value, { stream: true });
      let i: number;
      while ((i = resto.indexOf('\n')) >= 0) {
        yield resto.slice(0, i).replace(/\r$/, '');
        resto = resto.slice(i + 1);
      }
    }
    resto += dec.decode();
    if (resto.trim()) yield resto.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

/** SSE da Messages API → resposta completa, chamando `onTexto` a cada trecho de texto. */
export async function consumirSseAnthropic(corpo: ReadableStream<Uint8Array>, onTexto?: (delta: string) => void): Promise<RespostaAnthropicStream> {
  const blocos: BlocoAnthropic[] = [];
  const jsonParcial = new Map<number, string>();
  const r: RespostaAnthropicStream = { content: blocos, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, model: '' };

  for await (const linha of linhasDe(corpo)) {
    if (!linha.startsWith('data:')) continue;
    const bruto = linha.slice(5).trim();
    if (!bruto || bruto === '[DONE]') continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(bruto) as Record<string, unknown>;
    } catch {
      continue;
    }
    const tipo = ev.type as string;
    if (tipo === 'message_start') {
      const m = ev.message as { model?: string; usage?: RespostaAnthropicStream['usage'] };
      r.model = m.model ?? '';
      r.usage = { ...r.usage, ...(m.usage ?? {}) };
    } else if (tipo === 'content_block_start') {
      const i = ev.index as number;
      const b = { ...(ev.content_block as BlocoAnthropic) };
      if (b.type === 'text') b.text = b.text ?? '';
      if (b.type === 'thinking') b.thinking = b.thinking ?? '';
      if (b.type === 'tool_use') jsonParcial.set(i, '');
      blocos[i] = b;
    } else if (tipo === 'content_block_delta') {
      const i = ev.index as number;
      const d = ev.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
      const b = blocos[i];
      if (!b) continue;
      if (d.type === 'text_delta' && d.text) {
        b.text = (b.text ?? '') + d.text;
        onTexto?.(d.text);
      } else if (d.type === 'input_json_delta') jsonParcial.set(i, (jsonParcial.get(i) ?? '') + (d.partial_json ?? ''));
      else if (d.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + (d.thinking ?? '');
      else if (d.type === 'signature_delta') b.signature = (b.signature ?? '') + (d.signature ?? '');
    } else if (tipo === 'content_block_stop') {
      const i = ev.index as number;
      const b = blocos[i];
      if (b?.type === 'tool_use') {
        const j = jsonParcial.get(i) ?? '';
        try {
          b.input = j.trim() ? (JSON.parse(j) as Record<string, unknown>) : {};
        } catch {
          b.input = {};
        }
      }
    } else if (tipo === 'message_delta') {
      const d = ev.delta as { stop_reason?: string };
      if (d.stop_reason) r.stop_reason = d.stop_reason;
      const u = ev.usage as Partial<RespostaAnthropicStream['usage']> | undefined;
      if (u) r.usage = { ...r.usage, ...u };
    } else if (tipo === 'error') {
      const e = ev.error as { type?: string; message?: string };
      throw new Error(`stream da Anthropic interrompido: ${e?.type ?? 'erro'} ${e?.message ?? ''}`.trim());
    }
  }
  r.content = blocos.filter(Boolean);
  return r;
}

export interface RespostaOllamaStream {
  model?: string;
  done_reason?: string;
  message: { content: string; tool_calls: { function: { name: string; arguments: Record<string, unknown> | string } }[] };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** NDJSON do `/api/chat` do Ollama → resposta completa, com `onTexto` a cada pedaço. */
export async function consumirNdjsonOllama(corpo: ReadableStream<Uint8Array>, onTexto?: (delta: string) => void): Promise<RespostaOllamaStream> {
  const r: RespostaOllamaStream = { message: { content: '', tool_calls: [] } };
  for await (const linha of linhasDe(corpo)) {
    if (!linha.trim()) continue;
    let j: { model?: string; done?: boolean; done_reason?: string; error?: string; message?: { content?: string; tool_calls?: RespostaOllamaStream['message']['tool_calls'] }; prompt_eval_count?: number; eval_count?: number };
    try {
      j = JSON.parse(linha);
    } catch {
      continue;
    }
    if (j.error) throw new Error(`stream do Ollama interrompido: ${j.error}`);
    if (j.model) r.model = j.model;
    const c = j.message?.content;
    if (c) {
      r.message.content += c;
      onTexto?.(c);
    }
    if (j.message?.tool_calls?.length) r.message.tool_calls.push(...j.message.tool_calls);
    if (j.done) {
      r.done_reason = j.done_reason;
      r.prompt_eval_count = j.prompt_eval_count;
      r.eval_count = j.eval_count;
    }
  }
  return r;
}
