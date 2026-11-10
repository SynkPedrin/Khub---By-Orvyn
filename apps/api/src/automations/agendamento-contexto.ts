import type { RealtimeEvent } from '@khub/types';
import type { TipoNo } from './catalogo';

/**
 * Gatilhos de agenda (Q2.4 / RV-05.2): eventos do outbox da migration 054 →
 * tipo do gatilho. Fica num arquivo próprio para o `triggers.service` só
 * espalhar no MAPA, sem crescer a lógica dele.
 */
export const MAPA_AGENDA: Partial<Record<RealtimeEvent, TipoNo>> = {
  'appointment.created': 'gatilho.agendamento_criado',
  'appointment.confirmed': 'gatilho.agendamento_confirmado',
  'appointment.no_show': 'gatilho.faltou',
  'appointment.cancelled': 'gatilho.agendamento_cancelado',
  'appointment.reminder_due': 'gatilho.lembrete_agendamento',
};

export const ehEventoAgenda = (evento: string): boolean => evento.startsWith('appointment.');

const GATILHOS_AGENDA = new Set<string>(Object.values(MAPA_AGENDA));
export const ehGatilhoAgenda = (tipo: string): boolean => GATILHOS_AGENDA.has(tipo);

/** Filtro do gatilho de agenda: tipo e responsável. Vazio = qualquer. */
export function filtroAgendaBate(cfg: { tipo?: string; responsavelId?: string }, dados: Record<string, unknown>): boolean {
  if (cfg.tipo && cfg.tipo !== String(dados.tipo ?? '')) return false;
  if (cfg.responsavelId && cfg.responsavelId !== String(dados.responsavelId ?? '')) return false;
  return true;
}

/** O que o fluxo enxerga em `{{agendamento.*}}`. */
export interface ContextoAgendamento {
  id: string;
  titulo: string;
  /** "15/11/2026" no fuso da conta. */
  data: string;
  /** "14:30" no fuso da conta. */
  hora: string;
  /** "sábado, 15 de novembro" no fuso da conta. */
  dataExtenso: string;
  horaFim: string;
  local: string;
  tipo: string;
  status: string;
  responsavelId: string | null;
  inicio: string;
  fim: string;
}

export const FUSO_PADRAO = 'America/Sao_Paulo';

function fusoValido(fuso: unknown): string {
  if (typeof fuso !== 'string' || !fuso.trim()) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/**
 * Formata o compromisso para o contexto do run. Data e hora no fuso da conta
 * (`tenants.settings.timezone`), nunca no fuso do servidor: o worker pode
 * rodar em UTC e o contato receberia "às 17:00" para uma consulta às 14:00.
 */
export function contextoAgendamento(
  c: { id: string; titulo: string; inicio: Date; fim: Date; local: string | null; tipo: string; status: string; responsavelId: string | null },
  fuso?: unknown,
): ContextoAgendamento {
  const timeZone = fusoValido(fuso);
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(c.inicio);
  const hm = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dataExtenso = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(c.inicio);
  return {
    id: c.id,
    titulo: c.titulo,
    data,
    hora: hm.format(c.inicio),
    dataExtenso,
    horaFim: hm.format(c.fim),
    local: c.local ?? '',
    tipo: c.tipo,
    status: c.status,
    responsavelId: c.responsavelId,
    inicio: c.inicio.toISOString(),
    fim: c.fim.toISOString(),
  };
}
