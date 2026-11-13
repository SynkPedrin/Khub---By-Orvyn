import { z } from 'zod';
import { ListaCamposSchema, SLUG_RE } from '../common/public-fields';

/**
 * Agendamento público (Q4.2): contrato da configuração e o cálculo de
 * horários livres — regras PURAS (sem banco, sem relógio implícito), para o
 * teste cobrir fuso, antecedência, janela e choque sem depender de ambiente.
 */

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export const FaixaSchema = z
  .object({ de: z.string().regex(HORA_RE, 'hora no formato HH:MM'), ate: z.string().regex(HORA_RE, 'hora no formato HH:MM') })
  .strict()
  .refine((f) => minutos(f.ate) > minutos(f.de), 'o fim da faixa deve ser depois do início');
export type Faixa = z.infer<typeof FaixaSchema>;

/** Chave = dia da semana (0 = domingo … 6 = sábado). Dia ausente ou vazio = fechado. */
export const HorariosSchema = z
  .record(z.enum(['0', '1', '2', '3', '4', '5', '6']), z.array(FaixaSchema).max(6))
  .superRefine((h, ctx) => {
    for (const [dia, faixas] of Object.entries(h)) {
      const ord = [...(faixas ?? [])].sort((a, b) => minutos(a.de) - minutos(b.de));
      for (let i = 1; i < ord.length; i++) {
        if (minutos(ord[i].de) < minutos(ord[i - 1].ate)) ctx.addIssue({ code: 'custom', message: `faixas sobrepostas no dia ${dia}` });
      }
    }
  });
export type Horarios = z.infer<typeof HorariosSchema>;

export function fusoValido(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const camposPagina = {
  titulo: z.string().trim().min(1, 'informe o título').max(120),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'link: letras minúsculas, números e hífen (4 a 64)'),
  descricao: z.string().trim().max(2000).nullable(),
  duracaoMin: z.number().int().min(5).max(480),
  intervaloMin: z.number().int().min(0).max(240),
  antecedenciaMinHoras: z.number().int().min(0).max(720),
  janelaDias: z.number().int().min(1).max(180),
  horarios: HorariosSchema,
  fuso: z.string().trim().min(1).max(64).refine(fusoValido, 'fuso horário inválido'),
  responsaveis: z.array(z.string().uuid()).max(20),
  distribuicao: z.enum(['round_robin', 'fixo']),
  local: z.string().trim().max(300).nullable(),
  tipo: z.enum(['reuniao', 'call', 'demo', 'visita', 'followup', 'outro']),
  perguntas: ListaCamposSchema.refine((l) => l.length <= 15, 'no máximo 15 perguntas extras').refine((l) => l.every((c) => !c.mapear), 'perguntas extras não são ligadas a campos do contato'),
  confirmacaoAutomatica: z.boolean(),
  estilo: z.object({ cor: z.string().regex(HEX_RE, 'cor em hexadecimal (#RRGGBB)').optional() }).strict(),
  ativo: z.boolean(),
};

export const CriarPaginaSchema = z
  .object({ ...camposPagina, slug: camposPagina.slug.optional() })
  .partial()
  .required({ titulo: true })
  .strict();
export const AtualizarPaginaSchema = z.object(camposPagina).partial().strict();
export type CriarPaginaInput = z.infer<typeof CriarPaginaSchema>;
export type AtualizarPaginaInput = z.infer<typeof AtualizarPaginaSchema>;

/**
 * Página pessoal (CAL-PESSOAL, db/069): o colaborador edita a própria página,
 * mas nunca a fila — `responsaveis=[ele]`, `distribuicao=fixo` e `owner_id`
 * são impostos pelo servidor. Sem `titulo` na 1ª criação, vira "Agendar com
 * {nome}"; sem `slug`, vira o slug do nome + sufixo aleatório.
 */
export const MinhaPaginaSchema = z.object(camposPagina).partial().omit({ responsaveis: true, distribuicao: true }).strict();
export type MinhaPaginaInput = z.infer<typeof MinhaPaginaSchema>;

