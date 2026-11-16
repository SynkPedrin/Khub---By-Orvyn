import { z } from 'zod';
import { horarioSchema } from './horario';
import { MODOS_AGENTE } from '../../common/modo-agente';

/**
 * CONFIGURAÇÃO ESTENDIDA DO AGENTE (db/034 · docs/AI_AGENT_ARCHITECTURE.md §4)
 * ============================================================================
 *
 * Mora em `agents.config` (JSONB). Este schema é a ÚNICA fonte da estrutura:
 * a API valida a escrita com ele e o runtime lê sempre via `resolverConfig`,
 * que aplica os padrões — um agente criado antes da migração 034 (config `{}`)
 * recebe exatamente os padrões abaixo, que reproduzem o comportamento antigo
 * (mensagem única até `maxCaracteres`, sem follow-up, sem regras).
 *
 * Política: nada aqui altera regra fixa de segurança. Regras fixas
 * (anti-injection, não inventar, guardrail de nicho) vivem no código do
 * prompt e não são configuráveis.
 */

const texto = (max: number) => z.string().max(max).default('');
const nivel = z.number().int().min(0).max(100);

export const IDS_INTENCOES_BASE = [
  'saudacao',
  'duvida',
  'interesse',
  'compra',
  'orcamento',
  'agendamento',
  'objecao',
  'reclamacao',
  'cancelamento',
  'suporte',
  'negociacao',
  'comparacao',
  'desinteresse',
  'solicitacao_humana',
] as const;
export type IntencaoBase = (typeof IDS_INTENCOES_BASE)[number];

export const TIPOS_OBJECAO = ['preco', 'tempo', 'confianca', 'concorrente', 'necessidade', 'decisor', 'adiamento', 'outra'] as const;
export type TipoObjecao = (typeof TIPOS_OBJECAO)[number];

export const identidadeSchema = z
  .object({
    avatarUrl: z.string().url().max(500).nullable().default(null),
    cargo: texto(80),
    especialidade: texto(160),
    segmento: texto(80),
    empresaRepresentada: texto(120),
    objetivoPrincipal: texto(400),
    objetivosSecundarios: z.array(z.string().min(1).max(200)).max(8).default([]),
    publico: texto(400),
    idioma: z.enum(['pt-BR', 'en', 'es']).default('pt-BR'),
    nivelConhecimento: z.enum(['basico', 'intermediario', 'especialista']).default('intermediario'),
    perfilProfissional: texto(600),
    limitesAtuacao: z.array(z.string().min(1).max(200)).max(15).default([]),
  })
  .strict();

export const DIMENSOES_PERSONALIDADE = [
  'formalidade',
  'proximidade',
  'empatia',
  'objetividade',
  'persuasao',
  'proatividade',
  'didatica',
  'assertividade',
  'humor',
  'sofisticacao',
  'linguagemTecnica',
  'naturalidade',
] as const;
export type DimensaoPersonalidade = (typeof DIMENSOES_PERSONALIDADE)[number];

export const personalidadeSchema = z
  .object({
    perfil: z.string().max(60).default('equilibrado'),
    formalidade: nivel.default(50),
    proximidade: nivel.default(60),
    empatia: nivel.default(70),
    objetividade: nivel.default(60),
    persuasao: nivel.default(40),
    proatividade: nivel.default(60),
    didatica: nivel.default(60),
    assertividade: nivel.default(55),
    humor: nivel.default(15),
    sofisticacao: nivel.default(40),
    linguagemTecnica: nivel.default(30),
    naturalidade: nivel.default(80),
  })
  .strict();
export type Personalidade = z.infer<typeof personalidadeSchema>;

