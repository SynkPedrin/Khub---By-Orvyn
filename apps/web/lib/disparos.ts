'use client';

import { clienteApi } from './session-fetch';

/** Disparo em massa (Q4.3). Contrato: `apps/api/src/disparos/disparos.controller.ts`. */
const req = clienteApi('/api/v1/disparos');

export type CanalDisparo = 'whatsapp' | 'email';
export type StatusDisparo = 'rascunho' | 'aguardando_aprovacao' | 'agendado' | 'enviando' | 'pausado' | 'concluido' | 'cancelado';
export type StatusDestinatario = 'pendente' | 'enviado' | 'falhou' | 'ignorado_optout' | 'ignorado_sem_canal' | 'respondeu';

export interface FiltroSegmento {
  q?: string;
  stageId?: string;
  origem?: string;
  tag?: string;
  ownerId?: string;
  cf?: Record<string, string>;
}
export interface Segmento {
  filtro?: FiltroSegmento;
  tags?: string[];
  viewId?: string;
}
export interface Janela {
  dias: number[];
  inicio: number;
  fim: number;
  fuso: string;
}
export interface Totais {
  destinatarios: number;
  enviados: number;
  falhas: number;
  ignorados: number;
  respostas: number;
  pendentes: number;
}
export interface Disparo {
  id: string;
  nome: string;
  canal: CanalDisparo;
  status: StatusDisparo;
  mensagem: string;
  assunto: string | null;
  segmento: Segmento;
  agendadoPara: string | null;
  loteTamanho: number;
  loteIntervaloSeg: number;
  janela: Janela;
  exigeAprovacao: boolean;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  rejeitadoMotivo: string | null;
  criadoPorTipo: 'humano' | 'nyro';
  pausaMotivo: string | null;
  pausaDetalhe: { provider?: string; missing?: string[]; limite?: number; usados?: number } | null;
  proximoLoteEm: string | null;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  canceladoEm: string | null;
  createdAt: string;
  totais: Totais;
  porStatus?: Record<StatusDestinatario, number>;
}
export interface Audiencia {
  total: number;
  elegiveis: number;
  optout: number;
  semCanal: number;
  acimaDoTeto: boolean;
  teto: number;
  exigeAprovacao: boolean;
  aprovacaoAcima: number;
  amostra: { id: string; nome: string; destino: string | null }[];
}
export interface Limites {
  aprovacaoAcima: number;
  diario: Record<CanalDisparo, number>;
  usadosHoje: Record<CanalDisparo, number>;
  fuso: string;
  canais: { email: { configurado: boolean; missing: string[] } };
}
export interface Previa {
  exemplo: boolean;
  contato: { id: string; nome: string } | null;
  texto: string;
  assunto: string | null;
  variaveis: { chave: string; rotulo: string }[];
}
export interface Destinatario {
  id: string;
  contactId: string;
  nome: string;
  destino: string | null;
  status: StatusDestinatario;
  erro: string | null;
  enviadoEm: string | null;
  respondidoEm: string | null;
}
export type DadosDisparo = Partial<Pick<Disparo, 'nome' | 'canal' | 'mensagem' | 'assunto' | 'segmento' | 'agendadoPara' | 'loteTamanho' | 'loteIntervaloSeg' | 'janela'>>;

const post = <T>(caminho: string, corpo?: unknown) => req<T>(caminho, { method: 'POST', body: corpo === undefined ? undefined : JSON.stringify(corpo) });

export const disparos = {
  listar: (status?: StatusDisparo) => req<Disparo[]>(status ? `?status=${status}` : ''),
  limites: () => req<Limites>('/limites'),
  audiencia: (canal: CanalDisparo, segmento: Segmento) => post<Audiencia>('/audiencia', { canal, segmento }),
  previa: (d: { canal: CanalDisparo; mensagem: string; assunto?: string | null; segmento?: Segmento; contactId?: string }) => post<Previa>('/previa', d),
  criar: (d: DadosDisparo & { nome: string; canal: CanalDisparo }) => post<Disparo>('', d),
  obter: (id: string) => req<Disparo>(`/${id}`),
  atualizar: (id: string, d: DadosDisparo) => req<Disparo>(`/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  remover: (id: string) => req<{ ok: boolean }>(`/${id}`, { method: 'DELETE' }),
  enviar: (id: string) => post<Disparo>(`/${id}/enviar`),
  aprovar: (id: string) => post<Disparo>(`/${id}/aprovar`),
  rejeitar: (id: string, motivo: string) => post<Disparo>(`/${id}/rejeitar`, { motivo }),
  pausar: (id: string) => post<Disparo>(`/${id}/pausar`),
  retomar: (id: string) => post<Disparo>(`/${id}/retomar`),
  cancelar: (id: string) => post<Disparo>(`/${id}/cancelar`),
  destinatarios: (id: string, q: { status?: StatusDestinatario; busca?: string; cursor?: string }) => {
    const p = new URLSearchParams();
    if (q.status) p.set('status', q.status);
    if (q.busca) p.set('q', q.busca);
    if (q.cursor) p.set('cursor', q.cursor);
    const s = p.toString();
    return req<{ items: Destinatario[]; nextCursor: string | null }>(`/${id}/destinatarios${s ? `?${s}` : ''}`);
  },
};

export const ROTULO_STATUS: Record<StatusDisparo, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  agendado: 'Agendado',
  enviando: 'Enviando',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
export const TOM_STATUS: Record<StatusDisparo, 'brand' | 'green' | 'amber' | 'neutral'> = {
  rascunho: 'neutral',
  aguardando_aprovacao: 'amber',
  agendado: 'brand',
  enviando: 'brand',
  pausado: 'amber',
  concluido: 'green',
  cancelado: 'neutral',
};
export const ROTULO_DESTINATARIO: Record<StatusDestinatario, string> = {
  pendente: 'Na fila',
  enviado: 'Enviado',
  falhou: 'Falhou',
  ignorado_optout: 'Pediu para sair',
  ignorado_sem_canal: 'Sem canal',
  respondeu: 'Respondeu',
};

/** Por que o disparo está parado (ou esperando), em linguagem de gente. */
export function motivoDaPausa(d: Pick<Disparo, 'pausaMotivo' | 'pausaDetalhe' | 'status'>): string | null {
  switch (d.pausaMotivo) {
    case 'manual': return 'Pausado por alguém da equipe.';
    case 'config_required': return 'O canal de envio não está conectado. Conecte e retome o disparo.';
    case 'canal_desconectado': return 'O WhatsApp da conta está desconectado. Reconecte e retome o disparo.';
    case 'bloqueado_dev': return 'Envio bloqueado fora de produção: defina STEVO_TEST_NUMBER para testar.';
    case 'limite_diario': return `Limite diário de envios atingido${d.pausaDetalhe?.limite ? ` (${d.pausaDetalhe.limite})` : ''}. Continua amanhã, dentro da janela.`;
    case 'fora_da_janela': return 'Fora da janela de envio. Continua na próxima abertura.';
    case 'janela_invalida': return 'A janela de envio não abre nunca. Ajuste dias e horários.';
    case 'limite_do_provedor': return 'O provedor pediu calma. O próximo lote sai em instantes.';
    default: return null;
  }
}

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const JANELA_PADRAO: Janela = { dias: [1, 2, 3, 4, 5], inicio: 9, fim: 18, fuso: 'America/Sao_Paulo' };