/** Seg a sex, 9h às 12h e 13h às 18h: ponto de partida de uma página nova. */
export function horariosPadrao(): Horarios {
  const util = [{ de: '09:00', ate: '12:00' }, { de: '13:00', ate: '18:00' }];
  return { '1': util, '2': util, '3': util, '4': util, '5': util };
}

export const ReservaPublicaSchema = z
  .object({
    inicio: z.string().datetime({ offset: true }),
    nome: z.string().trim().min(2, 'informe seu nome').max(120),
    telefone: z.string().trim().min(8, 'informe seu telefone').max(30),
    email: z.string().trim().max(254).optional().or(z.literal('')),
    respostas: z.record(z.unknown()).default({}),
    consentimento: z.boolean().optional(),
    carimbo: z.string().max(200).optional(),
    website: z.unknown().optional(),
    utm: z.record(z.unknown()).optional(),
    pagina: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
  })
  .strip();

export const RemarcarSchema = z.object({ inicio: z.string().datetime({ offset: true }) }).strip();

// ------------------------------------------------------------------ fuso

/** Deslocamento (ms) do fuso no instante `t`: hora local − UTC. */
export function offsetDoFuso(t: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return local - (t - (t % 1000));
}

/** "2026-11-20" + 540 min no fuso → instante UTC (ms). Ajusta a virada de horário de verão. */
export function instanteLocal(data: string, minutosDoDia: number, fuso: string): number {
  const [a, m, d] = data.split('-').map(Number);
  const ingenuo = Date.UTC(a, m - 1, d, 0, minutosDoDia);
  let t = ingenuo - offsetDoFuso(ingenuo, fuso);
  const corrigido = ingenuo - offsetDoFuso(t, fuso);
  if (corrigido !== t) t = corrigido;
  return t;
}

/** Data local (YYYY-MM-DD) do instante no fuso. */
export function dataNoFuso(t: number, fuso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  return p;
}

