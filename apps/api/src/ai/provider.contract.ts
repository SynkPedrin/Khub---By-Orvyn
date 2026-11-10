/**
 * CONTRATO DE PROVEDOR DE IA
 * ==========================
 *
 * O domínio da KHUB não pode depender de um fornecedor. Antes desta camada,
 * `AiService` e `NyroService` injetavam `AnthropicProvider` diretamente: trocar
 * de modelo, adicionar um provedor local ou reagir a uma indisponibilidade
 * exigiria mexer no núcleo do produto.
 *
 * Agora o núcleo conhece só esta interface. Quem implementa é detalhe de infra.
 *
 * Princípio: **papel, não modelo**. O domínio pede "o modelo de raciocínio",
 * não `claude-sonnet-5`. Cada provedor mapeia papéis para os próprios ids —
 * é o que permite rodar o mesmo fluxo em fornecedores diferentes.
 */

/**
 * Papéis de modelo. Deliberadamente poucos: mais papéis viram configuração
 * que ninguém mantém.
 *
 * - `roteador`: tarefa curta e barata (classificar intenção, extrair rótulo).
 * - `agente`: raciocínio + uso de tools + compliance.
 */
export type PapelModelo = 'roteador' | 'agente';

export interface MensagemIA {
  role: 'user' | 'assistant';
  content: unknown;
}

/** Definição de tool no formato neutro (cada adapter traduz para o seu). */
export interface ToolIA {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChamadaTool {
  id: string;
  nome: string;
  args: Record<string, unknown>;
}

export interface UsoIA {
  entrada: number;
  saida: number;
  cache: number;
  custoUsd: number;
}

export interface RespostaIA {
  texto: string;
  toolCalls: ChamadaTool[];
  /** Motivo da parada, normalizado entre provedores. */
  pararPor: string;
  uso: UsoIA;
  /** Id do modelo efetivamente usado — vai para o log de custo. */
  modelo: string;
  /** Nome do provedor que atendeu (`anthropic`, `openai`, …). */
  provedor: string;
}

export interface EntradaGeracao {
  papel: PapelModelo;
  system: string;
  mensagens: MensagemIA[];
  tools?: ToolIA[];
  maxTokens?: number;
  temperatura?: number;
}

/**
 * Interface que todo provedor de IA implementa.
 *
 * `configured()`/`missing()` fazem parte do contrato porque o produto **degrada
 * explicitamente** quando falta credencial (responde `config_required`), em vez
 * de devolver resposta simulada. Um provedor que não sabe dizer se está
 * configurado não serve.
 */
export interface AIProvider {
  /** Identificador estável, usado em logs e em `AiUsageEvent`. */
  readonly nome: string;

  configured(): boolean;
  missing(): string[];

  /** Id concreto do modelo para um papel — para registro de custo. */
  modeloPara(papel: PapelModelo): string;

  /** Geração única. É o método que todo adapter precisa implementar. */
  generate(input: EntradaGeracao): Promise<RespostaIA>;

  /**
   * Geração com uso de tools. Semanticamente igual a `generate` com `tools`
   * preenchido; existe como método próprio para deixar a intenção explícita
   * no ponto de chamada e permitir que um adapter otimize esse caminho.
   */
  toolCall(input: EntradaGeracao & { tools: ToolIA[] }): Promise<RespostaIA>;

  /**
   * Saída estruturada validada contra um JSON Schema.
   *
   * Opcional: quando o adapter não oferece modo estruturado nativo, o registry
   * não o exige — quem chama usa `generate` e valida com Zod.
   */
  structuredOutput?<T>(input: EntradaGeracao & { schema: Record<string, unknown> }): Promise<{ dados: T; uso: UsoIA }>;

  /**
   * Streaming incremental de texto.
   *
   * Opcional: só a UI do Copiloto precisa. Adapter sem streaming faz o produto
   * cair para resposta única, o que é degradação aceitável.
   */
  stream?(input: EntradaGeracao): AsyncIterable<{ delta: string }>;

