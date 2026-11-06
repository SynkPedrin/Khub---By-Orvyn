import { z } from 'zod';

/**
 * CATÁLOGO DO AGENT MANAGER (ADR-0030)
 * ====================================
 *
 * Fonte única do que um agente PODE ser. A API valida contra isto (allowlist)
 * e a UI renderiza a partir disto (`GET /v1/agents/catalogo`). Adicionar um
 * modelo ou uma ferramenta é mudar este arquivo — nunca o schema do banco.
 */

/**
 * Modelos selecionáveis. Ids e preços da skill `claude-api` (cache de
 * 2026-10-06). Todos da geração 5.5: raciocínio sempre ligado, sem
 * temperatura (o adaptador cuida disso), `effort` para controlar profundidade.
 */
export const MODELOS = [
  {
    id: 'claude-opus-5-5',
    nome: 'Claude Opus 5.5',
    descricao: 'O mais capaz. Para venda consultiva, objeções e casos que exigem julgamento.',
    entradaUsdPorMilhao: 4,
    saidaUsdPorMilhao: 20,
  },
  {
    id: 'claude-sonnet-5-5',
    nome: 'Claude Sonnet 5.5',
    descricao: 'Equilíbrio entre qualidade e custo para o atendimento do dia a dia.',
    entradaUsdPorMilhao: 2,
    saidaUsdPorMilhao: 10,
  },
  {
    id: 'claude-haiku-5-5',
    nome: 'Claude Haiku 5.5',
    descricao: 'O mais rápido e econômico. Para triagem e perguntas frequentes.',
    entradaUsdPorMilhao: 0.1,
    saidaUsdPorMilhao: 0.5,
  },
] as const;
export type ModeloAgente = (typeof MODELOS)[number]['id'];
export const MODELO_PADRAO: ModeloAgente = 'claude-opus-5-5';
export const IDS_MODELOS: readonly string[] = MODELOS.map((m) => m.id);

/** Tom de voz: vira uma instrução curta no system prompt. */
export const TONS = {
  cordial: { nome: 'Cordial', instrucao: 'Seja caloroso e educado, como um bom recepcionista. Trate pelo primeiro nome.' },
  formal: { nome: 'Formal', instrucao: 'Seja formal e respeitoso. Use "o senhor"/"a senhora" até o contato indicar outra forma.' },
  direto: { nome: 'Direto', instrucao: 'Seja objetivo: responda o que foi perguntado, sem rodeios nem cortesias longas.' },
  descontraido: { nome: 'Descontraído', instrucao: 'Seja leve e próximo, sem gírias forçadas e sem perder o profissionalismo.' },
} as const;
export type TomAgente = keyof typeof TONS;
export const IDS_TONS = Object.keys(TONS) as TomAgente[];

/** Níveis de conhecimento que a busca pode consultar (mesmos escopos do RAG). */
export const ESCOPOS_CONHECIMENTO = {
  tenant: 'Documentos da empresa',
  sub: 'Base da especialidade',
  nicho: 'Base do nicho',
  global: 'Base geral da Orvyn',
} as const;
export type EscopoConhecimento = keyof typeof ESCOPOS_CONHECIMENTO;
export const IDS_ESCOPOS = Object.keys(ESCOPOS_CONHECIMENTO) as EscopoConhecimento[];

export const CANAIS = ['WhatsApp'] as const;

/**
 * Ferramentas do agente que fala com o LEAD.
 *
 * Diferença essencial para as tools da Nyro (operador interno): nenhuma
 * recebe `contactId`. O runtime injeta o contato DA CONVERSA — um lead não
 * consegue, por prompt injection, fazer o agente ler ou alterar outro
 * contato. É o mesmo princípio do invariante RAG 1 (tenant nunca vem do LLM).
 */
export interface FerramentaAgente {
  nome: string;
  rotulo: string;
  descricao: string;
  /** Descrição para o modelo (o que a tool faz e quando usar). */
  instrucaoModelo: string;
  schema: z.ZodTypeAny;
  /** Leitura roda também no playground; escrita é simulada lá. */
  tipo: 'leitura' | 'escrita';
  /** Sempre disponível: não aparece como opção na UI. */
  obrigatoria?: boolean;
}