export const CAMPOS_COMPORTAMENTO = [
  'abertura',
  'apresentacao',
  'perguntas',
  'necessidades',
  'conducao',
  'objecoes',
  'reclamacoes',
  'indecisos',
  'intencaoCompra',
  'encerramento',
  'quandoTransferir',
  'quandoSilenciar',
  'quandoConsultarBase',
  'quandoExecutarAcoes',
] as const;
export const comportamentoSchema = z
  .object(Object.fromEntries(CAMPOS_COMPORTAMENTO.map((c) => [c, texto(1000)])) as Record<(typeof CAMPOS_COMPORTAMENTO)[number], ReturnType<typeof texto>>)
  .strict();

// ------------------------------------------------------------ regras SE/ENTÃO

export const CAMPOS_CONDICAO = ['intencao', 'objecao', 'sentimento', 'urgencia', 'temperatura', 'etapa', 'palavra_chave', 'interesse', 'perfil'] as const;
export const OPERADORES = ['igual', 'diferente', 'contem', 'existe', 'nao_existe'] as const;
export const TIPOS_ACAO_REGRA = [
  'instrucao',
  'transferir',
  'silenciar',
  'adicionar_tag',
  'remover_tag',
  'acionar_workflow',
  'iniciar_followup',
  'mover_etapa',
  'notificar_equipe',
  'consultar_base',
] as const;
export type TipoAcaoRegra = (typeof TIPOS_ACAO_REGRA)[number];

export const condicaoSchema = z
  .object({
    campo: z.enum(CAMPOS_CONDICAO),
    /** Para `perfil`: nome do campo do perfil (ex.: `orcamento`). */
    chave: z.string().max(60).optional(),
    operador: z.enum(OPERADORES),
    valor: z.string().max(200).default(''),
  })
  .strict();
export type Condicao = z.infer<typeof condicaoSchema>;

export const acaoRegraSchema = z
  .object({
    tipo: z.enum(TIPOS_ACAO_REGRA),
    valor: z.string().max(1000).default(''),
  })
  .strict();
export type AcaoRegra = z.infer<typeof acaoRegraSchema>;

export const regraSchema = z
  .object({
    id: z.string().min(1).max(40),
    nome: z.string().min(1).max(120),
    ativo: z.boolean().default(true),
    logica: z.enum(['e', 'ou']).default('e'),
    condicoes: z.array(condicaoSchema).min(1).max(8),
    acoes: z.array(acaoRegraSchema).min(1).max(6),
    /** Executa no máximo uma vez por conversa (ex.: mover etapa). */
    umaVezPorConversa: z.boolean().default(false),
  })
  .strict();
export type Regra = z.infer<typeof regraSchema>;

// ------------------------------------------------------------ comunicação

export const fragmentacaoSchema = z
  .object({
    ativo: z.boolean().default(true),
    minBlocos: z.number().int().min(1).max(5).default(1),
    maxBlocos: z.number().int().min(1).max(8).default(4),
    maxCaracteresBloco: z.number().int().min(40).max(1000).default(220),
    maxPalavrasBloco: z.number().int().min(5).max(200).default(40),
    maxEmojisBloco: z.number().int().min(0).max(5).default(1),
    intervaloMinMs: z.number().int().min(0).max(60000).default(1200),
    intervaloMaxMs: z.number().int().min(0).max(60000).default(6000),
    /** Velocidade de "digitação" simulada (caracteres por segundo). */
    digitacaoCps: z.number().int().min(5).max(80).default(28),
    preferirCurtas: z.boolean().default(true),
    tamanhoMedio: z.number().int().min(20).max(600).default(110),
    pontuacao: z.enum(['preservar', 'leve']).default('preservar'),
    quebraSemantica: z.enum(['ideias', 'frases', 'paragrafos']).default('ideias'),
  })
  .strict()
  .refine((f) => f.maxBlocos >= f.minBlocos, { message: 'maxBlocos deve ser >= minBlocos' })
  .refine((f) => f.intervaloMaxMs >= f.intervaloMinMs, { message: 'intervaloMaxMs deve ser >= intervaloMinMs' });
