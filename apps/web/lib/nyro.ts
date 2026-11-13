'use client';

import { ApiError } from './api-error';
import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/nyro/');

export interface Capacidade { nome: string; descricao: string; precisaAprovacao: boolean }
export interface StatusNyro { configurada: boolean; missing: string[]; capacidades: Capacidade[] }

/** Arquivo que a NICO lê (extração no servidor). Mantenha em sincronia com `nyro/anexos.ts` da API. */
export interface AnexoEnvio { nome: string; base64: string }
export const ANEXO_EXTENSOES = ['pdf', 'docx', 'pptx', 'md', 'txt', 'csv', 'json', 'py', 'js', 'ts', 'tsx', 'html', 'xml', 'yml', 'yaml', 'sql', 'log'];
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_MAX_QTD = 3;

export interface PassoNyro { tipo: 'roteou' | 'tool' | 'aprovacao' | 'texto' | 'erro'; rotulo: string; detalhe?: string }
export interface Aprovacao { id: string; tool: string; resumo: string }
export interface Fonte { chunkId: string; titulo: string; escopo: string }

export interface PlanoNyro { objetivo: string; passos: { texto: string; status: 'pendente' | 'fazendo' | 'feito' }[] }
export interface Insight { id: string; gravidade: 'alta' | 'media' | 'info'; titulo: string; detalhe: string; pergunta: string }
export interface RelatorioResumo { id: string; titulo: string; tipo: string; origem: string; createdAt: string }
export interface Relatorio extends RelatorioResumo { conteudoMd: string }
export interface Rotina { id: string; titulo: string; instrucao: string; frequencia: string; hora: string; diaSemana: number | null; diaMes: number | null; ativo: boolean; proximoEm: string; ultimoEm: string | null; ultimoStatus: string | null; ultimoErro: string | null }

/** Eventos do streaming (SSE) da API. */
export type EventoNyro =
  | { tipo: 'conversa'; conversationId: string }
  | { tipo: 'passo'; passo: PassoNyro }
  | { tipo: 'plano'; plano: PlanoNyro }
  | { tipo: 'texto'; delta: string }
  | { tipo: 'limpar' }
  | { tipo: 'final'; resposta: RespostaNyro }
  | { tipo: 'erro'; status: number; mensagem: string };

export interface RespostaNyro {
  conversationId: string;
  plano?: PlanoNyro;
  relatorioId?: string;
  agente: string;
  passos: PassoNyro[];
  texto: string;
  fontes: Fonte[];
  aprovacoes: Aprovacao[];
  guardrail?: string;
}
export interface MensagemNyro {
  id: string; papel: 'user' | 'assistant' | 'tool'; conteudo: string;
  agente: string | null; fontes: Fonte[]; guardrail: string | null; createdAt: string;
}

export const AGENTE_NOME: Record<string, string> = {
  nico: 'NICO',
  configuracao: 'Arquiteta',
  conversas: 'Atendente',
  growth: 'Estrategista',
  consultoria: 'Consultora',
};

/** Lê o corpo SSE e entrega cada evento `data:` já interpretado. */
async function lerSse(corpo: ReadableStream<Uint8Array>, onEvento: (e: EventoNyro) => void): Promise<void> {
  const reader = corpo.getReader();
  const dec = new TextDecoder();
  let resto = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    let i: number;
    while ((i = resto.indexOf('\n\n')) >= 0) {
      const bloco = resto.slice(0, i);
      resto = resto.slice(i + 2);
      const dados = bloco.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!dados) continue; // comentário (": ping")
      try {
        onEvento(JSON.parse(dados) as EventoNyro);
      } catch {
        /* evento malformado: ignora, o próximo segue */
      }
    }
  }
}

/**
 * Chat com streaming: passos, plano e texto chegam enquanto a NICO trabalha.
 * Resolve com a resposta final; lança ApiError (incluindo 501 config_required).
 */
async function chatStream(texto: string, conversationId: string | undefined, anexos: AnexoEnvio[] | undefined, onEvento: (e: EventoNyro) => void, sinal?: AbortSignal): Promise<RespostaNyro> {
  const corpo = JSON.stringify({ texto, conversationId, ...(anexos?.length ? { anexos } : {}) });
  const chamar = () => fetch('/api/v1/nyro/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo, signal: sinal });
  let r = await chamar();
  if (r.status === 401) {
    // uma chamada JSON qualquer aciona a renovação de sessão compartilhada; depois repete uma vez
    await req<StatusNyro>('status').catch(() => undefined);
    r = await chamar();
  }
  if (!r.ok || !r.body) throw new ApiError(r.status, await r.json().catch(() => ({})));
  let final: RespostaNyro | null = null;
  let erro: Extract<EventoNyro, { tipo: 'erro' }> | null = null;
  await lerSse(r.body, (e) => {
    if (e.tipo === 'final') final = e.resposta;
    else if (e.tipo === 'erro') erro = e;
    onEvento(e);
  });
  if (erro) throw new ApiError((erro as Extract<EventoNyro, { tipo: 'erro' }>).status, { title: (erro as Extract<EventoNyro, { tipo: 'erro' }>).mensagem });
  if (!final) throw new ApiError(502, { title: 'A conexão com a NICO caiu antes da resposta terminar.' });
  return final;
}

export const nyro = {
  chatStream,
  insights: () => req<Insight[]>('insights'),
  relatorios: () => req<RelatorioResumo[]>('relatorios'),
  relatorio: (id: string) => req<Relatorio>(`relatorios/${id}`),
  rotinas: () => req<Rotina[]>('rotinas'),
  pausarRotina: (id: string) => req<{ ok: boolean }>(`rotinas/${id}/pausar`, { method: 'POST', body: '{}' }),
  status: () => req<StatusNyro>('status'),
  chat: (texto: string, conversationId?: string, anexos?: AnexoEnvio[]) =>
    req<RespostaNyro>('chat', { method: 'POST', body: JSON.stringify({ texto, conversationId, ...(anexos?.length ? { anexos } : {}) }) }),
  conversas: () => req<{ id: string; titulo: string | null; updatedAt: string }[]>('conversas'),
  conversa: (id: string) => req<{ id: string; titulo: string | null; mensagens: MensagemNyro[]; aprovacoes: Aprovacao[] }>(`conversas/${id}`),
  decidir: (actionId: string, aprovar: boolean) =>
    req<{ ok: boolean; status: string; erro?: string }>(`acoes/${actionId}`, { method: 'POST', body: JSON.stringify({ aprovar }) }),
  pendentes: () => req<Aprovacao[]>('acoes'),
  uso: () => req<{ agente: string; chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number }[]>('uso'),
};