export const FERRAMENTAS: FerramentaAgente[] = [
  {
    nome: 'buscar_conhecimento',
    rotulo: 'Consultar a base de conhecimento',
    descricao: 'Responde com base nos documentos cadastrados (preços, serviços, políticas).',
    instrucaoModelo:
      'Busca na base de conhecimento da empresa. Use ANTES de responder sobre preço, prazo, serviço, política ou procedimento. Se não houver resultado, diga que vai confirmar com a equipe.',
    schema: z.object({ pergunta: z.string().min(2).max(500) }).strict(),
    tipo: 'leitura',
  },
  {
    nome: 'ver_contato',
    rotulo: 'Ver dados do contato',
    descricao: 'Lê nome, e-mail, empresa e etiqueta do lead desta conversa.',
    instrucaoModelo: 'Lê os dados cadastrados do contato desta conversa (nome, e-mail, empresa, etiqueta).',
    schema: z.object({}).strict(),
    tipo: 'leitura',
  },
  {
    nome: 'atualizar_contato',
    rotulo: 'Atualizar dados do contato',
    descricao: 'Grava nome, e-mail ou empresa que o lead informar na conversa.',
    instrucaoModelo: 'Grava um dado que o contato informou EXPLICITAMENTE nesta conversa. Nunca deduza nem invente.',
    schema: z.object({ campo: z.enum(['nome', 'email', 'empresa']), valor: z.string().min(1).max(160) }).strict(),
    tipo: 'escrita',
  },
  {
    nome: 'adicionar_nota',
    rotulo: 'Registrar nota no contato',
    descricao: 'Anota no CRM o que foi qualificado (interesse, orçamento, prazo).',
    instrucaoModelo: 'Registra uma nota interna no contato com informação útil para a equipe (interesse, orçamento, objeção, prazo).',
    schema: z.object({ texto: z.string().min(3).max(2000) }).strict(),
    tipo: 'escrita',
  },
  {
    nome: 'criar_tarefa',
    rotulo: 'Criar tarefa de follow-up',
    descricao: 'Cria uma tarefa para a equipe dar continuidade.',
    instrucaoModelo: 'Cria uma tarefa para a equipe humana (ex.: "enviar proposta", "ligar amanhã"). `emDias` = em quantos dias vence.',
    schema: z.object({ titulo: z.string().min(3).max(160), emDias: z.number().int().min(0).max(60).optional() }).strict(),
    tipo: 'escrita',
  },
  {
    nome: 'transferir_para_humano',
    rotulo: 'Transferir para humano',
    descricao: 'Sempre ativa: passa a conversa para a equipe.',
    instrucaoModelo:
      'Transfere a conversa para um atendente humano. Use quando o contato pedir uma pessoa, reclamar, falar de cobrança, urgência ou assunto sensível, ou quando você não souber resolver. Antes, avise o contato em uma frase curta.',
    schema: z.object({ motivo: z.string().min(3).max(300) }).strict(),
    tipo: 'escrita',
    obrigatoria: true,
  },
];

export const FERRAMENTAS_POR_NOME = new Map(FERRAMENTAS.map((f) => [f.nome, f]));
/** Opcionais (o que a UI deixa ligar/desligar). */
export const IDS_FERRAMENTAS_OPCIONAIS = FERRAMENTAS.filter((f) => !f.obrigatoria).map((f) => f.nome);

/** Ferramentas efetivas de um agente: as escolhidas + as obrigatórias. */
export function ferramentasDoAgente(escolhidas: readonly string[], conhecimentoAtivo: boolean): FerramentaAgente[] {
  const set = new Set(escolhidas);
  return FERRAMENTAS.filter((f) => {
    if (f.obrigatoria) return true;
    if (f.nome === 'buscar_conhecimento' && !conhecimentoAtivo) return false;
    return set.has(f.nome);
  });
}

/** Zod → JSON Schema mínimo (só os tipos usados acima; sem dependência nova). */
export function paraJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (!(schema instanceof z.ZodObject)) return { type: 'object', properties: {}, additionalProperties: false };
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [chave, campo] of Object.entries(shape)) {
    const opcional = campo instanceof z.ZodOptional;
    const base = opcional ? (campo as z.ZodOptional<z.ZodTypeAny>).unwrap() : campo;
    if (base instanceof z.ZodEnum) properties[chave] = { type: 'string', enum: base.options };
    else if (base instanceof z.ZodNumber) properties[chave] = { type: 'integer' };
    else properties[chave] = { type: 'string' };
    if (!opcional) required.push(chave);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Definições de tool no formato da Messages API. */
export function toolsParaModelo(ferramentas: FerramentaAgente[]) {
  return ferramentas.map((f) => ({ name: f.nome, description: f.instrucaoModelo, input_schema: paraJsonSchema(f.schema) }));
}

/**
 * Corta no limite de caracteres sem quebrar palavra: prefere o fim de frase,
 * depois o último espaço. Mensagem de WhatsApp gigante é pior que uma curta.
 */
export function cortarNoLimite(texto: string, max: number): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  const janela = t.slice(0, max);
  const fimFrase = Math.max(janela.lastIndexOf('. '), janela.lastIndexOf('! '), janela.lastIndexOf('? '), janela.lastIndexOf('\n'));
  if (fimFrase >= max * 0.5) return janela.slice(0, fimFrase + 1).trim();
  const espaco = janela.lastIndexOf(' ');
  return `${(espaco > 0 ? janela.slice(0, espaco) : janela).trim()}…`;
}