export type ConfigFragmentacao = z.infer<typeof fragmentacaoSchema>;

export const comunicacaoSchema = z
  .object({
    fragmentacao: fragmentacaoSchema.default({}),
    emojis: z.enum(['nunca', 'raro', 'moderado']).default('raro'),
    usarNome: z.enum(['natural', 'sempre', 'nunca']).default('natural'),
    evitarRepeticao: z.boolean().default(true),
    reapresentar: z.boolean().default(false),
  })
  .strict();

// ------------------------------------------------------------ inteligência

export const inteligenciaSchema = z
  .object({
    /** Etapa de análise estruturada (intenção/problema/objeções/extração). */
    analiseAtiva: z.boolean().default(true),
    /** null = o mesmo modelo do agente. */
    modeloAnalise: z.string().max(80).nullable().default(null),
    effort: z.enum(['low', 'medium', 'high']).default('low'),
    maxTokens: z.number().int().min(512).max(16000).default(4096),
    timeoutMs: z.number().int().min(5000).max(120000).default(45000),
    janelaHistorico: z.number().int().min(6).max(80).default(30),
    autonomia: z.enum(['conservadora', 'equilibrada', 'proativa']).default('equilibrada'),
    tentativas: z.number().int().min(0).max(3).default(1),
    /** Modelo alternativo se o principal falhar por indisponibilidade. */
    modeloFallback: z.string().max(80).nullable().default(null),
    orcamentoUsdConversa: z.number().min(0).max(50).default(1),
    orcamentoUsdDiario: z.number().min(0).max(5000).default(20),
    /** Abaixo disso a resposta é registrada como baixa confiança (aprendizado). */
    limiarConfianca: z.number().min(0).max(1).default(0.55),
  })
  .strict();

export const conhecimentoSchema = z
  .object({
    /** true = só as fontes vinculadas a este agente (e as bases compartilhadas escolhidas). */
    somenteFontesDoAgente: z.boolean().default(false),
    categorias: z.array(z.string().min(1).max(60)).max(30).default([]),
    /** Consultar a base ANTES de responder quando a intenção for uma destas. */
    consultarEm: z.array(z.string().max(40)).max(20).default(['duvida', 'orcamento', 'compra', 'agendamento', 'objecao', 'comparacao']),
    maxTrechos: z.number().int().min(1).max(12).default(6),
  })
  .strict();

export const memoriaSchema = z
  .object({
    curtoPrazo: z.boolean().default(true),
    longoPrazo: z.boolean().default(true),
    operacional: z.boolean().default(true),
    resumirAPartirDe: z.number().int().min(10).max(300).default(24),
    /** 0 = sem expiração automática (a exclusão do contato apaga tudo). */
    retencaoDias: z.number().int().min(0).max(3650).default(365),
  })
  .strict();

export const CAMPOS_PERFIL = [
  'nome',
  'email',
  'telefone',
  'empresa',
  'servico_interesse',
  'produto_interesse',
  'problema_principal',
  'problemas_secundarios',
  'objetivos',
  'necessidades',
  'objecoes',
  'orcamento',
  'urgencia',
  'intencao_compra',
  'temperatura',
  'etapa',
  'proxima_acao',
  'motivo_nao_conversao',
  'preferencias',
  'disponibilidade',
] as const;
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

export const crmSchema = z
  .object({
    /** Campos do PERFIL que a IA atualiza sozinha (os demais ficam pendentes de revisão). */
    camposAutomaticos: z.array(z.enum(CAMPOS_PERFIL)).default([
      'servico_interesse',
      'produto_interesse',
      'problema_principal',
      'problemas_secundarios',
      'objetivos',
      'necessidades',
      'objecoes',
      'orcamento',
      'urgencia',
      'intencao_compra',
      'temperatura',
      'preferencias',
      'disponibilidade',
    ]),
    /** Campos do CONTATO no CRM que podem ser gravados a partir do perfil (só fato declarado). */
    sincronizarContato: z.array(z.enum(['nome', 'email', 'empresa'])).default(['email', 'empresa']),
    /** perfil → chave de campo personalizado do contato. */
    mapaCamposCustom: z.record(z.enum(CAMPOS_PERFIL), z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/)).default({}),
    limiarConfiancaAuto: z.number().min(0).max(1).default(0.7),
  })
  .strict();

