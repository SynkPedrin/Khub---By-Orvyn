'use client';

import { ApiError } from './api-error';
import { clienteApi } from './session-fetch';
import type { Prioridade, Tom } from './agency-daily';

/**
 * Onboarding KROMA (db/078): condução rastreável da entrada de um cliente da
 * agência. Espelho de `apps/api/src/onboarding/onboarding.catalogo.ts` +
 * shapes das respostas do `OnboardingService`. Rotas: `/api/v1/agency/onboarding/*`.
 */
const req = clienteApi('/api/v1/agency/');
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
// Caminhos relativos à agência: `onboarding` (coleção), `onboarding/<id>/...`.

// ───────────────────────────── escopo ─────────────────────────────

export const SERVICOS_ESCOPO = [
  { chave: 'trafego', rotulo: 'Tráfego pago' },
  { chave: 'social', rotulo: 'Social media' },
  { chave: 'audiovisual', rotulo: 'Audiovisual' },
  { chave: 'agente_ia', rotulo: 'Agente de IA' },
  { chave: 'branding', rotulo: 'Branding' },
] as const;

export type ServicoEscopo = (typeof SERVICOS_ESCOPO)[number]['chave'];
export type Escopo = Record<ServicoEscopo, boolean>;

export const ESCOPO_VAZIO: Escopo = { trafego: false, social: false, audiovisual: false, agente_ia: false, branding: false };

/** Lê o jsonb vindo da API e devolve um Escopo completo e seguro (espelho do catálogo). */
export function normalizarEscopo(bruto: unknown): Escopo {
  const obj = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const out = { ...ESCOPO_VAZIO };
  for (const s of SERVICOS_ESCOPO) out[s.chave] = obj[s.chave] === true;
  return out;
}

/** Rótulos dos serviços ativos de um escopo, na ordem do catálogo. */
export function servicosAtivos(escopo: Escopo): string[] {
  return SERVICOS_ESCOPO.filter((s) => escopo[s.chave]).map((s) => s.rotulo);
}

// ───────────────────────────── status ─────────────────────────────

export const STATUS_ONBOARDING = ['coleta', 'imersao', 'implantacao', 'homologacao', 'pronto', 'bloqueado'] as const;
export type StatusOnboarding = (typeof STATUS_ONBOARDING)[number];

export const STATUS_OB: Record<StatusOnboarding, { label: string; tom: Tom }> = {
  coleta: { label: 'Coleta', tom: 'info' },
  imersao: { label: 'Imersão', tom: 'brand' },
  implantacao: { label: 'Implantação', tom: 'warning' },
  homologacao: { label: 'Homologação', tom: 'rosa' },
  pronto: { label: 'Pronto', tom: 'success' },
  bloqueado: { label: 'Bloqueado', tom: 'danger' },
};
export const STATUS_OB_ORDEM = STATUS_ONBOARDING;

export const STATUS_VERIFICACAO = ['pendente', 'em_andamento', 'concluido', 'em_verificacao', 'verificado', 'bloqueado', 'aguardando_aprovacao'] as const;
export type StatusVerificacao = (typeof STATUS_VERIFICACAO)[number];
export const STATUS_VERIFICACAO_ORDEM = STATUS_VERIFICACAO;

