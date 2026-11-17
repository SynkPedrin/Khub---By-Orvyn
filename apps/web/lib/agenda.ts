'use client';

import { clienteApi } from './session-fetch';
import type { ResultadoImportacao } from './financeiro';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/agenda/');

export type StatusAgenda = 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou';
export type TipoAgenda = 'reuniao' | 'call' | 'demo' | 'visita' | 'followup' | 'outro';

export interface Compromisso {
  id: string;
  contactId: string | null;
  titulo: string;
  inicio: string;
  fim: string;
  /** Migration 054: `nao_compareceu` virou `faltou`. */
  status: StatusAgenda;
  tipo: TipoAgenda;
  /** Membro dono do horário; `null` = agenda geral (ex.: marcado pela IA). */
  responsavelId: string | null;
  local: string | null;
  notas: string | null;
  googleEventId: string | null;
  confirmadoEm: string | null;
  faltouEm: string | null;
  lembreteEnviadoEm: string | null;
  /** Valor do atendimento em centavos: ao concluir, vira entrada no financeiro. */
  valorCentavos: number | null;
  /** Catálogo (db/071): quem atende e o serviço. */
  profissionalId?: string | null;
  servicoId?: string | null;
  /** Vêm prontos na lista (sem buscar contato por contato). */
  contatoNome?: string | null;
  contatoTelefone?: string | null;
  profissionalNome?: string | null;
  servicoNome?: string | null;
}

export interface ProfissionalAgenda {
  id: string;
  nome: string;
  especialidade: string | null;
}

export interface NovoCompromisso {
  titulo: string;
  inicio: string;
  fim: string;
  contactId?: string;
  local?: string;
  notas?: string;
  tipo?: TipoAgenda;
  responsavelId?: string | null;
  valorCentavos?: number | null;
  /** Salão/clínica: quem atende e o serviço do catálogo. */
  profissionalId?: string | null;
  servicoId?: string | null;
}

export interface ServicoAgenda {
  id: string;
  nome: string;
  categoria: string | null;
  duracaoMin: number;
  precoCentavos: number;
}

/** PATCH parcial (arrastar, redimensionar, reagendar). `null` limpa o campo. */
export type PatchCompromisso = Partial<Omit<NovoCompromisso, 'contactId' | 'local' | 'notas'>> & {
  contactId?: string | null;
  local?: string | null;
  notas?: string | null;
};

export const agenda = {
  profissionais: () => req<ProfissionalAgenda[]>('profissionais'),
  servicos: () => req<ServicoAgenda[]>('servicos'),
  compromissos: (filtro?: { de?: string; ate?: string; responsavelId?: string; profissionalId?: string; status?: StatusAgenda[] }) => {
    const qs = new URLSearchParams();
    if (filtro?.de) qs.set('de', filtro.de);
    if (filtro?.ate) qs.set('ate', filtro.ate);
    if (filtro?.responsavelId) qs.set('responsavelId', filtro.responsavelId);
    if (filtro?.profissionalId) qs.set('profissionalId', filtro.profissionalId);
    if (filtro?.status?.length) qs.set('status', filtro.status.join(','));
    return req<Compromisso[]>(`compromissos${qs.toString() ? `?${qs}` : ''}`);
  },
  horarios: (data: string, duracao = 60, responsavelId?: string | null) =>
    req<{ inicio: string; fim: string }[]>(`horarios?data=${data}&duracao=${duracao}${responsavelId ? `&responsavelId=${responsavelId}` : ''}`),
  criar: (d: NovoCompromisso) => req<Compromisso>('compromissos', { method: 'POST', body: JSON.stringify(d) }),
  atualizar: (id: string, d: PatchCompromisso) => req<Compromisso>(`compromissos/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  status: (id: string, status: Compromisso['status']) =>
    req<Compromisso>(`compromissos/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  sincronizar: (id: string) => req<{ googleEventId: string }>(`compromissos/${id}/sincronizar`, { method: 'POST' }),
  remover: (id: string) => req<{ ok: boolean }>(`compromissos/${id}`, { method: 'DELETE' }),
  /** Importação em lote (planilha do Avec): máx. 500 linhas por chamada; manager+. */
  importar: (linhas: Record<string, unknown>[], opcoes: { gerarComissoes?: boolean }, linhaInicial: number) =>
    req<ResultadoImportacao>('importar', { method: 'POST', body: JSON.stringify({ linhas, opcoes, linhaInicial }) }),
};
