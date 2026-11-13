import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { consumirNdjsonOllama, consumirSseAnthropic, type RespostaAnthropicStream, type RespostaOllamaStream } from './stream-parsers';
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
 * Modelos (consultados na skill `claude-api`, conforme CLAUDE.md).
 * - Roteador: classificar intenção é tarefa curta e barata → **Haiku**.
 * - Agentes: raciocínio + tools + compliance → **Sonnet**.
 * Trocar aqui é mudar custo e qualidade do produto inteiro: sempre com número.
 */
export const MODELO_ROTEADOR = 'claude-haiku-4-5-20251001';
export const MODELO_AGENTE = 'claude-sonnet-5';

/**
 * USD por 1M tokens. Fonte: tabela pública da Anthropic, via skill `claude-api`
 * (cache de 2026-10-06). `cache: null` = preço de leitura de cache não
 * publicado na fonte: cobra como entrada (superestima, nunca subestima).
 */
const PRECO: Record<string, { entrada: number; saida: number; cache: number | null }> = {
  'claude-haiku-4-5-20251001': { entrada: 1, saida: 5, cache: 0.1 },
  'claude-sonnet-5': { entrada: 3, saida: 15, cache: 0.3 },
  'claude-opus-5-5': { entrada: 4, saida: 20, cache: 0.2 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cache: 0.2 },
  // Haiku 5.5: preço até 100K tokens de prompt ($0.50/$2.50 acima — não se
  // aplica a conversa de atendimento).
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cache: null },
};

/**
 * Modelos que RECUSAM parâmetros de amostragem (`temperature`/`top_p`/`top_k`)
 * com 400 — geração 5.x e Opus 4.7/4.8 (skill `claude-api`). Para eles a
 * profundidade se controla por `effort`, não por temperatura.
 */
const SEM_AMOSTRAGEM = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5', 'claude-fable-5', 'claude-opus-4-7', 'claude-opus-4-8'];
export function aceitaTemperatura(modelo: string): boolean {
  return !SEM_AMOSTRAGEM.some((prefixo) => modelo.startsWith(prefixo));
}

/** Modelos com `output_config.effort` (Haiku 4.5 recusa o parâmetro). */
export function aceitaEffort(modelo: string): boolean {
  return !modelo.startsWith('claude-haiku-4-5');
}

const ORDEM_EFFORT = ['low', 'medium', 'high'] as const;
type Effort = (typeof ORDEM_EFFORT)[number];

/**
 * Política de custo da operação (deploy com crédito limitado):
 *  - `ANTHROPIC_MODEL_FORCE`: TODA chamada à Anthropic usa este modelo, seja
 *    qual for o pedido (agentes, NICO, sugestões). Ex.: `claude-haiku-5-5`.
 *  - `ANTHROPIC_EFFORT_MAX`: teto de esforço de raciocínio (cobrado como saída).
 *    Sem effort pedido, aplica o teto, porque o Haiku 5.5 usa `medium` por padrão.
 * Sem as variáveis, nada muda (comportamento anterior).
 */
export function aplicarPoliticaDeCusto(
  modelo: string,
  effort: Effort | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { modelo: string; effort: Effort | undefined } {
  const forcado = (env.ANTHROPIC_MODEL_FORCE || '').trim();
  const modeloFinal = /^claude-[a-z0-9-]+$/.test(forcado) ? forcado : modelo;
  const teto = (env.ANTHROPIC_EFFORT_MAX || '').trim() as Effort;
  if (!ORDEM_EFFORT.includes(teto)) return { modelo: modeloFinal, effort };
  const pedido = effort ?? teto;
  const effortFinal = ORDEM_EFFORT.indexOf(pedido) > ORDEM_EFFORT.indexOf(teto) ? teto : pedido;
  return { modelo: modeloFinal, effort: effortFinal };
}

/**
 * Fallback de recusa no servidor (`fallbacks: "default"`): suportado no Opus
 * 5.5 e no Sonnet 5.5 pela Claude API. Numa recusa, a própria API reexecuta
 * no modelo de fallback dentro da mesma chamada.
 */
const COM_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

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
  /**
   * Conteúdo BRUTO da resposta (texto, tool_use, thinking, fallback…). No loop
   * de tools ele volta INTACTO como turno do assistente: nos modelos 5.x o
   * raciocínio fica ligado, e descartar os blocos de thinking conta como
   * edição de histórico (a API pode recusar com 400).
   */
  blocos: unknown[];
}

/**
 * Cliente da API da Anthropic (Brief §2 — gating por credencial).
 * Sem `ANTHROPIC_API_KEY`, `configured()` é false e o módulo inteiro da Nyro
 * responde 501 `config_required` — nunca resposta falsa nem simulada.
 */