  /**
   * Conversa multi-turno com tools (módulo de agentes). Opcional no contrato
   * geral, mas todo provedor selecionável no criador de agentes implementa.
   */
  conversar?(input: EntradaConversa): Promise<RespostaConversa>;

  /**
   * Modelos selecionáveis no criador de agentes. Opcional: provedor sem lista
   * própria deixa o módulo de agentes usar o catálogo padrão.
   */
  modelosDisponiveis?(): Promise<ModeloCatalogo[]>;
}

/** Token de injeção do Nest — o domínio injeta isto, nunca uma classe concreta. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');

/* ------------------------------------------------------------------ */
/* Conversa multi-turno com tools (usada pelo módulo de agentes)       */
/* ------------------------------------------------------------------ */

/**
 * Entrada da conversa multi-turno. `effort`/`fallbackRecusa` são recursos
 * específicos da Anthropic: adapters que não os têm simplesmente ignoram.
 * `jsonSchema` pede saída estruturada; cada adapter usa o mecanismo do seu
 * dialeto (`output_config` na Anthropic, `response_format` no OpenAI).
 */
export interface EntradaConversa {
  modelo: string;
  system: string;
  mensagens: { role: 'user' | 'assistant'; content: unknown }[];
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  maxTokens?: number;
  temperatura?: number;
  effort?: 'low' | 'medium' | 'high';
  fallbackRecusa?: boolean;
  jsonSchema?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Resposta da conversa multi-turno, normalizada entre provedores. */
export interface RespostaConversa {
  texto: string;
  toolCalls: ChamadaTool[];
  pararPor: string;
  uso: UsoIA;
  modelo: string;
  /**
   * Conteúdo bruto do turno do assistente. No loop de tools ele volta intacto
   * ao histórico; cada adapter gera blocos no formato que o próprio tradutor
   * de mensagens reconhece.
   */
  blocos: unknown[];
}

/** Entrada de modelo no catálogo do criador de agentes. */
export interface ModeloCatalogo {
  id: string;
  nome: string;
  descricao: string;
  entradaUsdPorMilhao: number;
  saidaUsdPorMilhao: number;
}

/**
 * Superfície que o módulo de agentes consome. Resolve o provedor ativo a cada
 * chamada: trocar `AI_PROVIDER` na env muda o criador de agentes inteiro sem
 * tocar nos serviços de domínio.
 */
export interface AgentLlm {
  configured(): boolean;
  missing(): string[];
  exigirCredencial(): void;
  conversar(input: EntradaConversa): Promise<RespostaConversa>;
  /** Nome do provedor ativo (`anthropic`, `openai`, …) — para diagnóstico/UI. */
  provedor(): string;
}

/** Token de injeção do Nest para a superfície de agentes. */
export const AGENT_LLM = Symbol('AGENT_LLM');

/**
 * Erro de provedor com causa classificada.
 *
 * A distinção importa para o comportamento: `indisponivel` e `limite` merecem
 * retry com backoff; `credencial` e `requisicao` não — retentar só queima cota.
 */
export class ErroProvedorIA extends Error {
  constructor(
    message: string,
    readonly causa: 'credencial' | 'limite' | 'indisponivel' | 'requisicao' | 'desconhecida',
    readonly provedor: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ErroProvedorIA';
  }

  get retentavel(): boolean {
    return this.causa === 'indisponivel' || this.causa === 'limite';
  }
}

/** Classifica um status HTTP na causa correspondente. */
export function causaPorStatus(status: number): ErroProvedorIA['causa'] {
  if (status === 401 || status === 403) return 'credencial';
  if (status === 429) return 'limite';
  if (status >= 500) return 'indisponivel';
  if (status >= 400) return 'requisicao';
  return 'desconhecida';
}
