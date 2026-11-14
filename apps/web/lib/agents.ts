'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente do KHUB Agent Intelligence (docs/AI_AGENT_ARCHITECTURE.md).
 * Tenant vem SEMPRE da sessão (proxy /api/v1 → JWT); a UI nunca envia tenant.
 * Toda regra (allowlist, limites, permissões) é validada no servidor: aqui só
 * há tipos e chamadas.
 */
const req = clienteApi('/api/v1/');
const json = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};

// ------------------------------------------------------------------ configuração

export type StatusAgente = 'rascunho' | 'ativo' | 'pausado' | 'arquivado';
export type Dimensao = 'formalidade' | 'proximidade' | 'empatia' | 'objetividade' | 'persuasao' | 'proatividade' | 'didatica' | 'assertividade' | 'humor' | 'sofisticacao' | 'linguagemTecnica' | 'naturalidade';
export type CampoComportamento = 'abertura' | 'apresentacao' | 'perguntas' | 'necessidades' | 'conducao' | 'objecoes' | 'reclamacoes' | 'indecisos' | 'intencaoCompra' | 'encerramento' | 'quandoTransferir' | 'quandoSilenciar' | 'quandoConsultarBase' | 'quandoExecutarAcoes';

export interface Condicao {
  campo: 'intencao' | 'objecao' | 'sentimento' | 'urgencia' | 'temperatura' | 'etapa' | 'palavra_chave' | 'interesse' | 'perfil';
  chave?: string;
  operador: 'igual' | 'diferente' | 'contem' | 'existe' | 'nao_existe';
  valor: string;
}
export type TipoAcaoRegra = 'instrucao' | 'transferir' | 'silenciar' | 'adicionar_tag' | 'remover_tag' | 'acionar_workflow' | 'iniciar_followup' | 'mover_etapa' | 'notificar_equipe' | 'consultar_base';
export interface AcaoRegra {
  tipo: TipoAcaoRegra;
  valor: string;
}
export interface Regra {
  id: string;
  nome: string;
  ativo: boolean;
  logica: 'e' | 'ou';
  condicoes: Condicao[];
  acoes: AcaoRegra[];
  umaVezPorConversa: boolean;
}

export interface Fragmentacao {
  ativo: boolean;
  minBlocos: number;
  maxBlocos: number;
  maxCaracteresBloco: number;
  maxPalavrasBloco: number;
  maxEmojisBloco: number;
  intervaloMinMs: number;
  intervaloMaxMs: number;
  digitacaoCps: number;
  preferirCurtas: boolean;
  tamanhoMedio: number;
  pontuacao: 'preservar' | 'leve';
  quebraSemantica: 'ideias' | 'frases' | 'paragrafos';
}

export interface AgentConfig {
  identidade: {
    avatarUrl: string | null;
    cargo: string;
    especialidade: string;
    segmento: string;
    empresaRepresentada: string;
    objetivoPrincipal: string;
    objetivosSecundarios: string[];
    publico: string;
    idioma: 'pt-BR' | 'en' | 'es';
    nivelConhecimento: 'basico' | 'intermediario' | 'especialista';
    perfilProfissional: string;
    limitesAtuacao: string[];
  };
  personalidade: Record<Dimensao, number> & { perfil: string };
  comportamento: Record<CampoComportamento, string>;
  regras: Regra[];
  comunicacao: {
    fragmentacao: Fragmentacao;
    emojis: 'nunca' | 'raro' | 'moderado';
    usarNome: 'natural' | 'sempre' | 'nunca';
    evitarRepeticao: boolean;
    reapresentar: boolean;
  };
  inteligencia: {
    analiseAtiva: boolean;
    modeloAnalise: string | null;
    effort: 'low' | 'medium' | 'high';
    maxTokens: number;
    timeoutMs: number;
    janelaHistorico: number;
    autonomia: 'conservadora' | 'equilibrada' | 'proativa';
    tentativas: number;
    modeloFallback: string | null;
    orcamentoUsdConversa: number;
    orcamentoUsdDiario: number;
    limiarConfianca: number;
  };
  conhecimento: { somenteFontesDoAgente: boolean; categorias: string[]; consultarEm: string[]; maxTrechos: number };
  memoria: { curtoPrazo: boolean; longoPrazo: boolean; operacional: boolean; resumirAPartirDe: number; retencaoDias: number };
  crm: { camposAutomaticos: string[]; sincronizarContato: ('nome' | 'email' | 'empresa')[]; mapaCamposCustom: Record<string, string>; limiarConfiancaAuto: number };
  permissoes: { exigirConfirmacao: string[]; acoesPorRegra: boolean; workflowsPermitidos: string[]; etapasPermitidas: string[] };
  /** Horário de atendimento (ADR-0042). Desligado = 24h. */
  horario: ConfigHorario;
  /**
   * Modo de atendimento (estilo GHL). Ausente = 'automatico'.
   * - automatico (piloto automático): como agente principal, responde em toda conversa do canal que não está com humano;
   * - sugestivo: não responde sozinho; só nas conversas em que foi ATIVADO (nó "Ativar IA" ou botão na conversa).
   * Desativado não é modo: é `status !== 'ativo'`.
   */
  modo?: ModoAgente;
}
export type ModoAgente = 'automatico' | 'sugestivo';
export type DiaSemanaAgente = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';
export interface ConfigHorario {
  ativo: boolean;
  fuso: string;
  dias: Record<DiaSemanaAgente, { inicio: string; fim: string }[]>;
  feriados: string[];
  foraDoHorario: 'responder_na_abertura' | 'avisar_e_responder_na_abertura' | 'transferir_para_equipe';
  mensagemFora: string;
}
export type SecaoConfig = keyof AgentConfig;