export const permissoesSchema = z
  .object({
    /** Ferramentas que precisam de aprovação humana antes de executar. */
    exigirConfirmacao: z.array(z.string().max(60)).max(30).default([]),
    /** Ações por regra também respeitam as ferramentas liberadas. */
    acoesPorRegra: z.boolean().default(true),
    /** Workflows que o agente pode acionar (ids). Vazio = nenhum. */
    workflowsPermitidos: z.array(z.string().uuid()).max(30).default([]),
    /** Etapas de funil que o agente pode atribuir (ids). Vazio = qualquer uma. */
    etapasPermitidas: z.array(z.string().uuid()).max(50).default([]),
  })
  .strict();

export const agentConfigSchema = z
  .object({
    /** Piloto automático ou sugestivo (ADR-0048, common/modo-agente.ts). */
    modo: z.enum(MODOS_AGENTE).default('automatico'),
    identidade: identidadeSchema.default({}),
    personalidade: personalidadeSchema.default({}),
    comportamento: comportamentoSchema.default({}),
    regras: z.array(regraSchema).max(50).default([]),
    comunicacao: comunicacaoSchema.default({}),
    inteligencia: inteligenciaSchema.default({}),
    conhecimento: conhecimentoSchema.default({}),
    memoria: memoriaSchema.default({}),
    crm: crmSchema.default({}),
    permissoes: permissoesSchema.default({}),
    horario: horarioSchema.default({}),
  })
  .strict();

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

/** Padrões completos (o que um agente sem configuração estendida recebe). */
export function configPadrao(): AgentConfig {
  return agentConfigSchema.parse({});
}

/**
 * Lê `agents.config` do banco de forma TOLERANTE: chave desconhecida ou
 * valor inválido gravado por versão anterior não derruba o atendimento — cai
 * no padrão daquela seção (e o erro é devolvido para log).
 */
export function resolverConfig(bruto: unknown): { config: AgentConfig; avisos: string[] } {
  const r = agentConfigSchema.safeParse(bruto ?? {});
  if (r.success) return { config: r.data, avisos: [] };
  const avisos = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const base = configPadrao();
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const secoes = agentConfigSchema.shape;
  const saida: Record<string, unknown> = { ...base };
  for (const chave of Object.keys(secoes) as (keyof typeof secoes)[]) {
    const s = secoes[chave].safeParse(obj[chave]);
    if (s.success) saida[chave] = s.data;
  }
  return { config: saida as AgentConfig, avisos };
}

/**
 * Mescla uma atualização parcial (por seção) na configuração atual e valida o
 * resultado inteiro. Seção omitida = mantida. Lança ZodError se inválido.
 */
export function mesclarConfig(atual: AgentConfig, patch: Partial<Record<keyof AgentConfig, unknown>>): AgentConfig {
  const proximo: Record<string, unknown> = { ...atual };
  for (const [chave, valor] of Object.entries(patch)) {
    if (valor === undefined) continue;
    const anterior = (atual as Record<string, unknown>)[chave];
    proximo[chave] = Array.isArray(valor) || typeof valor !== 'object' || valor === null || Array.isArray(anterior)
      ? valor
      : { ...(anterior as Record<string, unknown>), ...(valor as Record<string, unknown>) };
  }
  return agentConfigSchema.parse(proximo);
}

// ------------------------------------------------------------ personalidade → prompt

