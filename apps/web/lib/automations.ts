'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/automations/');

// ---- Contrato do grafo (espelha catalogo.ts na API; publicar valida lá) ----
export type Categoria = 'gatilho' | 'controle' | 'acao';
export interface MetaNo {
  tipo: string;
  categoria: Categoria;
  grupo: string;
  nome: string;
  descricao: string;
  ramosFixos?: { id: string; rotulo: string }[];
  ramificado?: boolean;
  provider?: string;
  busca?: string[];
}
export interface ConfigWorkflow {
  reentrada: 'uma_vez' | 'sempre' | 'apos_terminar';
  pararNoReply: boolean;
  janelaAtiva: boolean;
  janelaDias: number[];
  janelaInicio: number;
  janelaFim: number;
  timezone: string;
  /** A janela também segura "Notificar equipe" (db/050). */
  janelaIncluiEquipe: boolean;
}
export interface NoGrafo {
  id: string;
  tipo: string;
  rotulo?: string;
  posicao: { x: number; y: number };
  config: Record<string, unknown>;
  aoFalhar?: 'parar' | 'seguir';
}
export interface ArestaGrafo {
  id: string;
  de: string;
  para: string;
  ramo?: string;
}
/** Nota de texto do canvas (Q3.3): mora fora de `nos`, o motor nunca a executa. */
export interface NotaGrafo {
  id: string;
  texto: string;
  posicao: { x: number; y: number };
  tom?: 'neutro' | 'marca' | 'aviso';
}
export interface Grafo {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  notas?: NotaGrafo[];
}
export interface Ramo {
  id: string;
  rotulo: string;
  juncao: 'AND' | 'OR' | 'NONE';
  regras: { campo: string; operador: string; valor?: string }[];
}

export interface WorkflowResumo {
  id: string; nome: string; descricao: string | null; tags: string[]; pasta: string | null; status: string;
  versaoAtiva: number | null; publicadoEm: string | null;
  execucoes: number; falhas: number; updatedAt: string;
  /** Tipos de nó do fluxo, gatilho primeiro (cadeia de logos da lista). */
  tipos?: string[];
}
export interface WorkflowDetalhe {
  id: string; nome: string; descricao: string | null; tags: string[]; pasta: string | null; status: string;
  versaoAtivaId: string | null; versaoAtiva: number | null;
  rascunhoId: string | null; temRascunho: boolean;
  grafo: Grafo;
  versoes: { id: string; versao: number; publicadoEm: string }[];
  config: ConfigWorkflow;
  webhookUrl: string | null;
  /** Há segredo HMAC ativo (o valor só aparece uma vez, ao gerar). */
  webhookAssinado: boolean;
}
/** Contagem por nó no período (Q3.3). */
export interface EstatisticaNo { concluidos: number; esperando: number; erros: number }
export interface EstatisticasFluxo {
  desde: string;
  nos: Record<string, EstatisticaNo>;
  total: { entraram: number; concluidos: number; esperando: number; erros: number };
}
export interface MetricasLista {
  desde: string; dias: number;
  porFluxo: Record<string, { ativos: number; concluidos: number; erros: number }>;
}
export interface VersaoResumo {
  id: string; versao: number; publicadoEm: string;
  autor: { id: string; nome: string | null } | null;
  nos: number; ativa: boolean;
}
export interface VersaoDetalhe { id: string; versao: number; publicadoEm: string | null; grafo: Grafo }
export interface RunDoContato {
  id: string; workflowId: string; workflowNome: string; gatilho: string; status: string;
  noAtual: string | null; noAtualRotulo: string | null; erro: string | null;
  startedAt: string; finishedAt: string | null; teste: boolean; ativo: boolean;
}
export interface SegredoWebhook { segredo: string; header: string; formato: string }
export interface Problema { noId?: string; problema: string }
export interface RunResumo {
  id: string; gatilho: string; status: string; noAtual: string | null; erro: string | null;
  startedAt: string; finishedAt: string | null; teste: boolean; contactId: string | null;
}
export interface RunDetalhe extends RunResumo {
  contexto: Record<string, unknown>;
  passos: { id: string; noId: string; tipo: string; status: string; tentativa: number; saida: Record<string, unknown>; erro: string | null; duracaoMs: number | null; createdAt: string }[];
}
export interface ItemDlq {
  id: string; runId: string; noId: string; tipo: string; erro: string; tentativas: number; createdAt: string;
}