export interface Agente {
  id: string;
  nome: string;
  descricao: string | null;
  status: StatusAgente;
  modelo: string;
  instrucoes: string;
  tom: string;
  personalidade: string;
  ferramentas: string[];
  conhecimentoAtivo: boolean;
  conhecimentoEscopos: string[];
  maxRespostasConversa: number;
  maxCaracteres: number;
  canais: string[];
  padrao: boolean;
  config: AgentConfig;
  versaoPublicadaId: string | null;
  versaoPublicada?: { id: string; numero: number; publicadaEm?: string } | null;
  alteracoesNaoPublicadas?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgenteResumo extends Agente {
  metricas7d: { respondidas: number; transferidas: number; erros: number; custoUsd: number; tokens: number };
  conversasAtivas: number;
  fontesConhecimento: number;
  aprovacoesPendentes: number;
}

export interface FerramentaCatalogo {
  nome: string;
  rotulo: string;
  descricao: string;
  tipo: 'leitura' | 'escrita';
  grupo: 'conhecimento' | 'contato' | 'pipeline' | 'tarefas' | 'agenda' | 'atendimento' | 'automacao';
  critica: boolean;
  obrigatoria: boolean;
}

export interface CatalogoAgentes {
  modelos: { id: string; nome: string; descricao: string; entradaUsdPorMilhao: number; saidaUsdPorMilhao: number }[];
  modeloPadrao: string;
  tons: { id: string; nome: string; instrucao: string }[];
  ferramentas: FerramentaCatalogo[];
  escopos: { id: string; nome: string }[];
  canais: string[];
  personalidade: { dimensoes: Dimensao[]; perfis: { id: string; nome: string; valores: Record<Dimensao, number>; embutido: boolean }[] };
  comportamento: CampoComportamento[];
  regras: { campos: Condicao['campo'][]; operadores: Condicao['operador'][]; acoes: TipoAcaoRegra[] };
  intencoesBase: string[];
  objecoes: string[];
  camposPerfil: string[];
  estrategiasFollowup: { id: string; nome: string; objetivo: string; instrucoes: string; intervalos: number[]; tentativas: number }[];
  tiposFonte: string[];
  personas: { id: string; nome: string; descricao: string }[];
  configPadrao: AgentConfig;
  ia: { configurada: boolean; faltando: string[]; provedor?: string };
}

/** Campos editáveis (o formulário manda só o que mudou). */
export type AgenteInput = Partial<Omit<Agente, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'config' | 'versaoPublicadaId' | 'versaoPublicada' | 'alteracoesNaoPublicadas'>> & {
  config?: Partial<{ [K in SecaoConfig]: Partial<AgentConfig[K]> | AgentConfig[K] }>;
};

// ------------------------------------------------------------------ dashboard / analytics / logs

export interface Dashboard {
  periodoDias: number;
  agentes: { total: number; ativos: number; pausados: number; rascunhos: number; emTreinamento: number };
  conversasAtendidas: number;
  mensagensEnviadas: number;
  leadsQualificados: number;
  followupsEnviados: number;
  oportunidadesRecuperadas: number;
  agendamentos: number;
  conversoes: number;
  taxaTransferencia: number;
  execucoes: Record<string, number>;
  tokens: number;
  custoUsd: number;
  documentosProcessando: number;
  aprovacoesPendentes: number;
  errosRecentes: { id: string; agentId: string | null; agente: string | null; motivo: string | null; createdAt: string; conversationId: string }[];
  ultimasAtividades: { id: string; agentId: string | null; agente: string | null; status: string; intencao: string | null; motivo: string | null; createdAt: string; conversationId: string; blocos: number; custoUsd: number }[];
}

export interface AnalyticsAgente {
  agente: { id: string; nome: string };
  periodoDias: number;
  resumo: { execucoes: number; conversas: number; taxaTransferencia: number; taxaErro: number; custoUsd: number; tokens: number; latenciaP50Ms: number | null; latenciaP95Ms: number | null };
  serie: { dia: string; respondido: number; transferido: number; erro: number; ignorado: number; custoUsd: number; tokens: number }[];
  intencoes: { intencao: string | null; n: number }[];
  sentimentos: { sentimento: string | null; n: number }[];
  objecoes: { objecao: string; n: number }[];
  lacunas: { pergunta: string; n: number }[];
  entregas: Record<string, number>;
  followups: { status: string; estrategia: string; n: number }[];
  ferramentas: { ferramenta: string; status: string; n: number }[];
  versoes: {
    versoes: { versionId: string; numero: number; publicadaEm: string; execucoes: number; taxaTransferencia: number; taxaErro: number; taxaGuardrail: number; confiancaMedia: number | null; piorou: boolean }[];
    semVersao: { execucoes: number; taxaTransferencia: number } | null;
  };
}

export interface TraceRun {
  decisao?: string;
  motivo?: string | null;
  analise?: { intencao: string; intencoesSecundarias: string[]; confiancaIntencao: number; problema: string; objecoes: string[]; sentimento: string; urgencia: string; temperatura: string; interesse: string; precisaConhecimento: boolean; pedeHumano: boolean; consultaBase: string; proximoPasso: string; fonte: 'modelo' | 'heuristica' };
  regras?: { disparadas: { regraId: string; nome: string }[]; instrucoes: string[]; acoes: { acao: string; ok: boolean; pendente?: boolean; erro?: string }[]; iniciarFollowup: string | null };
  conhecimento?: { consulta: string | null; confianca: { nivel: string; motivo: string } | null; conflitos: string[]; fontes: { chunkId: string; titulo: string }[] };
  memoria?: { resumo: boolean; longoPrazo: number; operacional: number };
  extracoes?: { campo: string; valor: string; origem: string; confianca: number; decisao: string; motivo: string }[];
  ferramentas?: { nome: string; ok: boolean; pendente?: boolean; erro?: string }[];
  validacao?: string[];
  guardrail?: { regra: string; motivo: string } | null;
  fragmentacao?: { estrategia: string; ajustes: string[]; blocos: { ordem: number; caracteres: number; atrasoMs: number }[] };
  modelos?: string[];
  tempos?: { analiseMs: number; conhecimentoMs: number; geracaoMs: number; totalMs: number };
  sequenciaId?: string | null;
}

export interface RunLog {
  id: string;
  agentId: string | null;
  conversationId: string;
  messageId: string;
  status: string;
  motivo: string | null;
  intencao: string | null;
  sentimento: string | null;
  urgencia: string | null;
  confianca: number | null;
  blocos: number;
  modelo: string | null;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  latenciaMs: number | null;
  versionId: string | null;
  trace: TraceRun;
  mensagem: string | null;
  createdAt: string;
}

export interface ExecucaoFerramenta {
  id: string;
  agentId: string | null;
  runId: string | null;
  conversationId: string | null;
  contactId: string | null;
  ferramenta: string;
  args: Record<string, unknown>;
  resultado: Record<string, unknown> | null;
  status: string;
  erro: string | null;
  origem: string;
  latenciaMs: number | null;
  aprovadoPor: string | null;
  decididoEm: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ conhecimento

export interface FonteConhecimento {
  id: string;
  documentId: string;
  titulo: string;
  tipo: string;
  uri: string | null;
  mime: string;
  status: 'pending' | 'processing' | 'published' | 'failed' | 'superseded' | 'candidate';
  erro: string | null;
  indexacao: 'lexical' | 'hibrida' | null;
  tamanhoBytes: number | null;
  caracteres: number | null;
  chunks: number;
  categoria: string;
  ativo: boolean;
  versao: number;
  createdAt: string;
  atualizadoEm: string;
  processadoEm: string | null;
}
export interface ListaConhecimento {
  itens: FonteConhecimento[];
  resumo: { total: number; ativos: number; processando: number; falhas: number; chunks: number; categorias: string[] };
}
export interface NovaFonte {
  tipo: string;
  titulo: string;
  categoria?: string;
  texto?: string;
  url?: string;
  arquivoBase64?: string;
  nomeArquivo?: string;
}
export interface ResultadoBusca {
  hits: { chunkId: string; documentId: string; titulo: string; escopo: string; breadcrumb: string | null; conteudo: string; score: number }[];
  confianca: { nivel: 'alta' | 'media' | 'baixa' | 'nenhuma'; motivo: string };
  conflitos: string[];
  latenciaMs: number;
  escopos: string[];
  filtradoPorFontes: boolean;
}

// ------------------------------------------------------------------ memória / perfil / follow-up

export interface Memoria {
  id: string;
  contactId: string | null;
  contatoNome: string | null;
  conversationId: string | null;
  agentId: string | null;
  camada: 'curto' | 'longo' | 'operacional';
  tipo: string;
  conteudo: string;
  importancia: number;
  origem: string;
  expiraEm: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FatoPerfil {
  id: string;
  campo: string;
  valor: unknown;
  origem: 'declarado' | 'inferido' | 'humano' | 'crm';
  confianca: number;
  status: 'confirmado' | 'pendente' | 'rejeitado';
  identificadoEm: string;
  atualizadoEm: string;
}
export interface PerfilContato {
  contato: { id: string; nome: string; telefone: string | null; email: string | null; empresa: string | null; tags: string[]; optedOutAt: string | null };
  perfil: { resumo: string; temperatura: string | null; intencao: string | null; sentimento: string | null; urgencia: string | null; etapa: string | null; proximaAcao: string | null; convertidoEm: string | null; motivoNaoConversao: string | null; ultimaInteracaoAt: string | null } | null;
  fatos: FatoPerfil[];
  extracoes: { id: string; campo: string; valor: unknown; origem: string; confianca: number; decisao: string; motivo: string | null; createdAt: string }[];
  followups: Followup[];
  memorias: Memoria[];
}

export interface RegraFollowup {
  id: string | null;
  agentId: string;
  estrategia: string;
  nome: string;
  ativo: boolean;
  maxTentativas: number;
  intervalosHoras: number[];
  horarioInicio: number;
  horarioFim: number;
  diasSemana: number[];
  fuso: string;
  objetivo: string;
  tom: string;
  instrucoes: string;
  pararSe: string[];
  maxMensagensDia: number;
  prioridade: number;
  salva: boolean;
  catalogo: { nome: string; objetivo: string; instrucoes: string; intervalos: number[]; tentativas: number };
}
export interface Followup {
  id: string;
  agentId: string;
  ruleId: string;
  contactId: string;
  contatoNome?: string | null;
  conversationId: string;
  cicloId: string;
  estrategia: string;
  tentativa: number;
  status: 'agendado' | 'gerando' | 'enviado' | 'cancelado' | 'pulado' | 'falhou';
  agendadoPara: string;
  executadoEm: string | null;
  motivo: string | null;
  mensagem: string | null;
  createdAt: string;
}
export interface Entrega {
  id: string;
  conversationId: string;
  runId: string | null;
  followupId: string | null;
  sequenciaId: string;
  ordem: number;
  total: number;
  texto: string;
  atrasoMs: number;
  status: string;
  tentativas: number;
  agendadoPara: string;
  enviadoEm: string | null;
  motivo: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ aprendizado / avaliação / versões / simulador

export interface Proposta {
  id: string;
  agentId: string;
  tipo: 'prompt' | 'comportamento' | 'conhecimento' | 'ferramenta';
  chave: string;
  titulo: string;
  descricao: string;
  evidencias: Record<string, unknown>[];
  patch: Record<string, unknown> | null;
  conteudoSugerido: string | null;
  ocorrencias: number;
  status: 'aberta' | 'em_avaliacao' | 'aprovada' | 'rejeitada' | 'aplicada';
  avaliacaoId: string | null;
  decididoEm: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ResumoAprendizado {
  eventos: Record<string, number>;
  padroes: { tipo: string; chave: string; ocorrencias: number }[];
  propostas: Record<string, number>;
}
export interface Expectativas {
  deveConter?: string[];
  naoDeveConter?: string[];
  intencaoEsperada?: string;
  deveTransferir?: boolean;
  ferramentasEsperadas?: string[];
  exigeFonte?: boolean;
  maxBlocos?: number;
}
export interface Cenario {
  id: string;
  nome: string;
  mensagens: { de: 'contato' | 'ia'; texto: string }[];
  expectativas: Expectativas;
  ativo: boolean;
  origem: string;
  createdAt: string;
}
export interface ResultadoCenario {
  cenarioId: string;
  nome: string;
  nota: number;
  checagens: { nome: string; ok: boolean; critica: boolean; detalhe: string }[];
  juiz: { qualidade: number; precisao: number; aderenciaBase: number; naturalidade: number; resolucao: number; alucinacao: boolean; comentario: string } | null;
  saida: { texto: string; blocos: number; transferiu: boolean; intencao: string | null; ferramentas: string[]; fontes: number };
  erro?: string;
}
export interface Avaliacao {
  id: string;
  alvo: 'rascunho' | 'versao' | 'proposta';
  status: 'executando' | 'concluida' | 'falhou';
  nota: string | number | null;
  regressao: boolean;
  versionId: string | null;
  propostaId: string | null;
  custoUsd: string | number;
  comparacao: { regressao: boolean; delta: number | null; pioraram: string[]; notaReferencia: number | null } | null;
  metricas: Record<string, unknown>;
  resultados?: ResultadoCenario[];
  erro: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface VersaoResumo {
  id: string;
  numero: number;
  origem: 'publicacao' | 'restauracao' | 'proposta';
  notas: string | null;
  publicadoPor: string | null;
  createdAt: string;
  atual: boolean;
  avaliacao: { id: string; nota: number | null; regressao: boolean } | null;
  mudancas: string[];
}
export interface DiffVersao {
  publicada: { id: string; numero: number } | null;
  mudancas: { campo: string; antes: unknown; depois: unknown }[];
  pendente: boolean;
}

export interface TraceSimulacao extends TraceRun {
  tipo: 'turno';
  recebido: string[];
  resposta: string;
  blocos: { ordem: number; texto: string; atrasoMs: number }[];
  tokens: { entrada: number; saida: number };
  custoUsd: number;
  execucaoMs: number;
  versao: 'publicada' | 'rascunho';
  perfilDepois: Record<string, { valor: unknown; origem: string; status: string; confianca: number }>;
}
export interface Simulacao {
  id: string;
  agentId: string;
  perfil: string;
  mensagens: { de: 'contato' | 'ia'; texto: string; em: string }[];
  traces: (TraceSimulacao | { tipo: 'sessao'; contactId: string | null; usarRascunho: boolean })[];
  custoUsd: string | number;
  createdAt: string;
  updatedAt: string;
}

export interface IntencaoPersonalizada {
  id: string;
  chave: string;
  nome: string;
  descricao: string;
  exemplos: string[];
  ativo: boolean;
}

// ------------------------------------------------------------------ chamadas

export const agentesApi = {
  catalogo: () => req<CatalogoAgentes>('agents/catalogo'),
  dashboard: (dias = 30) => req<Dashboard>(`agents/dashboard${qs({ dias })}`),
  listar: () => req<AgenteResumo[]>('agents'),
  arquivados: () => req<{ id: string; nome: string; updatedAt: string }[]>('agents/arquivados'),
  obter: (id: string) => req<Agente>(`agents/${id}`),
  criar: (input: AgenteInput & { nome: string }) => req<Agente>('agents', { method: 'POST', ...json(input) }),
  atualizar: (id: string, input: AgenteInput) => req<Agente>(`agents/${id}`, { method: 'PATCH', ...json(input) }),
  status: (id: string, status: Exclude<StatusAgente, 'rascunho'>) => req<Agente>(`agents/${id}/status`, { method: 'POST', ...json({ status }) }),
  duplicar: (id: string, nome?: string) => req<Agente>(`agents/${id}/duplicar`, { method: 'POST', ...json({ nome }) }),
  excluir: (id: string, confirmacao: string) => req<{ ok: true }>(`agents/${id}`, { method: 'DELETE', ...json({ confirmacao }) }),

  intencoes: () => req<IntencaoPersonalizada[]>('agents/intencoes'),
  salvarIntencao: (i: Omit<IntencaoPersonalizada, 'id'>) => req<IntencaoPersonalizada>('agents/intencoes', { method: 'POST', ...json(i) }),
  removerIntencao: (id: string) => req<{ ok: true }>(`agents/intencoes/${id}`, { method: 'DELETE' }),
  previaFragmentacao: (texto: string, fragmentacao: Fragmentacao) => req<{ blocos: { ordem: number; texto: string; atrasoMs: number }[]; estrategia: string; ajustes: string[] }>('agents/fragmentar-previa', { method: 'POST', ...json({ texto, fragmentacao }) }),
  salvarPerfilPersonalidade: (nome: string, valores: Record<string, number>) => req<{ id: string }>('agents/personalidades', { method: 'POST', ...json({ nome, valores }) }),

  conhecimento: (id: string) => req<ListaConhecimento>(`agents/${id}/conhecimento`),
  adicionarFonte: (id: string, f: NovaFonte) => req<{ id: string; documentId: string; status: string; duplicado: boolean; caracteres: number }>(`agents/${id}/conhecimento`, { method: 'POST', ...json(f) }),
  atualizarFonte: (id: string, fonteId: string, d: { categoria?: string; ativo?: boolean; titulo?: string }) => req<unknown>(`agents/${id}/conhecimento/${fonteId}`, { method: 'PATCH', ...json(d) }),
  reprocessarFonte: (id: string, fonteId: string) => req<{ id: string; status: string }>(`agents/${id}/conhecimento/${fonteId}/reprocessar`, { method: 'POST' }),
  removerFonte: (id: string, fonteId: string) => req<{ ok: true; documentoApagado: boolean }>(`agents/${id}/conhecimento/${fonteId}`, { method: 'DELETE' }),
  conteudoFonte: (id: string, fonteId: string) => req<{ titulo: string; fonte: string; uri: string | null; textoFonte: string | null; status: string; erro: string | null; chunks: { id: string; ordem: number; breadcrumb: string | null; conteudo: string; tokens: number }[] }>(`agents/${id}/conhecimento/${fonteId}/conteudo`),
  documentosDisponiveis: (id: string) => req<{ id: string; titulo: string; fonte: string; status: string; createdAt: string }[]>(`agents/${id}/conhecimento-disponivel`),
  vincularDocumento: (id: string, documentId: string, categoria?: string) => req<unknown>(`agents/${id}/conhecimento-vincular`, { method: 'POST', ...json({ documentId, categoria }) }),
  testarConhecimento: (id: string, pergunta: string, categorias?: string[]) => req<ResultadoBusca>(`agents/${id}/conhecimento-testar`, { method: 'POST', ...json({ pergunta, categorias }) }),

  memorias: (id: string, f: { contactId?: string; camada?: string; cursor?: string } = {}) => req<{ itens: Memoria[]; nextCursor: string | null }>(`agents/${id}/memorias${qs(f)}`),
  criarMemoria: (id: string, m: { contactId?: string; camada: Memoria['camada']; tipo: string; conteudo: string; importancia?: number }) => req<Memoria>(`agents/${id}/memorias`, { method: 'POST', ...json(m) }),
  atualizarMemoria: (memId: string, d: { conteudo?: string; importancia?: number }) => req<{ ok: true }>(`agents/memorias/${memId}`, { method: 'PATCH', ...json(d) }),
  removerMemoria: (memId: string) => req<{ ok: true }>(`agents/memorias/${memId}`, { method: 'DELETE' }),

  perfil: (contactId: string) => req<PerfilContato>(`agents/perfis/${contactId}`),
  decidirFato: (contactId: string, campo: string, acao: 'confirmar' | 'rejeitar' | 'editar', valor?: string) => req<FatoPerfil>(`agents/perfis/${contactId}/fatos/${campo}`, { method: 'POST', ...json({ acao, valor }) }),
  marcarConversao: (contactId: string, convertido: boolean, motivoNaoConversao?: string) => req<unknown>(`agents/perfis/${contactId}/conversao`, { method: 'POST', ...json({ convertido, motivoNaoConversao }) }),
  excluirPerfil: (contactId: string) => req<Record<string, number>>(`agents/perfis/${contactId}`, { method: 'DELETE' }),

  regrasFollowup: (id: string) => req<RegraFollowup[]>(`agents/${id}/followups/regras`),
  salvarRegraFollowup: (id: string, estrategia: string, d: Partial<Omit<RegraFollowup, 'id' | 'agentId' | 'estrategia' | 'salva' | 'catalogo'>>) => req<RegraFollowup>(`agents/${id}/followups/regras/${estrategia}`, { method: 'PATCH', ...json(d) }),
  followups: (id: string, f: { status?: string; contactId?: string } = {}) => req<Followup[]>(`agents/${id}/followups${qs(f)}`),
  iniciarFollowup: (id: string, contactId: string, estrategia: string) => req<{ agendado: boolean; motivo?: string }>(`agents/${id}/followups/iniciar`, { method: 'POST', ...json({ contactId, estrategia }) }),
  cancelarFollowup: (fid: string) => req<{ ok: true }>(`agents/followups/${fid}/cancelar`, { method: 'POST' }),
  reagendarFollowup: (fid: string, para: string) => req<{ ok: true }>(`agents/followups/${fid}/reagendar`, { method: 'POST', ...json({ para }) }),

  entregas: (id: string, status?: string) => req<Entrega[]>(`agents/${id}/entregas${qs({ status })}`),
  execucoesFerramentas: (id: string, status?: string) => req<ExecucaoFerramenta[]>(`agents/${id}/ferramentas${qs({ status })}`),
  aprovacoes: () => req<ExecucaoFerramenta[]>('agents/aprovacoes'),
  aprovar: (execId: string) => req<{ ok: boolean; erro?: string }>(`agents/ferramentas/${execId}/aprovar`, { method: 'POST' }),
  rejeitar: (execId: string) => req<{ ok: true }>(`agents/ferramentas/${execId}/rejeitar`, { method: 'POST' }),

  analytics: (id: string, dias = 30) => req<AnalyticsAgente>(`agents/${id}/analytics${qs({ dias })}`),
  logs: (id: string, f: { status?: string; intencao?: string; cursor?: string } = {}) => req<{ itens: RunLog[]; nextCursor: string | null }>(`agents/${id}/logs${qs(f)}`),

  aprendizado: (id: string) => req<ResumoAprendizado>(`agents/${id}/aprendizado`),
  eventosAprendizado: (id: string, f: { tipo?: string; cursor?: string } = {}) => req<{ itens: { id: string; tipo: string; chave: string; detalhe: Record<string, unknown>; createdAt: string; conversationId: string | null }[]; nextCursor: string | null }>(`agents/${id}/aprendizado/eventos${qs(f)}`),
  analisarAprendizado: (id: string) => req<{ correcoesColetadas: number; padroes: number; propostasCriadas: number; propostasAtualizadas: number; custoUsd: number }>(`agents/${id}/aprendizado/analisar`, { method: 'POST' }),
  feedback: (id: string, d: { nota: 1 | -1; messageId?: string; conversationId?: string; comentario?: string; respostaSugerida?: string }) => req<{ ok: true }>(`agents/${id}/feedback`, { method: 'POST', ...json(d) }),
  propostas: (id: string, status?: string) => req<Proposta[]>(`agents/${id}/propostas${qs({ status })}`),
  aprovarProposta: (pid: string, d: { conteudo?: string; publicar?: boolean; forcar?: boolean }) => req<{ status: string; avaliacaoId?: string }>(`agents/propostas/${pid}/aprovar`, { method: 'POST', ...json(d) }),
  rejeitarProposta: (pid: string) => req<{ ok: true }>(`agents/propostas/${pid}/rejeitar`, { method: 'POST' }),

  cenarios: (id: string) => req<Cenario[]>(`agents/${id}/cenarios`),
  criarCenario: (id: string, c: { nome: string; mensagens: Cenario['mensagens']; expectativas?: Expectativas }) => req<Cenario>(`agents/${id}/cenarios`, { method: 'POST', ...json(c) }),
  atualizarCenario: (id: string, cid: string, c: Partial<Pick<Cenario, 'nome' | 'ativo' | 'expectativas' | 'mensagens'>>) => req<{ ok: true }>(`agents/${id}/cenarios/${cid}`, { method: 'PATCH', ...json(c) }),
  removerCenario: (id: string, cid: string) => req<{ ok: true }>(`agents/${id}/cenarios/${cid}`, { method: 'DELETE' }),
  avaliacoes: (id: string) => req<Avaliacao[]>(`agents/${id}/avaliacoes`),
  avaliacao: (aid: string) => req<Avaliacao>(`agents/avaliacoes/${aid}`),
  iniciarAvaliacao: (id: string, alvo: 'rascunho' | 'versao', versionId?: string) => req<Avaliacao>(`agents/${id}/avaliacoes`, { method: 'POST', ...json({ alvo, versionId }) }),

  versoes: (id: string) => req<VersaoResumo[]>(`agents/${id}/versoes`),
  diffVersao: (id: string, versionId?: string) => req<DiffVersao>(`agents/${id}/versoes-diff${qs({ versionId })}`),
  publicar: (id: string, notas?: string, forcar?: boolean) => req<{ versao: { id: string; numero: number }; avaliado: boolean; regressaoIgnorada: boolean }>(`agents/${id}/publicar`, { method: 'POST', ...json({ notas, forcar }) }),
  restaurar: (id: string, versionId: string) => req<{ versao: { id: string; numero: number } }>(`agents/${id}/versoes/${versionId}/restaurar`, { method: 'POST' }),

  personas: () => req<{ id: string; nome: string; descricao: string; mensagensIniciais: string[] }[]>('agents/simulador/personas'),
  simulacoes: (id: string) => req<Pick<Simulacao, 'id' | 'perfil' | 'createdAt' | 'updatedAt' | 'custoUsd' | 'mensagens'>[]>(`agents/${id}/simulacoes`),
  criarSimulacao: (id: string, d: { perfil?: string; contactId?: string; usarRascunho?: boolean }) => req<Simulacao>(`agents/${id}/simulacoes`, { method: 'POST', ...json(d) }),
  simulacao: (sid: string) => req<Simulacao>(`agents/simulacoes/${sid}`),
  turno: (sid: string, mensagens: string[]) => req<{ resposta: { de: 'ia'; texto: string; em: string }[]; trace: TraceSimulacao; decisao: string; iaConfigurada: boolean }>(`agents/simulacoes/${sid}/turno`, { method: 'POST', ...json({ mensagens }) }),
  clienteAutomatico: (sid: string) => req<{ mensagem: string }>(`agents/simulacoes/${sid}/cliente`, { method: 'POST' }),
  cenarioDaSimulacao: (sid: string, nome: string, expectativas?: Expectativas) => req<Cenario>(`agents/simulacoes/${sid}/cenario`, { method: 'POST', ...json({ nome, expectativas }) }),
  removerSimulacao: (sid: string) => req<{ ok: true }>(`agents/simulacoes/${sid}`, { method: 'DELETE' }),

  // ---- Studio (ao vivo): cockpit "ver funcionando na prática" ----
  studioConversas: (id: string) => req<ConversaAoVivo[]>(`agents/${id}/studio/conversas`),
  studioAtividade: (id: string, limite = 15) => req<RunAtividade[]>(`agents/${id}/studio/atividade?limite=${limite}`),
  studioAnalisar: (id: string) => req<AnalisePrompt>(`agents/${id}/studio/analisar`, { method: 'POST' }),
  studioTestarWhatsApp: (id: string, contactId: string) => req<{ conversaId: string; contatoNome: string; atendimento: string; agentId: string | null }>(`agents/${id}/studio/testar-whatsapp`, { method: 'POST', ...json({ contactId }) }),
  assistentePrompt: (input: { nome?: string; foco: string; descricao: string; instrucoesAtuais?: string }) => req<RascunhoPrompt>('agents/studio/assistente-prompt', { method: 'POST', ...json(input) }),
  analisarRascunho: (input: { nome?: string; foco?: string; instrucoes: string; tom?: string; conhecimentoAtivo?: boolean }) => req<AnalisePrompt>('agents/studio/analisar', { method: 'POST', ...json(input) }),
};

// ------------------------------------------------------------------ studio (ao vivo)

export interface ConversaAoVivo {
  id: string;
  canal: string;
  naoLidas: number;
  atualizadaEm: string;
  contato: { id: string; nome: string; telefone: string | null; fotoUrl: string | null } | null;
  ultima: { texto: string; de: string; em: string } | null;
}

/** Run do agente com o trace real (decisões e resultados, sem raciocínio privado). */
export interface RunAtividade {
  id: string;
  conversaId: string;
  contatoNome: string;
  status: string;
  motivo: string | null;
  intencao: string | null;
  confianca: number | null;
  trace: {
    decisao?: string;
    conhecimento?: { consulta?: string | null; confianca?: number; fontes?: { chunkId: string; titulo: string | null }[] };
    regras?: { disparadas?: { regraId: string; nome: string }[] };
    ferramentas?: { ferramenta: string; ok: boolean; pendente?: boolean; erro?: string }[];
    fragmentacao?: { blocos?: { ordem: number; caracteres: number; atrasoMs: number }[] };
    guardrail?: { ok?: boolean; motivo?: string };
    tempos?: Record<string, number>;
  };
  modelo: string | null;
  latenciaMs: number | null;
  criadoEm: string;
  finalizadoEm: string | null;
}

export interface AnalisePrompt {
  nota: number;
  faltando: string[];
  sugestoes: string[];
}

export interface RascunhoPrompt {
  instrucoes: string;
  tom?: string;
  personalidade?: string;
}


// ------------------------------------------------------------------ rótulos (exibição)

export const ROTULO_STATUS: Record<StatusAgente, string> = { rascunho: 'Rascunho', ativo: 'Ativo', pausado: 'Pausado', arquivado: 'Arquivado' };

export const ROTULO_INTENCAO: Record<string, string> = {
  saudacao: 'Saudação',
  duvida: 'Dúvida',
  interesse: 'Interesse',
  compra: 'Compra',
  orcamento: 'Orçamento',
  agendamento: 'Agendamento',
  objecao: 'Objeção',
  reclamacao: 'Reclamação',
  cancelamento: 'Cancelamento',
  suporte: 'Suporte',
  negociacao: 'Negociação',
  comparacao: 'Comparação',
  desinteresse: 'Desinteresse',
  solicitacao_humana: 'Pediu humano',
};

export const ROTULO_OBJECAO: Record<string, string> = { preco: 'Preço', tempo: 'Tempo', confianca: 'Confiança', concorrente: 'Concorrência', necessidade: 'Necessidade', decisor: 'Decisor ausente', adiamento: 'Adiamento', outra: 'Outra' };

export const ROTULO_CAMPO_PERFIL: Record<string, string> = {
  nome: 'Nome',
  email: 'E-mail',
  telefone: 'Telefone',
  empresa: 'Empresa',
  servico_interesse: 'Serviço de interesse',
  produto_interesse: 'Produto de interesse',
  problema_principal: 'Problema principal',
  problemas_secundarios: 'Problemas secundários',
  objetivos: 'Objetivos',
  necessidades: 'Necessidades',
  objecoes: 'Objeções',
  orcamento: 'Orçamento',
  urgencia: 'Urgência',
  intencao_compra: 'Intenção de compra',
  temperatura: 'Temperatura',
  etapa: 'Etapa',
  proxima_acao: 'Próxima ação',
  motivo_nao_conversao: 'Motivo de não conversão',
  preferencias: 'Preferências',
  disponibilidade: 'Disponibilidade',
};

export const ROTULO_DIMENSAO: Record<Dimensao, [string, string, string]> = {
  formalidade: ['Formalidade', 'Informal', 'Formal'],
  proximidade: ['Proximidade', 'Distante', 'Próximo'],
  empatia: ['Empatia', 'Factual', 'Acolhedor'],
  objetividade: ['Objetividade', 'Contextual', 'Direto'],
  persuasao: ['Persuasão', 'Neutro', 'Persuasivo'],
  proatividade: ['Proatividade', 'Reativo', 'Proativo'],
  didatica: ['Didática', 'Sucinto', 'Explicativo'],
  assertividade: ['Assertividade', 'Cauteloso', 'Firme'],
  humor: ['Humor', 'Sério', 'Bem-humorado'],
  sofisticacao: ['Sofisticação', 'Simples', 'Refinado'],
  linguagemTecnica: ['Linguagem técnica', 'Leiga', 'Técnica'],
  naturalidade: ['Naturalidade', 'Padronizado', 'Natural'],
};

export const ROTULO_COMPORTAMENTO: Record<CampoComportamento, { titulo: string; dica: string }> = {
  abertura: { titulo: 'Como inicia conversas', dica: 'Ex.: cumprimente pelo nome e pergunte como pode ajudar, sem textão.' },
  apresentacao: { titulo: 'Como se apresenta', dica: 'Ex.: apresente-se só na primeira mensagem, com nome e função.' },
  perguntas: { titulo: 'Como faz perguntas', dica: 'Ex.: uma pergunta por vez, aberta, ligada ao que o contato disse.' },
  necessidades: { titulo: 'Como identifica necessidades', dica: 'Ex.: entenda o problema, há quanto tempo, o que já tentou.' },
  conducao: { titulo: 'Como conduz o diálogo', dica: 'Ex.: resuma o entendimento e proponha o próximo passo.' },
  objecoes: { titulo: 'Como contorna objeções', dica: 'Ex.: reconheça, pergunte o contexto, use só condições da base.' },
  reclamacoes: { titulo: 'Como responde a reclamações', dica: 'Ex.: acolha, peça desculpas sem culpar ninguém e transfira.' },
  indecisos: { titulo: 'Com clientes indecisos', dica: 'Ex.: reduza a decisão a um passo pequeno, sem pressão.' },
  intencaoCompra: { titulo: 'Ao identificar intenção de compra', dica: 'Ex.: confirme o serviço e ofereça o agendamento.' },
  encerramento: { titulo: 'Como encerra conversas', dica: 'Ex.: confirme o combinado e deixe a porta aberta.' },
  quandoTransferir: { titulo: 'Quando transfere para humanos', dica: 'Ex.: pedido de humano, cobrança, urgência, assunto sensível.' },
  quandoSilenciar: { titulo: 'Quando permanece em silêncio', dica: 'Ex.: mensagens automáticas, spam, "ok" isolado depois de encerrar.' },
  quandoConsultarBase: { titulo: 'Quando consulta a base', dica: 'Ex.: preço, prazo, política, procedimento, endereço.' },
  quandoExecutarAcoes: { titulo: 'Quando executa ações no CRM', dica: 'Ex.: registrar dado informado, criar tarefa combinada.' },
};

export const ROTULO_FERRAMENTA_GRUPO: Record<FerramentaCatalogo['grupo'], string> = {
  conhecimento: 'Conhecimento',
  contato: 'Contato e CRM',
  pipeline: 'Pipeline',
  tarefas: 'Tarefas',
  agenda: 'Agenda',
  atendimento: 'Atendimento',
  automacao: 'Automações',
};

export const ROTULO_ACAO_REGRA: Record<TipoAcaoRegra, string> = {
  instrucao: 'Seguir instrução',
  transferir: 'Transferir para humano',
  silenciar: 'Não responder',
  adicionar_tag: 'Adicionar tag',
  remover_tag: 'Remover tag',
  acionar_workflow: 'Acionar workflow',
  iniciar_followup: 'Iniciar follow-up',
  mover_etapa: 'Mover etapa do funil',
  notificar_equipe: 'Notificar equipe',
  consultar_base: 'Consultar a base sobre',
};

export const ROTULO_CONDICAO: Record<Condicao['campo'], string> = {
  intencao: 'Intenção',
  objecao: 'Objeção',
  sentimento: 'Sentimento',
  urgencia: 'Urgência',
  temperatura: 'Temperatura',
  etapa: 'Etapa do funil',
  palavra_chave: 'Mensagem',
  interesse: 'Interesse',
  perfil: 'Campo do perfil',
};

export const ROTULO_OPERADOR: Record<Condicao['operador'], string> = { igual: 'é', diferente: 'não é', contem: 'contém', existe: 'existe', nao_existe: 'não existe' };

export const ROTULO_STATUS_RUN: Record<string, string> = { respondido: 'Respondeu', transferido: 'Transferiu', ignorado: 'Ignorou', erro: 'Erro', processando: 'Processando' };

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const usd = (n: number | string | null | undefined) => `US$ ${Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: Number(n ?? 0) < 1 ? 4 : 2, maximumFractionDigits: Number(n ?? 0) < 1 ? 4 : 2 })}`;
export const inteiro = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR');
export const dataHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
export const valorTexto = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