@Injectable()
export class AnthropicProvider implements AIProvider {
  readonly nome = 'anthropic';

  private readonly log = new Logger('Nyro');
  private readonly endpoint: string;
  // Circuito por instância: 5 falhas seguidas → fail-fast por 30s (não martela a
  // Anthropic caída nem prende a latência de todos os tenants).
  private readonly circuito = new CircuitBreaker({ nome: 'Anthropic', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {
    // ANTHROPIC_BASE_URL (convenção dos SDKs): gateway corporativo ou, no stack
    // de QA, o servidor de teste roteirizado. Em produção só https.
    const base = (config.get('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/+$/, '');
    if (process.env.NODE_ENV === 'production' && !base.startsWith('https://')) throw new Error('ANTHROPIC_BASE_URL precisa ser https em produção');
    this.endpoint = `${base}/v1/messages`;
  }

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
    /**
     * Parte do system que muda a cada turno (data, memória). Vai DEPOIS do bloco
     * estável: o prefixo `system`+tools fica no cache de prompt da Anthropic.
     */
    systemDinamico?: string;
    /** Recebe cada trecho de texto assim que o modelo o produz (streaming real). */
    onTexto?: (delta: string) => void;
    mensagens: MensagemLLM[];
    tools?: ToolDef[];
    maxTokens?: number;
    temperatura?: number;
    /** Profundidade de raciocínio nos modelos que aceitam (`low` para chat). */
    effort?: 'low' | 'medium' | 'high';
    /** Liga o fallback de recusa no servidor quando o modelo suporta. */
    fallbackRecusa?: boolean;
    /**
     * Structured outputs (`output_config.format`, skill claude-api): a resposta
     * de texto obedece a este JSON Schema. Substitui o `tool_choice` forçado,
     * que Opus 5.5/Sonnet 5.5 recusam com 400. Compatível com thinking.
     */
    jsonSchema?: Record<string, unknown>;
    /** Timeout da chamada HTTP (ms). Sem valor = sem limite próprio. */
    timeoutMs?: number;
    /**
     * 'anthropic' ignora AI_PROVIDER e vai direto à API da Anthropic (sem
     * ANTHROPIC_API_KEY, degrada como sempre: `exigirCredencial`). Usado por
     * quem precisa do Claude mesmo com o backend local ligado (ex.: NICO via
     * NICO_PROVEDOR). Omitido/'padrao' = segue AI_PROVIDER.
     */
    provedor?: 'anthropic' | 'padrao';
  }): Promise<RespostaLLM> {
    // Backend Ollama (local hoje, servidor remoto amanhã): AI_PROVIDER=ollama
    // (ou o alias legado "openai") desvia TUDO que consome `conversar` (Nyro +
    // agentes) para OLLAMA_BASE_URL, sem mudar uma linha dos consumidores. O
    // contrato de entrada/saída (blocos Anthropic) é preservado pela tradução.
    const backend = (process.env.AI_PROVIDER || '').toLowerCase().trim();
    if (input.provedor !== 'anthropic' && (backend === 'ollama' || backend === 'openai')) {
      return this.conversarOllama(input);
    }
    this.exigirCredencial();
    const chave = this.config.get('ANTHROPIC_API_KEY')!;
    // Política de custo do deploy (modelo forçado e teto de esforço).
    const politica = aplicarPoliticaDeCusto(input.modelo, input.effort);
    input = { ...input, modelo: politica.modelo, effort: politica.effort };

    const corpo: Record<string, unknown> = {
      model: input.modelo,
      max_tokens: input.maxTokens ?? 2048,
      // Cache de prompt: o bloco estável (persona, regras) e as tools são o grosso
      // do prompt e idênticos a cada volta do loop; só a parte dinâmica muda.
      system: input.systemDinamico
        ? [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }, { type: 'text', text: input.systemDinamico }]
        : input.system,
      messages: input.mensagens,
    };
    if (input.onTexto) corpo.stream = true;
    // Mandar temperatura para quem não aceita é 400 garantido (BUG-017).
    if (aceitaTemperatura(input.modelo)) corpo.temperature = input.temperatura ?? 0.3;
    const outputConfig: Record<string, unknown> = {};
    if (input.effort && aceitaEffort(input.modelo)) outputConfig.effort = input.effort;
    if (input.jsonSchema) outputConfig.format = { type: 'json_schema', schema: input.jsonSchema };
    if (Object.keys(outputConfig).length) corpo.output_config = outputConfig;
    if (input.tools?.length) corpo.tools = input.tools.map((t, i, todas) => (i === todas.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
    };
    if (input.fallbackRecusa && COM_FALLBACK.has(input.modelo)) {
      corpo.fallbacks = 'default';
      headers['anthropic-beta'] = BETA_FALLBACK;
    }

    const res = await this.circuito.run(async () => {
      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(corpo),
        ...(input.timeoutMs ? { signal: AbortSignal.timeout(input.timeoutMs) } : {}),
      });
      // Só erro de rede ou 5xx conta pro circuito (serviço caído). 4xx é problema
      // da requisição — não deve abrir o circuito de todo mundo.
      if (r.status >= 500) throw new Error(`Anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      return r;
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 300);
      // Causa classificada: o chamador distingue o que vale retry (429/5xx) do
      // que não vale (401/400) — retentar credencial inválida só queima cota.
      throw new ErroProvedorIA(
        `Anthropic ${res.status}: ${detalhe}`,
        causaPorStatus(res.status),
        this.nome,
        res.status,
      );
    }

    const j: RespostaAnthropicStream = input.onTexto && res.body
      ? await consumirSseAnthropic(res.body, input.onTexto)
      : ((await res.json()) as RespostaAnthropicStream);

    const texto = j.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
    const toolCalls = j.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id!, nome: c.name!, args: (c.input ?? {}) as Record<string, unknown> }));

    const entrada = j.usage.input_tokens ?? 0;
    const saida = j.usage.output_tokens ?? 0;
    const cache = (j.usage.cache_read_input_tokens ?? 0);

    // Com fallback, quem atendeu pode ser outro modelo: o custo segue `j.model`.
    const modelo = j.model ?? input.modelo;
    return {
      texto,
      toolCalls,
      pararPor: j.stop_reason,
      modelo,
      uso: { entrada, saida, cache, custoUsd: this.custo(modelo, entrada, saida, cache) },
      blocos: j.content,
    };
  }


  /* ---------------- Contrato AIProvider ---------------- */

  /**
   * Papel → id de modelo. O domínio pede "raciocínio"; o mapeamento para
   * `claude-sonnet-5` mora aqui e em nenhum outro lugar.
   */
  modeloPara(papel: PapelModelo): string {
    return papel === 'roteador' ? MODELO_ROTEADOR : MODELO_AGENTE;
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

  /** Custo em USD. Modelo desconhecido → 0 com aviso (nunca inventa preço). */
  private custo(modelo: string, entrada: number, saida: number, cache: number): number {
    const p = PRECO[modelo];
    if (!p) {
      this.log.warn(`sem tabela de preço para ${modelo}: custo será registrado como 0`);
      return 0;
    }
    return (entrada * p.entrada + saida * p.saida + cache * (p.cache ?? p.entrada)) / 1_000_000;
  }

  /* ---------------- Backend Ollama (API nativa /api/chat) ---------------- */

  /**
   * Traduz o contrato Anthropic (`conversar`) para a API NATIVA do Ollama e a
   * resposta de volta para `RespostaLLM` (blocos no formato Anthropic). Assim
   * o loop de tools da Nyro e dos agentes roda INTACTO — inclusive o
   * histórico com tool_use/tool_result.
   *
   * Por que a API nativa e não o endpoint OpenAI-compatível (`/v1`):
   * modelos "thinking" (qwen3.5) só aceitam desligar o raciocínio pela API
   * nativa (`think: false`). No /v1 o flag é ignorado: medido 168s → 8s na
   * mesma pergunta, e o reasoning comia o teto de tokens (resposta vazia).
   *
   * Custo registra 0: modelo local/próprio não tem preço por token (nunca
   * inventar preço).
   */
  async conversarOllama(input: Parameters<AnthropicProvider['conversar']>[0]): Promise<RespostaLLM> {
    const base = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const modelo = input.modelo === MODELO_ROTEADOR || input.modelo === process.env.OLLAMA_MODEL_ROTEADOR || input.modelo === process.env.OPENAI_MODEL_ROTEADOR
      ? process.env.OLLAMA_MODEL_ROTEADOR || process.env.OPENAI_MODEL_ROTEADOR || 'qwen3.5:4b'
      : process.env.OLLAMA_MODEL_AGENTE || process.env.OPENAI_MODEL_AGENTE || 'qwen3.5:9b';

    // 1ª passagem: id do tool_use → nome (o Ollama nativo casa resultado de
    // tool por NOME, não por tool_call_id).
    const nomeDaTool = new Map<string, string>();
    for (const m of input.mensagens) {
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as { type?: string; id?: string; name?: string }[]) {
        if (b.type === 'tool_use' && b.id && b.name) nomeDaTool.set(b.id, b.name);
      }
    }

    const mensagens: Record<string, unknown>[] = [{ role: 'system', content: input.systemDinamico ? `${input.system}\n\n${input.systemDinamico}` : input.system }];
    for (const m of input.mensagens) {
      if (typeof m.content === 'string') { mensagens.push({ role: m.role, content: m.content }); continue; }
      if (!Array.isArray(m.content)) { mensagens.push({ role: m.role, content: JSON.stringify(m.content) }); continue; }
      const blocos = m.content as { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown }[];
      if (m.role === 'assistant') {
        const texto = blocos.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
        const calls = blocos.filter((b) => b.type === 'tool_use');
        mensagens.push({
          role: 'assistant',
          content: texto,
          ...(calls.length
            ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: (c.input ?? {}) as Record<string, unknown> } })) }
            : {}),
        });
      } else {
        for (const r of blocos.filter((b) => b.type === 'tool_result')) {
          mensagens.push({
            role: 'tool',
            name: nomeDaTool.get(r.tool_use_id ?? '') ?? 'tool',
            content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          });
        }
        const texto = blocos.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
        // Visão: bloco `image` (base64, formato Anthropic) → `images` do Ollama.
        const imagens = (blocos as { type?: string; source?: { type?: string; data?: string } }[])
          .filter((b) => b.type === 'image' && b.source?.type === 'base64' && b.source.data)
          .map((b) => b.source!.data as string);
        if (texto || imagens.length) mensagens.push({ role: 'user', content: texto, ...(imagens.length ? { images: imagens } : {}) });
      }
    }

    const corpo: Record<string, unknown> = {
      model: modelo,
      think: false,
      stream: !!input.onTexto,
      // Sem `keep_alive` o Ollama descarrega o modelo após 5 min ocioso e o
      // próximo cliente paga 10–30 s de recarga.
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '60m',
      messages: mensagens,
      options: {
        // Sem `num_ctx` o Ollama usa a janela padrão (4096) e CORTA O INÍCIO do
        // prompt quando ele passa disso — some o system prompt (identidade,
        // tabela de preços, regras) e o agente responde genérico/errado.
        // Medido: prompt do agente de atendimento ≈ 4–7k tokens.
        num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 16384,
        num_predict: Math.max(input.maxTokens ?? 2048, 4096),
        temperature: input.temperatura ?? 0.3,
      },
    };
    if (input.tools?.length) {
      corpo.tools = input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    }
    if (input.jsonSchema) corpo.format = input.jsonSchema;

    const res = await this.circuito.run(async () => {
      const r = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(input.timeoutMs ?? 300_000),
      });
      if (r.status >= 500) throw new Error(`Ollama ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      return r;
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 300);
      throw new ErroProvedorIA(`Ollama ${res.status}: ${detalhe}`, causaPorStatus(res.status), 'ollama', res.status);
    }

    const j: RespostaOllamaStream | { model?: string; done_reason?: string; message?: RespostaOllamaStream['message']; prompt_eval_count?: number; eval_count?: number } =
      input.onTexto && res.body ? await consumirNdjsonOllama(res.body, input.onTexto) : ((await res.json()) as { model?: string; done_reason?: string; message?: RespostaOllamaStream['message']; prompt_eval_count?: number; eval_count?: number });
    const msg = j.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((t, i) => {
      let args: Record<string, unknown> = {};
      const bruto = t.function.arguments;
      if (typeof bruto === 'string') {
        try {
          const v: unknown = JSON.parse(bruto);
          if (v && typeof v === 'object') args = v as Record<string, unknown>;
        } catch {
          this.log.warn(`tool ${t.function.name}: argumentos com JSON inválido; tratando como vazio`);
        }
      } else if (bruto && typeof bruto === 'object') {
        args = bruto;
      }
      return { id: `ollama-${Date.now()}-${i}`, nome: t.function.name, args };
    });
    const texto = (msg.content ?? '').trim();
    const pararPor = toolCalls.length ? 'tool_use' : j.done_reason === 'length' ? 'max_tokens' : 'end_turn';

    return {
      texto,
      toolCalls,
      pararPor,
      modelo: j.model ?? modelo,
      uso: { entrada: j.prompt_eval_count ?? 0, saida: j.eval_count ?? 0, cache: 0, custoUsd: 0 },
      // Blocos no formato Anthropic: o consumidor devolve isto INTACTO no
      // histórico do próximo turno, e a tradução acima entende esse formato.
      blocos: [
        ...(texto ? [{ type: 'text', text: texto }] : []),
        ...toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.nome, input: c.args })),
      ],
    };
  }
}