export const automations = {
  catalogo: () => req<MetaNo[]>('catalogo'),
  listar: () => req<WorkflowResumo[]>('workflows'),
  obter: (id: string) => req<WorkflowDetalhe>(`workflows/${id}`),
  criar: (nome: string, descricao?: string) => req<{ id: string }>('workflows', { method: 'POST', body: JSON.stringify({ nome, descricao }) }),
  renomear: (id: string, dados: { nome?: string; descricao?: string; tags?: string[]; pasta?: string | null }) => req<{ ok: boolean }>(`workflows/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  salvar: (id: string, grafo: Grafo) => req<{ ok: boolean; versao: number }>(`workflows/${id}/grafo`, { method: 'PATCH', body: JSON.stringify({ grafo }) }),
  validar: (id: string) => req<{ ok: boolean; problemas: Problema[] }>(`workflows/${id}/validar`, { method: 'POST' }),
  publicar: (id: string) => req<{ ok: boolean; versao: number }>(`workflows/${id}/publicar`, { method: 'POST' }),
  rollback: (id: string, versionId: string) => req<{ ok: boolean; versao: number }>(`workflows/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionId }) }),
  status: (id: string, status: 'ativo' | 'pausado') => req<{ ok: boolean }>(`workflows/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  configurar: (id: string, config: Partial<ConfigWorkflow>) => req<{ ok: boolean }>(`workflows/${id}/config`, { method: 'PATCH', body: JSON.stringify(config) }),
  gerarWebhook: (id: string) => req<{ url: string; chave: string }>(`workflows/${id}/webhook-url`, { method: 'POST' }),
  gerarSegredoWebhook: (id: string) => req<SegredoWebhook>(`workflows/${id}/webhook-segredo`, { method: 'POST' }),
  removerSegredoWebhook: (id: string) => req<{ ok: boolean }>(`workflows/${id}/webhook-segredo`, { method: 'DELETE' }),
  duplicar: (id: string) => req<{ id: string; nome: string }>(`workflows/${id}/duplicar`, { method: 'POST' }),
  versoes: (id: string) => req<VersaoResumo[]>(`workflows/${id}/versoes`),
  versao: (id: string, versionId: string) => req<VersaoDetalhe>(`workflows/${id}/versoes/${versionId}`),
  stats: (id: string, desde: string) => req<EstatisticasFluxo>(`workflows/${id}/stats?desde=${encodeURIComponent(desde)}`),
  metricas: (dias = 30) => req<MetricasLista>(`workflows/metricas?dias=${dias}`),
  runsDoContato: (contactId: string) => req<RunDoContato[]>(`runs?contactId=${encodeURIComponent(contactId)}`),
  remover: (id: string) => req<{ ok: boolean }>(`workflows/${id}`, { method: 'DELETE' }),
  testar: (id: string, contactId: string) => req<{ runId?: string }>(`workflows/${id}/testar`, { method: 'POST', body: JSON.stringify({ contactId }) }),
  runs: (id: string) => req<RunResumo[]>(`workflows/${id}/runs`),
  run: (id: string) => req<RunDetalhe>(`runs/${id}`),
  cancelar: (id: string) => req<{ ok: boolean; cancelado: boolean }>(`runs/${id}/cancelar`, { method: 'POST' }),
  dlq: () => req<ItemDlq[]>('dlq'),
  reprocessar: (id: string) => req<{ ok: boolean; runId: string }>(`dlq/${id}/reprocessar`, { method: 'POST' }),
  /** Modo simples: a NICO monta o fluxo (rascunho) a partir da conversa. */
  nicoMontar: (conversa: MensagemNico[], workflowId?: string) => req<RespostaNico>('nico/montar', { method: 'POST', body: JSON.stringify({ conversa, workflowId }) }),
  /** Teste real com dados reais: mensagens só no número de teste, resto simulado. */
  nicoTestar: (workflowId: string, contactId?: string) => req<{ runId?: string; duplicado?: true; contato: { id: string; nome: string } }>(`nico/workflows/${workflowId}/testar`, { method: 'POST', body: JSON.stringify(contactId ? { contactId } : {}) }),
};

// ---- Modo simples (NICO) ----
export interface MensagemNico { autor: 'usuario' | 'nico'; texto: string }
export interface PassoNico { tipo: string; categoria: Categoria; nome: string; detalhe: string; nivel: number; ramo?: string }
export type RespostaNico =
  | { tipo: 'pergunta'; perguntas: string[]; resumo: string }
  | { tipo: 'pronto'; workflowId: string; nome: string; resumo: string; passos: PassoNico[] };

/** Campos oferecidos no If/Else — espelham o contexto que a engine monta. */
export const CAMPOS_CONDICAO = [
  { valor: 'contato.tags', rotulo: 'Contato · tags' },
  { valor: 'contato.tag', rotulo: 'Contato · tag principal' },
  { valor: 'contato.nome', rotulo: 'Contato · nome' },
  { valor: 'contato.email', rotulo: 'Contato · e-mail' },
  { valor: 'contato.telefone', rotulo: 'Contato · telefone' },
  { valor: 'contato.empresa', rotulo: 'Contato · empresa' },
  { valor: 'contato.valor', rotulo: 'Contato · valor estimado' },
  { valor: 'mensagem.texto', rotulo: 'Mensagem · texto' },
  { valor: 'negocio.valor', rotulo: 'Negócio · valor' },
  { valor: 'negocio.origem', rotulo: 'Negócio · origem' },
  { valor: 'gatilho.origem', rotulo: 'Gatilho · origem' },
  { valor: 'agendamento.tipo', rotulo: 'Agendamento · tipo' },
  { valor: 'agendamento.status', rotulo: 'Agendamento · status' },
  { valor: 'agendamento.titulo', rotulo: 'Agendamento · título' },
];

export const OPERADORES = [
  { valor: 'contem', rotulo: 'contém' },
  { valor: 'nao_contem', rotulo: 'não contém' },
  { valor: 'igual', rotulo: 'é igual a' },
  { valor: 'diferente', rotulo: 'é diferente de' },
  { valor: 'existe', rotulo: 'existe' },
  { valor: 'nao_existe', rotulo: 'não existe' },
  { valor: 'maior', rotulo: 'é maior que' },
  { valor: 'menor', rotulo: 'é menor que' },
];
