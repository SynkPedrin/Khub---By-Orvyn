/**
 * Tempo no fuso do fluxo (Q3.1/Q3.2). Puro, sem dependência: "Esperar até",
 * a condição por dia/hora, o gatilho agendado e a data do contato calculam
 * tudo aqui. Regra: o servidor pode rodar em UTC; a regra de negócio vive no
 * fuso da conta/fluxo. Nada de `new Date(ano, mes, dia)` (fuso do processo).
 */

export const FUSO_PADRAO = 'America/Sao_Paulo';

export function fusoOuPadrao(fuso: unknown): string {
  if (typeof fuso !== 'string' || !fuso.trim()) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

export interface Partes {
  ano: number;
  /** 1-12 */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 0 = domingo ... 6 = sábado */
  diaSemana: number;
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Partes do calendário de `d` no fuso. */
export function partesNoFuso(d: Date, fuso: string): Partes {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora: Number(p.hour) % 24, minuto: Number(p.minute), diaSemana: DIAS[p.weekday] ?? 0,
  };
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC no instante `d`. */
function offsetMs(d: Date, fuso: string): number {
  const p = partesNoFuso(d, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  return comoUtc - Math.floor(d.getTime() / 60_000) * 60_000;
}

/**
 * Instante (UTC) de um horário de parede no fuso. Duas passadas acertam a
 * virada de horário de verão; um horário que não existe (pulo da primavera)
 * cai no instante seguinte válido.
 */
export function instanteNoFuso(ano: number, mes: number, dia: number, hora: number, minuto: number, fuso: string): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  let t = alvo - offsetMs(new Date(alvo), fuso);
  t = alvo - offsetMs(new Date(t), fuso);
  return new Date(t);
}

/** Dias no mês (mes 1-12). */
export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Soma `n` dias de calendário a uma data (ano/mes/dia), sem fuso. */
export function somarDias(ano: number, mes: number, dia: number, n: number): { ano: number; mes: number; dia: number } {
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

export function hhmm(hora: string): { hora: number; minuto: number } {
  const [h, m] = hora.split(':').map(Number);
  return { hora: h || 0, minuto: m || 0 };
}

export const isoData = (ano: number, mes: number, dia: number): string =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/**
 * Lê um valor de data do contexto: ISO com hora (`agendamento.inicio`),
 * "AAAA-MM-DD" (campo personalizado), "DD/MM/AAAA" ou Date. Data sem hora vira
 * meia-noite no fuso — `temHora` diz se havia hora de verdade.
 */
export function lerData(v: unknown, fuso: string): { instante: Date; temHora: boolean } | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { instante: v, temHora: true };
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? { instante: instanteNoFuso(+m[1], +m[2], +m[3], 0, 0, fuso), temHora: false } : null;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return dataValida(+m[3], +m[2], +m[1]) ? { instante: instanteNoFuso(+m[3], +m[2], +m[1], 0, 0, fuso), temHora: false } : null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : { instante: d, temHora: true };
  }
  return null;
}

function dataValida(ano: number, mes: number, dia: number): boolean {
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes);
}

/**
 * Alvo do "Esperar até" (modo campo): base ± deslocamento. Em dias, anda no
 * CALENDÁRIO do fuso (1 dia antes de 15/11 14:30 = 14/11 14:30, mesmo com
 * horário de verão no meio) e `hora` fixa a hora do dia; em horas/minutos é
 * aritmética pura de instante.
 */
export function alvoComDeslocamento(
  base: { instante: Date; temHora: boolean },
  cfg: { deslocamento: number; unidade: 'minutos' | 'horas' | 'dias'; direcao: 'antes' | 'depois'; hora?: string },
  fuso: string,
): Date {
  const sinal = cfg.direcao === 'antes' ? -1 : 1;
  if (cfg.unidade !== 'dias') {
    const fator = cfg.unidade === 'horas' ? 3_600_000 : 60_000;
    return new Date(base.instante.getTime() + sinal * cfg.deslocamento * fator);
  }
  const p = partesNoFuso(base.instante, fuso);
  const d = somarDias(p.ano, p.mes, p.dia, sinal * cfg.deslocamento);
  const h = cfg.hora ? hhmm(cfg.hora) : base.temHora ? { hora: p.hora, minuto: p.minuto } : { hora: 9, minuto: 0 };
  return instanteNoFuso(d.ano, d.mes, d.dia, h.hora, h.minuto, fuso);
}

export interface Recorrencia {
  frequencia: 'uma_vez' | 'diario' | 'semanal' | 'mensal';
  hora: string;
  diasSemana: number[];
  diaMes: number;
  /** AAAA-MM-DD, só em `uma_vez`. */
  data?: string;
}

/**
 * Instante único de `uma_vez` (data + hora no fuso), ou null se já passou de
 * `depois` (ou sem data): não há próxima janela e a agenda do nó sai.
 */
export function janelaUnica(r: Recorrencia, fuso: string, depois: Date): Date | null {
  if (!r.data) return null;
  const [ano, mes, dia] = r.data.split('-').map(Number);
  const { hora, minuto } = hhmm(r.hora);
  const t = instanteNoFuso(ano, mes, dia, hora, minuto, fuso);
  return t.getTime() > depois.getTime() ? t : null;
}

/**
 * Próxima janela do gatilho agendado ESTRITAMENTE depois de `depois`.
 * Mensal com dia 31 em mês curto dispara no último dia do mês.
 */
export function proximaJanela(r: Recorrencia, fuso: string, depois: Date): Date {
  if (r.frequencia === 'uma_vez') throw new Error('uma_vez não recorre: use janelaUnica');
  const { hora, minuto } = hhmm(r.hora);
  const hoje = partesNoFuso(depois, fuso);
  // 400 dias cobre qualquer combinação (mensal + mês curto, semanal com 1 dia)
  for (let i = 0; i < 400; i++) {
    const d = somarDias(hoje.ano, hoje.mes, hoje.dia, i);
    const diaSemana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
    let casa = true;
    if (r.frequencia === 'semanal') casa = r.diasSemana.includes(diaSemana);
    if (r.frequencia === 'mensal') casa = d.dia === Math.min(r.diaMes, diasNoMes(d.ano, d.mes));
    if (!casa) continue;
    const t = instanteNoFuso(d.ano, d.mes, d.dia, hora, minuto, fuso);
    if (t.getTime() > depois.getTime()) return t;
  }
  throw new Error('recorrência sem próxima janela');
}

/** Valor de `agora.*` na condição: dia da semana, hora, minuto e data no fuso do fluxo. */
export function agoraNoFuso(campo: string, fuso: string, agora = new Date()): unknown {
  const p = partesNoFuso(agora, fuso);
  switch (campo) {
    case 'agora.diaSemana': return p.diaSemana;
    case 'agora.hora': return p.hora;
    case 'agora.minuto': return p.minuto;
    case 'agora.data': return isoData(p.ano, p.mes, p.dia);
    case 'agora.horario': return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
    default: return undefined;
  }
}
