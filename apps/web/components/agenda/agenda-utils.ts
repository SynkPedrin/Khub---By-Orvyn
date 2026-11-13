import { ApiError } from '@/lib/api-error';
import type { Compromisso, TipoAgenda } from '@/lib/agenda';
import type { IconName } from '@/components/icons';

/**
 * Utilitários da agenda real: datas no fuso local do navegador, rótulos de
 * status e tradução de erros da API para frases que o usuário entende.
 */

export type StatusCompromisso = Compromisso['status'];

export const STATUS_LABEL: Record<StatusCompromisso, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};

export const STATUS_PILL: Record<StatusCompromisso, string> = {
  agendado: 'pill',
  confirmado: 'pill pill-brand',
  concluido: 'pill pill-success',
  cancelado: 'pill pill-danger',
  faltou: 'pill pill-warning',
};

export const STATUS_ORDEM: StatusCompromisso[] = ['agendado', 'confirmado', 'concluido', 'cancelado', 'faltou'];

/** Status que ainda ocupam o horário (e disputam choque na API). */
export const STATUS_ATIVOS: StatusCompromisso[] = ['agendado', 'confirmado'];

export const TIPO_LABEL: Record<TipoAgenda, string> = {
  reuniao: 'Reunião',
  call: 'Ligação',
  demo: 'Demonstração',
  visita: 'Visita',
  followup: 'Follow-up',
  outro: 'Outro',
};

export const TIPO_ORDEM: TipoAgenda[] = ['reuniao', 'call', 'demo', 'visita', 'followup', 'outro'];

/**
 * Cor do evento na grade: o TIPO dá a família de cor (tokens do tema, nada de
 * hex) e o STATUS ajusta a leitura (cancelado/faltou apagados, concluído
 * neutro). `barra` = faixa lateral; `fundo` = preenchimento do bloco.
 */
export const TIPO_TOM: Record<TipoAgenda, { barra: string; fundo: string; ponto: string; icone: IconName }> = {
  reuniao: { barra: 'border-l-brand', fundo: 'bg-brand-soft', ponto: 'bg-brand', icone: 'users' },
  call: { barra: 'border-l-info', fundo: 'bg-info-soft', ponto: 'bg-info', icone: 'phone' },
  demo: { barra: 'border-l-brand', fundo: 'bg-brand-softer', ponto: 'bg-brand', icone: 'video' },
  visita: { barra: 'border-l-success', fundo: 'bg-success-soft', ponto: 'bg-success', icone: 'mapPin' },
  followup: { barra: 'border-l-warning', fundo: 'bg-warning-soft', ponto: 'bg-warning', icone: 'chat' },
  outro: { barra: 'border-l-line-strong', fundo: 'bg-surface2', ponto: 'bg-faint', icone: 'calendar' },
};

/** Classes do bloco do evento combinando tipo e status. */
export function classesEvento(c: Pick<Compromisso, 'tipo' | 'status'>): string {
  const tom = TIPO_TOM[c.tipo] ?? TIPO_TOM.outro;
  if (c.status === 'cancelado') return 'border-l-danger bg-surface2 text-muted line-through opacity-80';
  if (c.status === 'faltou') return 'border-l-warning bg-warning-soft text-muted';
  if (c.status === 'concluido') return `${tom.barra} bg-surface2 text-muted`;
  return `${tom.barra} ${tom.fundo} text-fg`;
}

/** Primeiro dia (domingo como 0 no JS → segunda como coluna 0) da grade do mês. */
export function inicioDaGradeMes(d: Date): Date {
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1);
  return inicioDaSemana(primeiro);
}

/** "novembro de 2026". */
export function rotuloMes(d: Date): string {
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** Segunda-feira 00:00 (local) da semana que contém `d`. */
export function inicioDaSemana(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  r.setHours(0, 0, 0, 0);
  return r;
}

export function somarDias(d: Date, dias: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` no fuso local, para `<input type="date">` e agrupamento por dia. */
export function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** `hh:mm` no fuso local, para `<input type="time">`. */
export function horaInput(d: Date): string {
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** Junta `yyyy-mm-dd` + `hh:mm` numa data local. `null` se inválido. */
export function montarData(dia: string, horario: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  const h = /^(\d{2}):(\d{2})$/.exec(horario);
  if (!m || !h) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(h[1]), Number(h[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "9 a 15 de novembro de 2026" ou "28 de outubro a 3 de novembro de 2026". */
export function rotuloSemana(inicio: Date): string {
  const fim = somarDias(inicio, 6);
  const mes = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'long' });
  if (inicio.getFullYear() !== fim.getFullYear()) {
    return `${inicio.getDate()} de ${mes(inicio)} de ${inicio.getFullYear()} a ${fim.getDate()} de ${mes(fim)} de ${fim.getFullYear()}`;
  }
  if (inicio.getMonth() !== fim.getMonth()) {
    return `${inicio.getDate()} de ${mes(inicio)} a ${fim.getDate()} de ${mes(fim)} de ${fim.getFullYear()}`;
  }
  return `${inicio.getDate()} a ${fim.getDate()} de ${mes(fim)} de ${fim.getFullYear()}`;
}

/** "Segunda-feira, 9 de novembro". */
export function rotuloDia(d: Date): string {
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ehLink(valor: string): boolean {
  return /^https?:\/\/\S+$/i.test(valor.trim());
}

function frase(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

/** Mensagem em português claro para qualquer falha de chamada da agenda. */
export function mensagemErro(e: unknown, acao: string): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Sua sessão expirou. Entre de novo para continuar.';
    if (e.status === 403) return 'Você não tem permissão para fazer isso.';
    if (e.status === 404) return 'Este compromisso não existe mais. A lista foi atualizada.';
    if (e.status === 409) return 'Já existe um compromisso nesse horário. Escolha outro horário.';
    if (e.status === 501 && e.body?.status === 'config_required') return 'Conecte o Google Calendar em Configurações para sincronizar.';
    if (e.status === 429) return 'Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.';
    if (e.status === 400 || e.status === 422) {
      if (Array.isArray(e.body?.errors) && e.body.errors.length > 0) {
        return 'Confira os campos: título e local com até 200 caracteres, notas com até 1000.';
      }
      const t = typeof e.body?.title === 'string' ? e.body.title : '';
      if (t && !/^bad request$/i.test(t)) return frase(t);
      return 'Confira os dados informados e tente de novo.';
    }
    if (e.status >= 500) return `Não foi possível ${acao} agora. O servidor teve um problema, tente de novo em instantes.`;
  }
  return `Não foi possível ${acao}. Verifique sua conexão e tente de novo.`;
}
