import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';
import {
  causaPorStatus,
  ErroProvedorIA,
  type AIProvider,
  type EntradaGeracao,
  type PapelModelo,
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
 * Existe para provar que a abstração `AIProvider` é real: o domínio roda
 * igual com Anthropic ou com isto, sem uma linha alterada. Não é o caminho
 * padrão do produto — o padrão segue sendo Anthropic.
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

  async generate(input: EntradaGeracao): Promise<RespostaIA> {
    if (!this.configured()) {
      throw new ErroProvedorIA('OPENAI_API_KEY ausente', 'credencial', this.nome);
    }

    const modelo = this.modeloPara(input.papel);

    const corpo: Record<string, unknown> = {
      model: modelo,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperatura ?? 0.3,
      // O dialeto OpenAI trata o system prompt como a primeira mensagem.
      messages: [{ role: 'system', content: input.system }, ...input.mensagens.map(paraMensagemOpenAI)],
    };

    if (input.tools?.length) {
      corpo.tools = input.tools.map(paraToolOpenAI);
      corpo.tool_choice = 'auto';
    }

    const res = await this.circuito.run(async () => {
      const r = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(corpo),
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

    return {
      texto: (escolha?.message?.content ?? '').trim(),
      toolCalls,
      pararPor: normalizarParada(escolha?.finish_reason),
      modelo: j.model ?? modelo,
      provedor: this.nome,
      uso: { entrada, saida, cache, custoUsd: this.custo(j.model ?? modelo, entrada, saida, cache) },
    };
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

/* ------------------------------------------------------------------ */
/* Tradução entre o formato neutro e o dialeto OpenAI                  */
/* ------------------------------------------------------------------ */

function paraMensagemOpenAI(m: { role: string; content: unknown }): Record<string, unknown> {
  return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
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