export function somarDias(data: string, n: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diaDaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ slots

export interface ConfigSlots {
  duracaoMin: number;
  intervaloMin: number;
  antecedenciaMinHoras: number;
  janelaDias: number;
  horarios: Horarios;
  fuso: string;
  /** Vazio = agenda geral (sem responsável). */
  responsaveis: string[];
}

export interface Ocupado {
  inicio: number;
  fim: number;
  responsavelId: string | null;
  /** Compromisso a ignorar (remarcação do próprio). */
  id?: string;
}

export interface Slot {
  inicio: string;
  fim: string;
  /** Responsáveis livres neste horário (na ordem da configuração). Vazio quando a página usa a agenda geral. */
  livres: string[];
}

/** Primeiro e último dia reserváveis (datas locais no fuso da página). */
export function janelaReservavel(cfg: Pick<ConfigSlots, 'janelaDias' | 'fuso'>, agora: number): { primeiro: string; ultimo: string } {
  const primeiro = dataNoFuso(agora, cfg.fuso);
  return { primeiro, ultimo: somarDias(primeiro, cfg.janelaDias - 1) };
}

/**
 * Mesma regra de choque da AgendaService: compromisso com responsável bloqueia
 * só ele; compromisso da agenda geral (sem responsável) bloqueia todo mundo; e
 * a agenda geral é bloqueada por qualquer compromisso. A folga (`intervaloMin`)
 * vale antes e depois do horário pedido.
 */
function ocupa(o: Ocupado, ini: number, fim: number, folgaMs: number, responsavel: string | null, ignorarId?: string): boolean {
  if (ignorarId && o.id === ignorarId) return false;
  if (!(o.inicio < fim + folgaMs && o.fim > ini - folgaMs)) return false;
  if (responsavel === null) return true;
  return o.responsavelId === null || o.responsavelId === responsavel;
}

/**
 * Horários livres de UM dia local. Passo = duração + intervalo, a partir do
 * início de cada faixa; o slot precisa caber inteiro na faixa, respeitar a
 * antecedência mínima e ter ao menos um responsável livre.
 */
export function calcularSlots(cfg: ConfigSlots, data: string, ocupados: readonly Ocupado[], agora: number, ignorarId?: string): Slot[] {
  if (!DATA_RE.test(data)) return [];
  const { primeiro, ultimo } = janelaReservavel(cfg, agora);
  if (data < primeiro || data > ultimo) return [];
  const faixas = cfg.horarios[String(diaDaSemana(data)) as keyof Horarios] ?? [];
  const passo = cfg.duracaoMin + cfg.intervaloMin;
  const limiteInicio = agora + cfg.antecedenciaMinHoras * 3_600_000;
  const folga = cfg.intervaloMin * 60_000;
  const out: Slot[] = [];
  const vistos = new Set<number>();
  for (const f of [...faixas].sort((a, b) => minutos(a.de) - minutos(b.de))) {
    for (let m = minutos(f.de); m + cfg.duracaoMin <= minutos(f.ate); m += passo) {
      const ini = instanteLocal(data, m, cfg.fuso);
      const fim = ini + cfg.duracaoMin * 60_000;
      if (ini < limiteInicio || vistos.has(ini)) continue;
      // DST: a hora local pode não existir naquele dia; o slot tem de cair no mesmo dia local.
      if (dataNoFuso(ini, cfg.fuso) !== data) continue;
      vistos.add(ini);
      if (cfg.responsaveis.length === 0) {
        if (!ocupados.some((o) => ocupa(o, ini, fim, folga, null, ignorarId))) out.push({ inicio: new Date(ini).toISOString(), fim: new Date(fim).toISOString(), livres: [] });
        continue;
      }
      const livres = cfg.responsaveis.filter((r) => !ocupados.some((o) => ocupa(o, ini, fim, folga, r, ignorarId)));
      if (livres.length) out.push({ inicio: new Date(ini).toISOString(), fim: new Date(fim).toISOString(), livres });
    }
  }
  return out;
}

/**
 * Ordem de tentativa entre os responsáveis livres. `fixo` = só o primeiro da
 * configuração. `round_robin` = a fila começa no cursor e dá a volta; quem
 * está ocupado no horário fica de fora.
 */
export function ordemDeTentativa(responsaveis: readonly string[], livres: readonly string[], distribuicao: 'round_robin' | 'fixo', cursor: number): string[] {
  if (!responsaveis.length) return [];
  if (distribuicao === 'fixo') return livres.includes(responsaveis[0]) ? [responsaveis[0]] : [];
  const n = responsaveis.length;
  const inicio = ((cursor % n) + n) % n;
  const fila = Array.from({ length: n }, (_, i) => responsaveis[(inicio + i) % n]);
  return fila.filter((r) => livres.includes(r));
}

// ------------------------------------------------------------------ .ics

function icsData(t: Date): string {
  return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsTexto(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** Quebra de linha RFC 5545 (75 octetos, continuação com espaço). */
function dobrar(linha: string): string {
  const partes: string[] = [];
  let resto = linha;
  while (Buffer.byteLength(resto) > 75) {
    let corte = 75;
    while (Buffer.byteLength(resto.slice(0, corte)) > 75) corte--;
    partes.push(resto.slice(0, corte));
    resto = ' ' + resto.slice(corte);
  }
  partes.push(resto);
  return partes.join('\r\n');
}

export function gerarIcs(ev: { uid: string; inicio: Date; fim: Date; titulo: string; descricao?: string | null; local?: string | null; organizador?: string; cancelado?: boolean; agora?: Date }): string {
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KHUB//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${ev.cancelado ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}@khub`,
    `DTSTAMP:${icsData(ev.agora ?? new Date())}`,
    `DTSTART:${icsData(ev.inicio)}`,
    `DTEND:${icsData(ev.fim)}`,
    `SUMMARY:${icsTexto(ev.titulo)}`,
    ...(ev.descricao ? [`DESCRIPTION:${icsTexto(ev.descricao)}`] : []),
    ...(ev.local ? [`LOCATION:${icsTexto(ev.local)}`] : []),
    `STATUS:${ev.cancelado ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}