/** Presets de personalidade embutidos (o tenant pode salvar os seus). */
export const PERFIS_PERSONALIDADE: Record<string, { nome: string; valores: Omit<Personalidade, 'perfil'> }> = {
  equilibrado: { nome: 'Equilibrado', valores: { formalidade: 50, proximidade: 60, empatia: 70, objetividade: 60, persuasao: 40, proatividade: 60, didatica: 60, assertividade: 55, humor: 15, sofisticacao: 40, linguagemTecnica: 30, naturalidade: 80 } },
  consultor: { nome: 'Consultor comercial', valores: { formalidade: 45, proximidade: 65, empatia: 70, objetividade: 70, persuasao: 70, proatividade: 80, didatica: 60, assertividade: 70, humor: 15, sofisticacao: 50, linguagemTecnica: 35, naturalidade: 85 } },
  acolhedor: { nome: 'Acolhedor (saúde)', valores: { formalidade: 55, proximidade: 75, empatia: 95, objetividade: 50, persuasao: 25, proatividade: 55, didatica: 80, assertividade: 40, humor: 5, sofisticacao: 40, linguagemTecnica: 20, naturalidade: 85 } },
  executivo: { nome: 'Executivo (B2B)', valores: { formalidade: 80, proximidade: 35, empatia: 50, objetividade: 90, persuasao: 55, proatividade: 70, didatica: 45, assertividade: 80, humor: 0, sofisticacao: 80, linguagemTecnica: 60, naturalidade: 65 } },
  descontraido: { nome: 'Descontraído', valores: { formalidade: 15, proximidade: 90, empatia: 75, objetividade: 55, persuasao: 45, proatividade: 65, didatica: 55, assertividade: 50, humor: 55, sofisticacao: 20, linguagemTecnica: 15, naturalidade: 95 } },
};

const DESCRITORES: Record<DimensaoPersonalidade, [string, string, string]> = {
  // "o senhor/a senhora" é decisão do TOM (formal), não da faixa alta: com tom
  // cordial + formalidade 70 o prompt mandava as duas coisas e o agente soava
  // como central de atendimento.
  formalidade: ['linguagem informal, coloquial', 'linguagem cordial e neutra', 'linguagem polida e respeitosa, sem gírias nem abreviações'],
  proximidade: ['mantenha distância profissional', 'seja próximo sem intimidade', 'seja caloroso e próximo, como alguém de confiança'],
  empatia: ['foque nos fatos', 'reconheça o sentimento do contato quando houver', 'acolha emoções explicitamente antes de seguir'],
  objetividade: ['pode contextualizar com calma', 'vá ao ponto com algum contexto', 'seja direto: responda primeiro, detalhe só se pedirem'],
  persuasao: ['não pressione nem venda', 'mostre valor quando fizer sentido', 'conduza ativamente para a decisão, com argumentos de valor (sem pressão indevida)'],
  proatividade: ['responda só o que foi perguntado', 'sugira o próximo passo quando útil', 'antecipe dúvidas e proponha sempre o próximo passo'],
  didatica: ['explique pouco', 'explique quando necessário', 'explique de forma simples, com exemplos curtos'],
  assertividade: ['seja cauteloso nas afirmações', 'seja claro', 'seja firme e seguro nas recomendações'],
  humor: ['sem humor', 'humor leve e raro', 'pode usar humor leve com naturalidade'],
  sofisticacao: ['vocabulário simples', 'vocabulário comum', 'vocabulário refinado'],
  linguagemTecnica: ['evite termos técnicos', 'use termo técnico só explicando', 'pode usar termos técnicos do segmento'],
  naturalidade: ['pode soar padronizado', 'soe natural', 'soe como uma pessoa real digitando no WhatsApp, variando as frases'],
};

export function descreverPersonalidade(p: Personalidade): string[] {
  return DIMENSOES_PERSONALIDADE.map((d) => {
    const v = p[d];
    const faixa = v < 34 ? 0 : v < 67 ? 1 : 2;
    return DESCRITORES[d][faixa];
  });
}
