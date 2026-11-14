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
/** Padrão de agente novo: Sonnet 5.5 (decisão do dono em 2026-11-13: qualidade de atendimento com custo de Sonnet). */
export const MODELO_PADRAO: ModeloAgente = 'claude-sonnet-5-5';
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
  global: 'Base geral da KHUB',
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
  /** Grupo no CRM Tools Manager. */
  grupo: 'conhecimento' | 'contato' | 'pipeline' | 'tarefas' | 'agenda' | 'atendimento' | 'automacao';
  /** Operação crítica: a UI sugere exigir aprovação humana. */
  critica?: boolean;
  /** Tempo máximo de execução (ms). */
  timeoutMs?: number;
}

export const FERRAMENTAS: FerramentaAgente[] = [
  {
    nome: 'buscar_conhecimento',
    rotulo: 'Consultar a base de conhecimento',
    descricao: 'Responde com base nos documentos cadastrados (preços, serviços, políticas).',
    instrucaoModelo:
      'Busca na base de conhecimento da empresa. Use ANTES de responder sobre preço, prazo, serviço, política ou procedimento. Se não houver resultado, diga que vai confirmar com a equipe.',
    schema: z.object({ pergunta: z.string().min(2).max(500) }).strict(),
    grupo: 'conhecimento',
    tipo: 'leitura',
  },
  {
    nome: 'ver_contato',
    rotulo: 'Ver dados do contato',
    descricao: 'Lê nome, e-mail, empresa e etiqueta do lead desta conversa.',
    instrucaoModelo: 'Lê os dados cadastrados do contato desta conversa (nome, e-mail, empresa, etiqueta).',
    schema: z.object({}).strict(),
    grupo: 'contato',
    tipo: 'leitura',
  },
  {
    nome: 'atualizar_contato',
    rotulo: 'Atualizar dados do contato',
    descricao: 'Grava nome, e-mail ou empresa que o lead informar na conversa.',
    instrucaoModelo: 'Grava um dado que o contato informou EXPLICITAMENTE nesta conversa. Nunca deduza nem invente.',
    schema: z.object({ campo: z.enum(['nome', 'email', 'empresa']), valor: z.string().min(1).max(160) }).strict(),
    grupo: 'contato',
    tipo: 'escrita',
  },
  {
    nome: 'adicionar_nota',
    rotulo: 'Registrar nota no contato',
    descricao: 'Anota no CRM o que foi qualificado (interesse, orçamento, prazo).',
    instrucaoModelo: 'Registra uma nota interna no contato com informação útil para a equipe (interesse, orçamento, objeção, prazo).',
    schema: z.object({ texto: z.string().min(3).max(2000) }).strict(),
    grupo: 'contato',
    tipo: 'escrita',
  },
  {
    nome: 'criar_tarefa',
    rotulo: 'Criar tarefa de follow-up',
    descricao: 'Cria uma tarefa para a equipe dar continuidade.',
    instrucaoModelo: 'Cria uma tarefa para a equipe humana (ex.: "enviar proposta", "ligar amanhã"). `emDias` = em quantos dias vence.',
    schema: z.object({ titulo: z.string().min(3).max(160), emDias: z.number().int().min(0).max(60).optional() }).strict(),
    grupo: 'tarefas',
    tipo: 'escrita',
  },
  {
    nome: 'ver_campos_personalizados',
    rotulo: 'Consultar campos personalizados',
    descricao: 'Lê os campos personalizados do contato.',
    instrucaoModelo: 'Lê os campos personalizados do contato desta conversa.',
    schema: z.object({}).strict(),
    grupo: 'contato',
    tipo: 'leitura',
  },
  {
    nome: 'atualizar_campo_personalizado',
    rotulo: 'Atualizar campo personalizado',
    descricao: 'Grava um campo personalizado do contato com o que ele informou.',
    instrucaoModelo: 'Grava um campo personalizado do contato (ex.: "plano", "cidade") com um dado que o contato informou EXPLICITAMENTE.',
    schema: z.object({ chave: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/), valor: z.string().min(1).max(500) }).strict(),
    grupo: 'contato',
    tipo: 'escrita',
  },
  {
    nome: 'adicionar_tag',
    rotulo: 'Adicionar tag',
    descricao: 'Aplica uma tag ao contato (pode disparar automações de "tag adicionada").',
    instrucaoModelo: 'Adiciona uma tag ao contato para segmentação (ex.: "interesse-implante").',
    schema: z.object({ tag: z.string().min(1).max(40) }).strict(),
    grupo: 'contato',
    tipo: 'escrita',
  },
  {
    nome: 'remover_tag',
    rotulo: 'Remover tag',
    descricao: 'Remove uma tag do contato.',
    instrucaoModelo: 'Remove uma tag do contato.',
    schema: z.object({ tag: z.string().min(1).max(40) }).strict(),
    grupo: 'contato',
    tipo: 'escrita',
  },
  {
    nome: 'ver_oportunidades',
    rotulo: 'Consultar pipeline',
    descricao: 'Lê as oportunidades do contato e as etapas do funil.',
    instrucaoModelo: 'Lista as oportunidades (negócios) do contato desta conversa e as etapas disponíveis do funil.',
    schema: z.object({}).strict(),
    grupo: 'pipeline',
    tipo: 'leitura',
  },
  {
    nome: 'criar_oportunidade',
    rotulo: 'Criar oportunidade',
    descricao: 'Abre um negócio no funil para o contato.',
    instrucaoModelo: 'Cria uma oportunidade para o contato quando houver intenção real de compra. `etapa` = nome da etapa (opcional; padrão: primeira etapa).',
    schema: z.object({ titulo: z.string().min(3).max(120), valor: z.number().min(0).max(100_000_000).optional(), etapa: z.string().min(1).max(80).optional() }).strict(),
    grupo: 'pipeline',
    tipo: 'escrita',
    critica: true,
  },
  {
    nome: 'mover_etapa',
    rotulo: 'Atualizar estágio',
    descricao: 'Move a oportunidade do contato para outra etapa do funil.',
    instrucaoModelo: 'Move a oportunidade do contato para a etapa informada (nome da etapa). Sem `oportunidadeId`, usa a oportunidade aberta mais recente do contato.',
    schema: z.object({ etapa: z.string().min(1).max(80), oportunidadeId: z.string().uuid().optional() }).strict(),
    grupo: 'pipeline',
    tipo: 'escrita',
    critica: true,
  },
  {
    nome: 'ver_tarefas',
    rotulo: 'Consultar tarefas',
    descricao: 'Lê as tarefas abertas do contato.',
    instrucaoModelo: 'Lista as tarefas abertas ligadas ao contato desta conversa.',
    schema: z.object({}).strict(),
    grupo: 'tarefas',
    tipo: 'leitura',
  },
  {
    nome: 'atualizar_tarefa',
    rotulo: 'Atualizar tarefa',
    descricao: 'Conclui ou reabre uma tarefa do contato.',
    instrucaoModelo: 'Atualiza uma tarefa DO CONTATO desta conversa (concluir/reabrir ou renomear).',
    schema: z.object({ tarefaId: z.string().uuid(), status: z.enum(['aberta', 'concluida']).optional(), titulo: z.string().min(3).max(160).optional() }).strict(),
    grupo: 'tarefas',
    tipo: 'escrita',
  },
  {
    nome: 'ver_agendamentos',
    rotulo: 'Consultar agendamentos',
    descricao: 'Lê compromissos do contato e sugere horários livres.',
    instrucaoModelo: 'Lista os compromissos futuros do contato e, se `data` (AAAA-MM-DD) for informada, os horários livres desse dia.',
    schema: z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), duracaoMin: z.number().int().min(15).max(240).optional() }).strict(),
    grupo: 'agenda',
    tipo: 'leitura',
  },
  {
    nome: 'solicitar_agendamento',
    rotulo: 'Solicitar agendamento',
    descricao: 'Reserva um horário na agenda para o contato (recusa choque de horário).',
    instrucaoModelo: 'Agenda um compromisso para o contato. Use SOMENTE um horário que o contato confirmou e que apareceu livre em ver_agendamentos. `inicio` em ISO 8601 com fuso.',
    schema: z.object({ inicio: z.string().datetime({ offset: true }), duracaoMin: z.number().int().min(15).max(240).default(60), titulo: z.string().min(3).max(120).optional() }).strict(),
    grupo: 'agenda',
    tipo: 'escrita',
    critica: true,
  },
  {
    nome: 'encerrar_atendimento',
    rotulo: 'Encerrar atendimento',
    descricao: 'Marca a conversa como resolvida.',
    instrucaoModelo: 'Encerra o atendimento quando o assunto foi resolvido e o contato se despediu.',
    schema: z.object({ motivo: z.string().min(3).max(300) }).strict(),
    grupo: 'atendimento',
    tipo: 'escrita',
  },
  {
    nome: 'acionar_workflow',
    rotulo: 'Acionar workflow',
    descricao: 'Inicia uma automação permitida para o contato.',
    instrucaoModelo: 'Inicia um workflow de automação para o contato. Só os workflows listados como permitidos podem ser usados.',
    schema: z.object({ workflowId: z.string().uuid() }).strict(),
    grupo: 'automacao',
    tipo: 'escrita',
    critica: true,
  },
  {
    nome: 'notificar_equipe',
    rotulo: 'Enviar notificação interna',
    descricao: 'Avisa a equipe com uma tarefa prioritária ligada ao contato.',
    instrucaoModelo: 'Notifica a equipe interna sobre algo que precisa de atenção humana (sem transferir a conversa).',
    schema: z.object({ mensagem: z.string().min(5).max(500), prioridade: z.enum(['media', 'alta']).default('alta') }).strict(),
    grupo: 'atendimento',
    tipo: 'escrita',
  },
  {
    nome: 'transferir_para_humano',
    rotulo: 'Transferir para humano',
    descricao: 'Sempre ativa: passa a conversa para a equipe.',
    instrucaoModelo:
      'Transfere a conversa para um atendente humano. Use quando o contato pedir uma pessoa, reclamar, falar de cobrança, urgência ou assunto sensível, ou quando você não souber resolver. Antes, avise o contato em uma frase curta.',
    schema: z.object({ motivo: z.string().min(3).max(300) }).strict(),
    grupo: 'atendimento',
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
    const opcional = campo instanceof z.ZodOptional || campo instanceof z.ZodDefault;
    const base = campo instanceof z.ZodOptional ? campo.unwrap() : campo instanceof z.ZodDefault ? campo._def.innerType : campo;
    if (base instanceof z.ZodEnum) properties[chave] = { type: 'string', enum: base.options };
    else if (base instanceof z.ZodNumber) properties[chave] = { type: base.isInt ? 'integer' : 'number' };
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