export const VERIFICACAO: Record<StatusVerificacao, { label: string; tom: Tom }> = {
  pendente: { label: 'Pendente', tom: 'neutro' },
  em_andamento: { label: 'Em andamento', tom: 'brand' },
  concluido: { label: 'Concluído', tom: 'info' },
  em_verificacao: { label: 'Em verificação', tom: 'warning' },
  verificado: { label: 'Verificado', tom: 'success' },
  bloqueado: { label: 'Bloqueado', tom: 'danger' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', tom: 'rosa' },
};

// ───────────────────────────── conhecimento ─────────────────────────────

export const SECOES_CONHECIMENTO = [
  { chave: 'institucional', rotulo: 'Institucional', camposObrigatorios: ['nome_empresa', 'historia', 'contatos_principais'] },
  { chave: 'operacao', rotulo: 'Operação', camposObrigatorios: ['horarios', 'capacidade', 'processo_atendimento'] },
  { chave: 'produtos', rotulo: 'Produtos e serviços', camposObrigatorios: ['lista_produtos', 'precos', 'prioridades'] },
  { chave: 'comercial', rotulo: 'Comercial', camposObrigatorios: ['processo_comercial', 'objecoes_comuns', 'canais'] },
  { chave: 'marketing', rotulo: 'Marketing', camposObrigatorios: ['publico_alvo', 'diferenciais', 'concorrentes', 'campanhas_anteriores'] },
  { chave: 'identidade', rotulo: 'Identidade da marca', camposObrigatorios: ['logotipo', 'cores_tipografia', 'tom_de_voz'] },
  { chave: 'preferencias', rotulo: 'Preferências e expectativas', camposObrigatorios: ['o_que_evitar', 'expectativas', 'contatos_decisores'] },
] as const;

export type SecaoConhecimento = (typeof SECOES_CONHECIMENTO)[number]['chave'];

/** "contatos_principais" → "Contatos principais". */
export function rotuloCampo(chave: string): string {
  const s = chave.replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : chave;
}

// ───────────────────────────── pauta da imersão ─────────────────────────────

export interface TopicoPauta {
  chave: string;
  titulo: string;
  escopoKey: ServicoEscopo | null;
}

export const PAUTA_IMERSAO_BASE: readonly TopicoPauta[] = [
  { chave: 'apresentacao', titulo: 'Apresentação dos envolvidos', escopoKey: null },
  { chave: 'historia', titulo: 'História e contexto do negócio', escopoKey: null },
  { chave: 'produtos', titulo: 'Produtos e serviços prioritários', escopoKey: null },
  { chave: 'publico', titulo: 'Público e perfil de cliente ideal', escopoKey: null },
  { chave: 'diferenciais', titulo: 'Diferenciais competitivos', escopoKey: null },
  { chave: 'atendimento', titulo: 'Processo de atendimento', escopoKey: null },
  { chave: 'comercial', titulo: 'Processo comercial', escopoKey: null },
  { chave: 'horarios', titulo: 'Horários e capacidade de atendimento', escopoKey: null },
  { chave: 'objetivos', titulo: 'Objetivos e metas', escopoKey: null },
  { chave: 'campanhas', titulo: 'Campanhas anteriores e resultados', escopoKey: null },
  { chave: 'concorrentes', titulo: 'Concorrentes e referências', escopoKey: null },
  { chave: 'materiais', titulo: 'Materiais e acessos disponíveis', escopoKey: null },
  { chave: 'expectativas', titulo: 'Expectativas do cliente', escopoKey: null },
  { chave: 'proximos_passos', titulo: 'Próximas etapas do onboarding', escopoKey: null },
] as const;

const PAUTA_IMERSAO_EXTRAS: readonly TopicoPauta[] = [
  { chave: 'verba_midia', titulo: 'Verba de mídia, conta de anúncios e pixels', escopoKey: 'trafego' },
  { chave: 'linha_editorial', titulo: 'Linha editorial, frequência e formatos', escopoKey: 'social' },
  { chave: 'captacoes', titulo: 'Captações: locais, datas e logística', escopoKey: 'audiovisual' },
  { chave: 'atendimento_ia', titulo: 'Atendimento por IA: tom, regras e encaminhamento humano', escopoKey: 'agente_ia' },
  { chave: 'identidade_visual', titulo: 'Identidade visual: estado atual e referências', escopoKey: 'branding' },
] as const;

/** Pauta da reunião de imersão adaptada ao escopo (espelho do catálogo: o backend sugere a mesma). */
export function pautaParaEscopo(escopo: Escopo): TopicoPauta[] {
  return [...PAUTA_IMERSAO_BASE, ...PAUTA_IMERSAO_EXTRAS.filter((t) => t.escopoKey !== null && escopo[t.escopoKey])];
}

// ───────────────────────────── agente de IA ─────────────────────────────

export const CENARIOS_TESTE_AGENTE = [
  { cenario: 'primeiro_contato', descricao: 'Lead chega pela primeira vez e se apresenta' },
  { cenario: 'duvida_preco', descricao: 'Lead pergunta preço diretamente' },
  { cenario: 'interesse_comercial', descricao: 'Lead demonstra interesse e quer avançar' },
  { cenario: 'objecao', descricao: 'Lead levanta objeção (preço, tempo, confiança)' },
  { cenario: 'cliente_indeciso', descricao: 'Lead não decide e enrola a conversa' },
  { cenario: 'fora_do_escopo', descricao: 'Pedido fora do que o cliente oferece' },
  { cenario: 'pergunta_sem_resposta', descricao: 'Pergunta sem resposta na base de conhecimento' },
  { cenario: 'reclamacao', descricao: 'Cliente insatisfeito reclamando' },
  { cenario: 'escalacao_humana', descricao: 'Situação que exige atendimento humano' },
  { cenario: 'lead_sem_resposta', descricao: 'Lead que não respondeu (follow-up)' },
  { cenario: 'intencao_compra', descricao: 'Lead com intenção clara de compra' },
] as const;

export type StatusTesteAgente = 'pendente' | 'aprovado' | 'reprovado';
export const STATUS_TESTE: Record<StatusTesteAgente, { label: string; tom: Tom }> = {
  pendente: { label: 'Pendente', tom: 'neutro' },
  aprovado: { label: 'Aprovado', tom: 'success' },
  reprovado: { label: 'Reprovado', tom: 'danger' },
};

export type AprovacaoAgente = 'rascunho' | 'em_testes' | 'aprovado' | 'publicado';
export const APROVACAO_AGENTE: Record<AprovacaoAgente, { label: string; tom: Tom }> = {
  rascunho: { label: 'Rascunho', tom: 'neutro' },
  em_testes: { label: 'Em testes', tom: 'warning' },
  aprovado: { label: 'Aprovado', tom: 'success' },
  publicado: { label: 'Publicado', tom: 'info' },
};

export interface ResultadoTesteAgente {
  cenario: string;
  status: StatusTesteAgente;
  observacao?: string;
}

/** Espelho do catálogo: `aprovado` só com os 11 cenários aprovados; teste sem completar = `em_testes`. */
export function aprovacaoDosTestes(testes: readonly ResultadoTesteAgente[]): AprovacaoAgente {
  if (!testes.length) return 'rascunho';
  const porCenario = new Map(testes.map((t) => [t.cenario, t.status]));
  const completo = CENARIOS_TESTE_AGENTE.every((c) => porCenario.get(c.cenario) === 'aprovado');
  return completo ? 'aprovado' : 'em_testes';
}

/** Seções estruturadas da especificação do agente (comentário de db/078). */
export const ESPEC_AGENTE_SECOES = [
  { chave: 'identidade', rotulo: 'Identidade' },
  { chave: 'funcao', rotulo: 'Função' },
  { chave: 'personalidade', rotulo: 'Personalidade' },
  { chave: 'contexto', rotulo: 'Contexto' },
  { chave: 'base_conhecimento', rotulo: 'Base de conhecimento' },
  { chave: 'catalogo', rotulo: 'Catálogo' },
  { chave: 'precos', rotulo: 'Preços' },
  { chave: 'publico', rotulo: 'Público' },
  { chave: 'tom_de_voz', rotulo: 'Tom de voz' },
  { chave: 'regras', rotulo: 'Regras de atendimento' },
  { chave: 'qualificacao', rotulo: 'Qualificação' },
  { chave: 'objecoes', rotulo: 'Objeções' },
  { chave: 'follow_ups', rotulo: 'Follow-ups' },
  { chave: 'encaminhamento_humano', rotulo: 'Encaminhamento humano' },
  { chave: 'restricoes', rotulo: 'Restrições' },
  { chave: 'limites', rotulo: 'Limites' },
  { chave: 'seguranca', rotulo: 'Segurança' },
] as const;

// ───────────────────────────── papéis das tarefas ─────────────────────────────

export type PapelTarefa = 'marcos' | 'sofia' | 'matheus' | 'interno';
export const PAPEIS_TAREFA: { chave: PapelTarefa; rotulo: string }[] = [
  { chave: 'marcos', rotulo: 'Marcos (tráfego)' },
  { chave: 'sofia', rotulo: 'Sofia (social e branding)' },
  { chave: 'matheus', rotulo: 'Matheus (audiovisual e copy)' },
  { chave: 'interno', rotulo: 'Interno (orquestração)' },
];

// ───────────────────────────── shapes da API ─────────────────────────────

export interface Evidencia {
  tipo?: string;
  referencia?: string;
  observacao?: string;
}

export interface ResumoOnboarding {
  id: string;
  status: StatusOnboarding;
  etapaAtual: string | null;
  escopo: Escopo;
  cliente: { id: string; nome: string };
  responsavelId: string | null;
  startedAt: string;
  completedAt: string | null;
  verificacoes: { total: number; verificadas: number; pendentes: number; bloqueadas: number };
  tarefas: { total: number; atrasadas: number; prioridades: string[] };
}

export interface VisaoExecutiva {
  /** Contagem por status (antes do filtro de status da tela). */
  contadores: Record<string, number>;
  itens: ResumoOnboarding[];
}

export interface KnowledgeSecao {
  id: string;
  secao: SecaoConhecimento;
  dados: Record<string, unknown>;
  pendente: boolean;
  confirmadoPor: string | null;
  confirmadoEm: string | null;
  atualizadoPor: string | null;
  updatedAt: string;
}

export interface KnowledgeHist {
  id: string;
  dados: Record<string, unknown>;
  alteradoPor: string | null;
  createdAt: string;
}

export interface Reuniao {
  id: string;
  tipo: string;
  data: string | null;
  participantes: string[];
  pauta: string[];
  resumo: string | null;
  decisoes: string[];
  pendencias: string[];
  criadoPor: string | null;
  createdAt: string;
}

export interface Relatorio {
  id: string;
  fonte: 'genna' | 'manual' | 'web';
  perfilAnalisado: string | null;
  ferramenta: string | null;
  metricas: Record<string, unknown>;
  achados: unknown[];
  recomendacoes: unknown[];
  limitacoes: string | null;
  /** Resultado cru da tool Genna ({ok, texto, dados, links}) — dado não confiável, só leitura. */
  bruto: { ok?: boolean; texto?: string; dados?: unknown; links?: string[] } | null;
  criadoPor: string | null;
  createdAt: string;
}

export interface AgenteSpec {
  id: string;
  agentId: string | null;
  nome: string | null;
  especificacao: Record<string, unknown>;
  systemPrompt: string | null;
  testes: ResultadoTesteAgente[];
  approvalStatus: AprovacaoAgente;
  atualizadoPor: string | null;
  updatedAt: string;
}

export interface TarefaVinculada {
  id: string;
  taskId: string;
  secao: string | null;
  criterioAceite: string | null;
  evidencias: Evidencia[];
  createdAt: string;
  task: {
    id: string;
    numero: number;
    titulo: string;
    tipo: string;
    status: string;
    prioridade: string;
    prazoEm: string | null;
    responsavelId: string | null;
    arquivadaEm: string | null;
  } | null;
}

export interface Verificacao {
  id: string;
  chave: string;
  rotulo: string;
  secao: string;
  status: StatusVerificacao;
  obrigatorio: boolean;
  escopoKey: string | null;
  evidencias: Evidencia[];
  taskId: string | null;
  verificadoPor: string | null;
  verificadoEm: string | null;
}

export interface Aprovacao {
  id: string;
  acao: string;
  payload: Record<string, unknown>;
  solicitadoPor: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  decididoPor: string | null;
  justificativa: string | null;
  decididoEm: string | null;
  createdAt: string;
}

export interface EventoOb {
  id: string;
  tipo: string;
  dados: Record<string, unknown>;
  ator: string;
  createdAt: string;
}

export interface DetalheOnboarding {
  id: string;
  agencyId: string;
  clientAccountId: string;
  responsavelId: string | null;
  status: StatusOnboarding;
  etapaAtual: string | null;
  escopo: Escopo;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  cliente: { id: string; nome: string };
  knowledge: KnowledgeSecao[];
  meetings: Reuniao[];
  reports: Relatorio[];
  agent: AgenteSpec | null;
  tarefas: TarefaVinculada[];
  verifications: Verificacao[];
  approvals: Aprovacao[];
  events: EventoOb[];
}

export interface ConfConhecimento {
  secao: SecaoConhecimento;
  rotulo: string;
  pendente: boolean;
  confirmadoEm: string | null;
  camposFaltantes: string[];
  knowledgeId: string | null;
}

export interface ConfVerificacaoItem {
  id: string;
  chave: string;
  rotulo: string;
  status: StatusVerificacao;
  obrigatorio: boolean;
  /** Quantidade de evidências anexadas. */
  evidencias: number;
  taskId: string | null;
  verificadoPor: string | null;
  verificadoEm: string | null;
}

export interface ConfSecao {
  secao: string;
  status: StatusVerificacao;
  pendencias: number;
  itens: ConfVerificacaoItem[];
}

export interface ConfTarefaItem {
  taskId: string;
  numero: number;
  titulo: string;
  status: string;
  atrasada: boolean;
  responsavelId: string | null;
  criterioAceite: string | null;
}

export interface ConfTarefasSecao {
  secao: string;
  total: number;
  concluidas: number;
  atrasadas: number;
  itens: ConfTarefaItem[];
}

export interface Conferencia {
  onboardingId: string;
  status: StatusOnboarding;
  responsavelId: string | null;
  conhecimento: ConfConhecimento[];
  verificacoes: ConfSecao[];
  tarefas: ConfTarefasSecao[];
  escopo: Escopo;
}

export interface PendenciaFinalizacao {
  chave: string;
  rotulo: string;
  status: string;
}

// ───────────────────────────── filtros da visão ─────────────────────────────

export interface FiltrosVisao {
  status: StatusOnboarding | '';
  etapa: string;
  responsavel: string;
  cliente: string;
  de: string;
  ate: string;
  prioridade: Prioridade | '';
}

export const FILTROS_VAZIOS: FiltrosVisao = { status: '', etapa: '', responsavel: '', cliente: '', de: '', ate: '', prioridade: '' };

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Mapeia os filtros da tela para a query da API: só valores válidos, sem chave vazia. */
export function paraQueryVisao(f: FiltrosVisao): Record<string, string | undefined> {
  return {
    status: f.status && STATUS_ONBOARDING.includes(f.status) ? f.status : undefined,
    etapa: f.etapa.trim() ? f.etapa.trim().slice(0, 120) : undefined,
    responsavel: UUID.test(f.responsavel) ? f.responsavel : undefined,
    cliente: UUID.test(f.cliente) ? f.cliente : undefined,
    de: DIA.test(f.de) ? f.de : undefined,
    ate: DIA.test(f.ate) ? f.ate : undefined,
    prioridade: f.prioridade || undefined,
  };
}

/** Quantos filtros estão ligados (para o botão "Limpar filtros"). */
export function contarFiltros(f: FiltrosVisao): number {
  return Object.values(paraQueryVisao(f)).filter(Boolean).length;
}

/** Contadores por status completos: todo status aparece, mesmo sem item. */
export function contadoresPorStatus(contadores: Record<string, number>): { status: StatusOnboarding; total: number }[] {
  return STATUS_OB_ORDEM.map((status) => ({ status, total: contadores[status] ?? 0 }));
}

// ───────────────────────────── derivações ─────────────────────────────

/** Progresso de verificações em % (0 quando não há o que verificar). */
export function progressoPct(verificadas: number, total: number): number {
  return total > 0 ? Math.round((verificadas / total) * 100) : 0;
}

/** Conhecimento pendente = seção marcada como pendente OU com campo obrigatório vazio. */
export function secoesFaltantes(conf: Conferencia): ConfConhecimento[] {
  return conf.conhecimento.filter((c) => c.pendente || c.camposFaltantes.length > 0);
}

/**
 * O que falta para finalizar, derivado do painel de conferência: verificações
 * obrigatórias não verificadas (a aprovação final é concedida pela própria
 * ação de finalizar, então não entra). A palavra final é do POST /finalizar.
 */
export function pendenciasFinalizacao(conf: Conferencia): PendenciaFinalizacao[] {
  return conf.verificacoes.flatMap((s) =>
    s.itens.filter((v) => v.obrigatorio && v.chave !== 'aprovacao_final' && v.status !== 'verificado').map((v) => ({ chave: v.chave, rotulo: v.rotulo, status: v.status })),
  );
}

export interface EvidenciaAgregada {
  origem: 'verificacao' | 'tarefa';
  /** Rótulo da verificação ou título da tarefa. */
  origemRotulo: string;
  secao: string | null;
  evidencia: Evidencia;
}

/** Agrega as evidências registradas nas verificações e nas tarefas vinculadas (aba Arquivos e evidências). */
export function evidenciasAgregadas(d: Pick<DetalheOnboarding, 'verifications' | 'tarefas'>): EvidenciaAgregada[] {
  const out: EvidenciaAgregada[] = [];
  for (const v of d.verifications) {
    for (const e of Array.isArray(v.evidencias) ? v.evidencias : []) {
      out.push({ origem: 'verificacao', origemRotulo: v.rotulo, secao: v.secao, evidencia: e });
    }
  }
  for (const t of d.tarefas) {
    for (const e of Array.isArray(t.evidencias) ? t.evidencias : []) {
      out.push({ origem: 'tarefa', origemRotulo: t.task?.titulo ?? 'Tarefa', secao: t.secao, evidencia: e });
    }
  }
  return out;
}

/** Último resultado registrado por cenário (a API substitui o anterior). */
export function testesPorCenario(testes: readonly ResultadoTesteAgente[]): Map<string, ResultadoTesteAgente> {
  return new Map(testes.map((t) => [t.cenario, t]));
}

/** Rótulo amigável dos tipos de evento da timeline. */
const EVENTO_ROTULO: Record<string, string> = {
  'onboarding.iniciado': 'Onboarding iniciado',
  'onboarding.atualizado': 'Onboarding atualizado',
  'onboarding.escopo_alterado': 'Escopo alterado',
  'onboarding.conhecimento_atualizado': 'Conhecimento atualizado',
  'onboarding.reuniao_registrada': 'Reunião registrada',
  'onboarding.reuniao_atualizada': 'Reunião atualizada',
  'onboarding.tarefas_geradas': 'Tarefas geradas',
  'onboarding.relatorio_genna': 'Relatório do Genna salvo',
  'onboarding.agente_spec': 'Especificação do agente salva',
  'onboarding.agente_teste': 'Teste do agente registrado',
  'onboarding.verificacao': 'Verificação atualizada',
  'onboarding.aprovacao_solicitada': 'Aprovação solicitada',
  'onboarding.aprovacao_decidida': 'Aprovação decidida',
  'onboarding.finalizado': 'Onboarding finalizado',
};

export function rotuloEvento(tipo: string): string {
  return EVENTO_ROTULO[tipo] ?? tipo;
}

// ───────────────────────────── erros ─────────────────────────────

/** `code` do corpo RFC 7807 (ex.: `onboarding_pendencias`, `genna_nao_conectado`). */
export function codigoErro(e: unknown): string | null {
  return e instanceof ApiError && typeof e.body?.code === 'string' ? e.body.code : null;
}

export function mensagemErro(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    const b = e.body as { detail?: unknown; title?: unknown; message?: unknown };
    if (typeof b.detail === 'string' && b.detail) return b.detail;
    if (typeof b.title === 'string' && b.title) return b.title;
    if (typeof b.message === 'string' && b.message) return b.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return padrao;
}

/** Pendências do 409 do finalizar (`onboarding_pendencias`). */
export function pendenciasDoErro(e: unknown): PendenciaFinalizacao[] {
  if (!(e instanceof ApiError)) return [];
  const p = (e.body as { pendencias?: unknown }).pendencias;
  if (!Array.isArray(p)) return [];
  return p.filter((x): x is PendenciaFinalizacao => !!x && typeof x === 'object' && typeof (x as PendenciaFinalizacao).rotulo === 'string');
}

// ───────────────────────────── client ─────────────────────────────

const qs = (f: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const onboardingApi = {
  visao: (f: FiltrosVisao = FILTROS_VAZIOS) => req<VisaoExecutiva>(`onboarding${qs(paraQueryVisao(f))}`),
  /** Devolve a linha criada (não o detalhe completo) — a UI usa o `id` para navegar. */
  iniciar: (input: { clientAccountId: string; escopo: Partial<Escopo>; responsavelId?: string | null }) =>
    req<{ id: string }>('onboarding', json('POST', input)),
  detalhe: (id: string) => req<DetalheOnboarding>(`onboarding/${id}`),
  atualizar: (id: string, p: Partial<{ status: StatusOnboarding; etapaAtual: string | null; responsavelId: string | null; escopo: Partial<Escopo>; justificativa: string }>) =>
    req<{ ok: true; aprovacaoPendente: { id: string } | null }>(`onboarding/${id}`, json('PATCH', p)),
  salvarConhecimento: (id: string, secao: SecaoConhecimento, dados: Record<string, unknown>, pendente: boolean) =>
    req<KnowledgeSecao>(`onboarding/${id}/conhecimento/${secao}`, json('PUT', { dados, pendente })),
  historicoConhecimento: (id: string, secao: SecaoConhecimento) => req<KnowledgeHist[]>(`onboarding/${id}/conhecimento/${secao}/historico`),
  registrarReuniao: (id: string, r: Partial<{ tipo: string; data: string | null; participantes: string[]; pauta: string[]; resumo: string | null; decisoes: string[]; pendencias: string[] }>) =>
    req<Reuniao>(`onboarding/${id}/reunioes`, json('POST', r)),
  atualizarReuniao: (id: string, mid: string, r: Record<string, unknown>) => req<Reuniao>(`onboarding/${id}/reunioes/${mid}`, json('PATCH', r)),
  gerarTarefas: (id: string, atribuicoes: Partial<Record<PapelTarefa, string>>) =>
    req<{ criadas: { id: string; titulo: string; papel: string }[]; ignoradas: number; total: number }>(`onboarding/${id}/tarefas/gerar`, json('POST', { atribuicoes })),
  relatorioGenna: (id: string, input: { perfil: string; ferramenta: string; argumentos?: Record<string, unknown> }) =>
    req<Relatorio>(`onboarding/${id}/relatorios/genna`, json('POST', input)),
  relatorios: (id: string) => req<Relatorio[]>(`onboarding/${id}/relatorios`),
  salvarAgente: (id: string, input: { nome?: string | null; especificacao: Record<string, unknown>; systemPrompt?: string | null }) =>
    req<AgenteSpec>(`onboarding/${id}/agente`, json('PUT', input)),
  registrarTeste: (id: string, t: ResultadoTesteAgente) => req<AgenteSpec>(`onboarding/${id}/agente/testes`, json('POST', t)),
  conferencia: (id: string) => req<Conferencia>(`onboarding/${id}/conferencia`),
  verificar: (id: string, chave: string, input: { status: StatusVerificacao; evidencias?: Evidencia[]; semEvidencia?: boolean; motivo?: string }) =>
    req<Verificacao>(`onboarding/${id}/verificacoes/${chave}`, json('POST', input)),
  solicitarAprovacao: (id: string, acao: string, payload?: Record<string, unknown>) => req<Aprovacao>(`onboarding/${id}/aprovacoes`, json('POST', { acao, payload })),
  decidirAprovacao: (id: string, aid: string, aprovar: boolean, justificativa?: string) =>
    req<Aprovacao>(`onboarding/${id}/aprovacoes/${aid}/decisao`, json('POST', { aprovar, justificativa })),
  finalizar: (id: string) => req<{ id: string; status: 'pronto'; completedAt: string; jaFinalizado: boolean }>(`onboarding/${id}/finalizar`, json('POST')),
};
