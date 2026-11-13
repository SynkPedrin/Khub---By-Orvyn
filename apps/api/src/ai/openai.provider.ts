import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';
import {
  causaPorStatus,
  ErroProvedorIA,
  type AIProvider,
  type EntradaConversa,
  type EntradaGeracao,
  type ModeloCatalogo,
  type PapelModelo,
  type RespostaConversa,
  type RespostaIA,
  type ToolIA,
} from './provider.contract';

/**
 * Adaptador para APIs no formato OpenAI Chat Completions.
 *
 * Atende **dois** provedores com o mesmo código, porque ambos falam o mesmo
 * dialeto — muda só a base URL:
 *   - OpenAI:  https://api.openai.com/v1
 *   - Ollama:  http://localhost:11434/v1  (modelos locais, sem custo por token)
 *
 * Além do contrato `AIProvider` (`generate`/`toolCall`), implementa
 * `conversar` (multi-turno com tools) e `modelosDisponiveis`: com
 * `AI_PROVIDER=openai`, o criador de agentes inteiro roda neste adapter.
 *
 * Env:
 *   OPENAI_API_KEY   obrigatório (Ollama aceita qualquer valor, ex.: "ollama")
 *   OPENAI_BASE_URL  opcional  (default: https://api.openai.com/v1)
 *   OPENAI_MODEL_AGENTE / OPENAI_MODEL_ROTEADOR  opcionais
 */
@Injectable()
export class OpenAiProvider implements AIProvider {
  readonly nome = 'openai';

