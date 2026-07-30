import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';

/**
 * Modelos (consultados na skill `claude-api`, conforme CLAUDE.md).
 * - Roteador: classificar intenção é tarefa curta e barata → **Haiku**.
 * - Agentes: raciocínio + tools + compliance → **Sonnet**.
 * Trocar aqui é mudar custo e qualidade do produto inteiro: sempre com número.
 */
export const MODELO_ROTEADOR = 'claude-haiku-4-5-20251001';
export const MODELO_AGENTE = 'claude-sonnet-5';

/** USD por 1M tokens. Fonte: tabela pública da Anthropic. */
const PRECO: Record<string, { entrada: number; saida: number; cache: number }> = {
  'claude-haiku-4-5-20251001': { entrada: 1, saida: 5, cache: 0.1 },
  'claude-sonnet-5': { entrada: 3, saida: 15, cache: 0.3 },
};

export interface MensagemLLM {
  role: 'user' | 'assistant';
  content: unknown;
}
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface RespostaLLM {
  texto: string;
  toolCalls: { id: string; nome: string; args: Record<string, unknown> }[];
  pararPor: string;
  uso: { entrada: number; saida: number; cache: number; custoUsd: number };
  modelo: string;
}

/**
 * Cliente da API da Anthropic (Brief §2 — gating por credencial).
 * Sem `ANTHROPIC_API_KEY`, `configured()` é false e o módulo inteiro da Nyro
 * responde 501 `config_required` — nunca resposta falsa nem simulada.
 */
@Injectable()
export class AnthropicProvider {
  private readonly log = new Logger('Nyro');
  private readonly endpoint = 'https://api.anthropic.com/v1/messages';
  // Circuito por instância: 5 falhas seguidas → fail-fast por 30s (não martela a
  // Anthropic caída nem prende a latência de todos os tenants).
  private readonly circuito = new CircuitBreaker({ nome: 'Anthropic', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('anthropic');
  }
  missing(): string[] {
    return this.config.missingVars('anthropic');
  }
  exigirCredencial(): void {
    this.config.require('anthropic');
  }

  async conversar(input: {
    modelo: string;
    system: string;
    mensagens: MensagemLLM[];
    tools?: ToolDef[];
    maxTokens?: number;
    temperatura?: number;
  }): Promise<RespostaLLM> {
    this.exigirCredencial();
    const chave = this.config.get('ANTHROPIC_API_KEY')!;

    const corpo: Record<string, unknown> = {
      model: input.modelo,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperatura ?? 0.3,
      system: input.system,
      messages: input.mensagens,
    };
    if (input.tools?.length) corpo.tools = input.tools;

    const res = await this.circuito.run(async () => {
      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': chave,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(corpo),
      });
      // Só erro de rede ou 5xx conta pro circuito (serviço caído). 4xx é problema
      // da requisição — não deve abrir o circuito de todo mundo.
      if (r.status >= 500) throw new Error(`Anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      return r;
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 300);
      // 429/4xx: quem chama decide retry (o worker tem backoff)
      throw new Error(`Anthropic ${res.status}: ${detalhe}`);
    }

    const j = (await res.json()) as {
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
      model: string;
    };

    const texto = j.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
    const toolCalls = j.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id!, nome: c.name!, args: (c.input ?? {}) as Record<string, unknown> }));

    const entrada = j.usage.input_tokens ?? 0;
    const saida = j.usage.output_tokens ?? 0;
    const cache = j.usage.cache_read_input_tokens ?? 0;

    return {
      texto,
      toolCalls,
      pararPor: j.stop_reason,
      modelo: j.model ?? input.modelo,
      uso: { entrada, saida, cache, custoUsd: this.custo(input.modelo, entrada, saida, cache) },
    };
  }

  /** Custo em USD. Modelo desconhecido → 0 com aviso (nunca inventa preço). */
  private custo(modelo: string, entrada: number, saida: number, cache: number): number {
    const p = PRECO[modelo];
    if (!p) {
      this.log.warn(`sem tabela de preço para ${modelo}: custo será registrado como 0`);
      return 0;
    }
    return (entrada * p.entrada + saida * p.saida + cache * p.cache) / 1_000_000;
  }
}
