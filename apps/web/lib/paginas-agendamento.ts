'use client';

import { clienteApi } from './session-fetch';
import type { CampoView } from './publico/tipos';

/** Páginas de agendamento (Q4.2), área autenticada: `/api/v1/booking-pages/*`. */
const req = clienteApi('/api/v1/booking-pages/');

export type DiaSemana = '0' | '1' | '2' | '3' | '4' | '5' | '6';
export interface Faixa {
  de: string;
  ate: string;
}
export type Horarios = Partial<Record<DiaSemana, Faixa[]>>;

export interface PaginaAgendamento {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  duracaoMin: number;
  intervaloMin: number;
  antecedenciaMinHoras: number;
  janelaDias: number;
  horarios: Horarios;
  fuso: string;
  responsaveis: string[];
  distribuicao: 'round_robin' | 'fixo';
  local: string | null;
  tipo: 'reuniao' | 'call' | 'demo' | 'visita' | 'followup' | 'outro';
  perguntas: CampoView[];
  confirmacaoAutomatica: boolean;
  estilo: { cor?: string };
  ativo: boolean;
  totalReservas: number;
  createdAt: string;
  updatedAt: string;
}

export type PaginaPatch = Partial<Omit<PaginaAgendamento, 'id' | 'totalReservas' | 'createdAt' | 'updatedAt'>>;

export const paginasAgendamento = {
  listar: () => req<PaginaAgendamento[]>(''),
  obter: (id: string) => req<PaginaAgendamento>(id),
  criar: (d: { titulo: string } & PaginaPatch) => req<PaginaAgendamento>('', { method: 'POST', body: JSON.stringify(d) }),
  atualizar: (id: string, d: PaginaPatch) => req<PaginaAgendamento>(id, { method: 'PATCH', body: JSON.stringify(d) }),
  remover: (id: string) => req<{ ok: true }>(id, { method: 'DELETE' }),
};

export const DIAS: { key: DiaSemana; nome: string; curto: string }[] = [
  { key: '1', nome: 'Segunda', curto: 'seg' },
  { key: '2', nome: 'Terça', curto: 'ter' },
  { key: '3', nome: 'Quarta', curto: 'qua' },
  { key: '4', nome: 'Quinta', curto: 'qui' },
  { key: '5', nome: 'Sexta', curto: 'sex' },
  { key: '6', nome: 'Sábado', curto: 'sáb' },
  { key: '0', nome: 'Domingo', curto: 'dom' },
];

export const FUSOS = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'America/Manaus', label: 'Manaus (GMT-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (GMT-4)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (GMT-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (GMT-2)' },
  { value: 'America/Belem', label: 'Belém (GMT-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (GMT-3)' },
  { value: 'America/Recife', label: 'Recife (GMT-3)' },
  { value: 'America/Bahia', label: 'Salvador (GMT-3)' },
  { value: 'Europe/Lisbon', label: 'Lisboa' },
  { value: 'America/New_York', label: 'Nova York' },
];

export const TIPOS_COMPROMISSO = [
  { value: 'reuniao', label: 'Reunião' },
  { value: 'call', label: 'Ligação' },
  { value: 'demo', label: 'Demonstração' },
  { value: 'visita', label: 'Visita' },
  { value: 'followup', label: 'Retorno' },
  { value: 'outro', label: 'Outro' },
] as const;

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Pré-visualização no editor: horários da GRADE (sem consultar a agenda real),
 * como lista de "HH:MM". A página publicada usa os horários livres da API.
 */
export function horariosDaGrade(p: Pick<PaginaAgendamento, 'horarios' | 'duracaoMin' | 'intervaloMin'>, dia: DiaSemana): string[] {
  const out: string[] = [];
  for (const f of p.horarios[dia] ?? []) {
    for (let m = min(f.de); m + p.duracaoMin <= min(f.ate); m += p.duracaoMin + p.intervaloMin) out.push(hhmm(m));
  }
  return out;
}

export function linkPublico(origem: string, slug: string): string {
  return `${origem}/b/${slug}`;
}