  private readonly log = new Logger('OpenAiProvider');
  private readonly circuito = new CircuitBreaker({ nome: 'OpenAI', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  configured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  missing(): string[] {
    return this.configured() ? [] : ['OPENAI_API_KEY'];
  }

  modeloPara(papel: PapelModelo): string {
    return papel === 'roteador'
      ? process.env.OPENAI_MODEL_ROTEADOR || 'gpt-4o-mini'
      : process.env.OPENAI_MODEL_AGENTE || 'gpt-4o';
  }

  /**
   * Modelo efetivo para uma conversa. Ids de outro fornecedor (ex.: agentes
   * criados com `claude-*` antes da troca para Ollama) caem no modelo padrão
   * configurado — pedir um id que o servidor local não tem seria 400/404
   * garantido em toda mensagem.
   */
  private resolverModelo(modelo: string): string {
    if (!modelo || modelo.startsWith('claude')) {
      const padrao = this.modeloPara('agente');
      if (modelo) this.log.warn(`modelo "${modelo}" não existe neste provedor; usando ${padrao}`);
      return padrao;
    }
    return modelo;
  }

  async conversar(input: EntradaConversa): Promise<RespostaConversa> {
    if (!this.configured()) {
      throw new ErroProvedorIA('OPENAI_API_KEY ausente', 'credencial', this.nome);
    }

    const modelo = this.resolverModelo(input.modelo);

    const corpo: Record<string, unknown> = {
      model: modelo,
      // Modelos locais com "thinking" (qwen, etc.) consomem o raciocínio
      // DENTRO do teto de tokens: tetos baixos (ex.: 400) voltam com texto
      // vazio. Token local é grátis — o piso garante resposta sem mudar o
      // comportamento para APIs pagas.
      max_tokens: this.ehLocal() ? Math.max(input.maxTokens ?? 2048, 2000) : input.maxTokens ?? 2048,
      temperature: input.temperatura ?? 0.3,
      // O dialeto OpenAI trata o system prompt como a primeira mensagem.
      messages: [{ role: 'system', content: input.system }, ...input.mensagens.flatMap(paraMensagensOpenAI)],
    };

    if (input.tools?.length) {
      corpo.tools = input.tools.map(paraToolOpenAI);
      corpo.tool_choice = 'auto';
    }
    if (input.jsonSchema) {
      corpo.response_format = { type: 'json_schema', json_schema: { name: 'saida', schema: input.jsonSchema } };
    }

    const res = await this.circuito.run(async () => {
      const r = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(corpo),
        ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
      });
      // Só 5xx abre o circuito: 4xx é problema da requisição, não do serviço.
      if (r.status >= 500) {
        throw new Error(`OpenAI ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      }
      return r;
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 300);
      throw new ErroProvedorIA(`OpenAI ${res.status}: ${detalhe}`, causaPorStatus(res.status), this.nome, res.status);
    }

    const j = (await res.json()) as RespostaBrutaOpenAI;
    const escolha = j.choices?.[0];

    const toolCalls =
      escolha?.message?.tool_calls?.map((t) => ({
        id: t.id,
        nome: t.function.name,
        args: parseArgs(t.function.arguments, this.log),
      })) ?? [];

    const entrada = j.usage?.prompt_tokens ?? 0;
    const saida = j.usage?.completion_tokens ?? 0;
    const cache = j.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const modeloUsado = j.model ?? modelo;

    // Blocos no formato neutro (Anthropic-like): o loop de tools do domínio
    // devolve isto intacto como turno do assistente, e o tradutor acima
    // reconhece esse formato na próxima volta.
    const blocos: unknown[] = [];
    const texto = (escolha?.message?.content ?? '').trim();
    if (texto) blocos.push({ type: 'text', text: texto });
    for (const t of toolCalls) blocos.push({ type: 'tool_use', id: t.id, name: t.nome, input: t.args });

    return {
      texto,
      toolCalls,
      pararPor: normalizarParada(escolha?.finish_reason),
      modelo: modeloUsado,
      uso: { entrada, saida, cache, custoUsd: this.custo(modeloUsado, entrada, saida, cache) },
      blocos,
    };
  }

  /**
   * Modelos selecionáveis no criador de agentes. Com base URL local (Ollama),
   * lista o que está instalado de verdade (`/api/tags`); sem isso, devolve os
   * modelos OpenAI padrão. Local = sem custo por token: preço 0, nunca
   * inventado.
   */
  async modelosDisponiveis(): Promise<ModeloCatalogo[]> {
    if (!this.ehLocal()) return MODELOS_OPENAI;

    try {
      const origem = this.baseUrl.replace(/\/v1\/?$/, '');
      const r = await fetch(`${origem}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (!r.ok) throw new Error(`Ollama /api/tags ${r.status}`);
      const j = (await r.json()) as { models?: { name: string }[] };
      const instalados = (j.models ?? []).map((m) => m.name).filter(Boolean);
      if (!instalados.length) throw new Error('Ollama sem modelos instalados');
      return instalados.map((id) => ({
        id,
        nome: id,
        descricao: 'Modelo local via Ollama — sem custo por token.',
        entradaUsdPorMilhao: 0,
        saidaUsdPorMilhao: 0,
      }));
    } catch (e) {
      this.log.warn(`não foi possível listar modelos do Ollama: ${(e as Error).message}; usando env`);
      const id = this.modeloPara('agente');
      return [{ id, nome: id, descricao: 'Modelo local via Ollama (configurado por env) — sem custo por token.', entradaUsdPorMilhao: 0, saidaUsdPorMilhao: 0 }];
    }
  }

  private ehLocal(): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(this.baseUrl);
  }

  async generate(input: EntradaGeracao): Promise<RespostaIA> {
    const r = await this.conversar({
      modelo: this.modeloPara(input.papel),
      system: input.system,
      mensagens: input.mensagens,
      tools: input.tools,
      maxTokens: input.maxTokens,
      temperatura: input.temperatura,
    });
    return { ...r, provedor: this.nome };
  }

  toolCall(input: EntradaGeracao & { tools: ToolIA[] }): Promise<RespostaIA> {
    return this.generate(input);
  }

  /**
   * USD por 1M tokens. Modelo fora da tabela (inclusive qualquer coisa servida
   * por Ollama, que é local e gratuito) registra 0 — nunca inventa preço.
   */
  private custo(modelo: string, entrada: number, saida: number, cache: number): number {
    const p = PRECO[modelo];
    if (!p) return 0;
    return (entrada * p.entrada + saida * p.saida + cache * p.cache) / 1_000_000;
  }
}

const PRECO: Record<string, { entrada: number; saida: number; cache: number }> = {
  'gpt-4o': { entrada: 2.5, saida: 10, cache: 1.25 },
  'gpt-4o-mini': { entrada: 0.15, saida: 0.6, cache: 0.075 },
};

const MODELOS_OPENAI: ModeloCatalogo[] = [
  { id: 'gpt-4o', nome: 'GPT-4o', descricao: 'O mais capaz da OpenAI. Para venda consultiva e casos que exigem julgamento.', entradaUsdPorMilhao: 2.5, saidaUsdPorMilhao: 10 },
  { id: 'gpt-4o-mini', nome: 'GPT-4o mini', descricao: 'Rápido e econômico. Para triagem e perguntas frequentes.', entradaUsdPorMilhao: 0.15, saidaUsdPorMilhao: 0.6 },
];

/* ------------------------------------------------------------------ */
/* Tradução entre o formato neutro e o dialeto OpenAI                  */
/* ------------------------------------------------------------------ */

interface BlocoNeutro {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

/**
 * Uma mensagem neutra pode virar VÁRIAS mensagens OpenAI (cada `tool_result`
 * vira uma mensagem `role: 'tool'` própria). Por isso o tradutor devolve um
 * array e quem chama usa `flatMap`.
 *
 * Formatos reconhecidos no `content`:
 * - string → repassada como está;
 * - turno do assistente com blocos neutros (text + tool_use) → mensagem
 *   `assistant` com `tool_calls`;
 * - turno `user` com blocos `tool_result` → uma mensagem `tool` por bloco.
 */
function paraMensagensOpenAI(m: { role: string; content: unknown }): Record<string, unknown>[] {
  if (typeof m.content === 'string' || !Array.isArray(m.content)) {
    return [{ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }];
  }

  const blocos = m.content as BlocoNeutro[];
  const resultadosTool = blocos.filter((b) => b?.type === 'tool_result');
  if (resultadosTool.length) {
    return resultadosTool.map((b) => ({
      role: 'tool',
      tool_call_id: b.tool_use_id,
      content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''),
    }));
  }

  if (m.role === 'assistant') {
    const texto = blocos.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n');
    const toolCalls = blocos
      .filter((b) => b?.type === 'tool_use')
      .map((b, i) => ({
        id: b.id ?? `call_${i}`,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
    return [{ role: 'assistant', content: texto || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }];
  }

  const texto = blocos.map((b) => b?.text ?? '').filter(Boolean).join('\n');
  return [{ role: m.role, content: texto }];
}

function paraToolOpenAI(t: ToolIA): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  };
}

/** Normaliza o motivo de parada para o vocabulário usado pelo domínio. */
function normalizarParada(motivo: string | undefined): string {
  if (motivo === 'tool_calls') return 'tool_use';
  if (motivo === 'length') return 'max_tokens';
  if (motivo === 'stop') return 'end_turn';
  return motivo ?? 'desconhecido';
}

/**
 * Argumentos de tool chegam como string JSON e o modelo pode produzir JSON
 * inválido. Nesse caso devolvemos `{}` — o executor de tools valida com Zod e
 * recusa; melhor recusar do que deixar a exceção subir e derrubar o turno.
 */
function parseArgs(bruto: string, log: Logger): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(bruto);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    log.warn('argumentos de tool com JSON inválido; tratando como vazio');
    return {};
  }
}

interface RespostaBrutaOpenAI {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
