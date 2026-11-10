import { z } from 'zod';

/**
 * Horário de atendimento do agente (ADR-0042). Mora em `agents.config.horario`
 * (sem schema novo). Desligado por padrão: agente existente continua 24h.
 *
 * Fora do horário, o agente:
 *  - `responder_na_abertura`: fica quieto e responde quando abrir;
 *  - `avisar_e_responder_na_abertura`: manda UM aviso por período fechado e
 *    responde quando abrir;
 *  - `transferir_para_equipe`: passa a conversa para a equipe humana.
 */
export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];
export const MODOS_FORA = ['responder_na_abertura', 'avisar_e_responder_na_abertura', 'transferir_para_equipe'] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

const faixaSchema = z
  .object({ inicio: z.string().regex(HHMM, 'use HH:MM'), fim: z.string().regex(HHMM, 'use HH:MM') })
  .strict()
  .refine((f) => minutos(f.fim) > minutos(f.inicio), { message: 'o fim precisa ser depois do início (para virar a noite, use dois dias)' });

const faixasDoDia = z
  .array(faixaSchema)
  .max(4)
  .refine((fs) => [...fs].sort((a, b) => minutos(a.inicio) - minutos(b.inicio)).every((f, i, arr) => i === 0 || minutos(f.inicio) >= minutos(arr[i - 1].fim)), { message: 'faixas do mesmo dia não podem se sobrepor' });

const comercial = [{ inicio: '08:00', fim: '18:00' }];

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

export const horarioSchema = z
  .object({
    ativo: z.boolean().default(false),
    fuso: z.string().max(60).refine(fusoValido, 'fuso horário inválido').default('America/Sao_Paulo'),
    dias: z
      .object({
        dom: faixasDoDia.default([]),
        seg: faixasDoDia.default(comercial),
        ter: faixasDoDia.default(comercial),
        qua: faixasDoDia.default(comercial),
        qui: faixasDoDia.default(comercial),
        sex: faixasDoDia.default(comercial),
        sab: faixasDoDia.default([{ inicio: '08:00', fim: '12:00' }]),
      })
      .strict()
      .default({}),
    /** Datas fechadas (AAAA-MM-DD, no fuso do agente). */
    feriados: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).default([]),
    foraDoHorario: z.enum(MODOS_FORA).default('responder_na_abertura'),
    /** `{{horario}}` vira o resumo dos horários; `{{abertura}}` vira "amanhã às 08:00" etc. */
    mensagemFora: z
      .string()
      .max(500)
      .default('Oi! Recebemos sua mensagem. Nosso atendimento funciona {{horario}}. Respondemos {{abertura}}.'),
  })
  .strict();
export type ConfigHorario = z.infer<typeof horarioSchema>;

// ------------------------------------------------------------ cálculo

interface Local { ano: number; mes: number; dia: number; diaSemana: number; minuto: number; iso: string }

/** Data/hora de parede no fuso (Intl, sem dependência). */
export function horaLocal(instante: Date, fuso: string): Local {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(instante)
      .map((x) => [x.type, x.value]),
  );
  const ano = Number(p.year), mes = Number(p.month), dia = Number(p.day);
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { ano, mes, dia, diaSemana: semana, minuto: Number(p.hour) * 60 + Number(p.minute), iso: `${p.year}-${p.month}-${p.day}` };
}

/** Instante UTC de "ano-mes-dia hh:mm" no fuso (corrige o deslocamento duas vezes por causa de horário de verão). */
export function instanteDe(ano: number, mes: number, dia: number, minuto: number, fuso: string): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, Math.floor(minuto / 60), minuto % 60);
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const l = horaLocal(new Date(t), fuso);
    const comoUtc = Date.UTC(l.ano, l.mes - 1, l.dia, Math.floor(l.minuto / 60), l.minuto % 60);
    t += alvo - comoUtc;
  }
  return new Date(t);
}

export interface EstadoHorario {
  aberto: boolean;
  /** Próximo início de faixa (null = nenhuma faixa nos próximos 14 dias). */
  proximaAbertura: Date | null;
}

export function avaliarHorario(cfg: ConfigHorario, agora: Date = new Date()): EstadoHorario {
  if (!cfg.ativo) return { aberto: true, proximaAbertura: null };
  const feriados = new Set(cfg.feriados);
  const hoje = horaLocal(agora, cfg.fuso);
  const faixas = (diaSemana: number) => cfg.dias[DIAS_SEMANA[diaSemana]] ?? [];

  if (!feriados.has(hoje.iso) && faixas(hoje.diaSemana).some((f) => hoje.minuto >= minutos(f.inicio) && hoje.minuto < minutos(f.fim))) {
    return { aberto: true, proximaAbertura: null };
  }
  for (let d = 0; d <= 14; d++) {
    // Meio-dia evita cair no dia errado em transição de horário de verão.
    const base = new Date(instanteDe(hoje.ano, hoje.mes, hoje.dia, 12 * 60, cfg.fuso).getTime() + d * 86400000);
    const l = horaLocal(base, cfg.fuso);
    if (feriados.has(l.iso)) continue;
    const inicios = faixas(l.diaSemana).map((f) => minutos(f.inicio)).filter((m) => d > 0 || m > hoje.minuto).sort((a, b) => a - b);
    if (inicios.length) return { aberto: false, proximaAbertura: instanteDe(l.ano, l.mes, l.dia, inicios[0], cfg.fuso) };
  }
  return { aberto: false, proximaAbertura: null };
}

const NOMES: Record<DiaSemana, string> = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado' };

/** "de segunda a sexta, das 08:00 às 18:00, e sábado, das 08:00 às 12:00". */
export function resumoHorario(cfg: ConfigHorario): string {
  const grupos: { dias: DiaSemana[]; texto: string }[] = [];
  for (const d of ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as DiaSemana[]) {
    const fs = cfg.dias[d];
    if (!fs.length) continue;
    const texto = fs.map((f) => `das ${f.inicio} às ${f.fim}`).join(' e ');
    const ultimo = grupos[grupos.length - 1];
    const ordem = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
    if (ultimo && ultimo.texto === texto && ordem.indexOf(d) === ordem.indexOf(ultimo.dias[ultimo.dias.length - 1]) + 1) ultimo.dias.push(d);
    else grupos.push({ dias: [d], texto });
  }
  if (!grupos.length) return 'em horário a combinar';
  const partes = grupos.map((g) => `${g.dias.length > 2 ? `de ${NOMES[g.dias[0]]} a ${NOMES[g.dias[g.dias.length - 1]]}` : g.dias.map((x) => NOMES[x]).join(' e ')}, ${g.texto}`);
  return partes.length > 1 ? `${partes.slice(0, -1).join('; ')} e ${partes[partes.length - 1]}` : partes[0];
}

/** "hoje às 14:00" · "amanhã às 08:00" · "na segunda às 08:00" · "em breve". */
export function descreverAbertura(abertura: Date | null, cfg: ConfigHorario, agora: Date = new Date()): string {
  if (!abertura) return 'assim que possível';
  const a = horaLocal(abertura, cfg.fuso), h = horaLocal(agora, cfg.fuso);
  const hora = `${String(Math.floor(a.minuto / 60)).padStart(2, '0')}:${String(a.minuto % 60).padStart(2, '0')}`;
  const dias = Math.round((Date.UTC(a.ano, a.mes - 1, a.dia) - Date.UTC(h.ano, h.mes - 1, h.dia)) / 86400000);
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  if (dias < 7) return `${a.diaSemana === 0 || a.diaSemana === 6 ? 'no' : 'na'} ${NOMES[DIAS_SEMANA[a.diaSemana]]} às ${hora}`;
  return `em ${String(a.dia).padStart(2, '0')}/${String(a.mes).padStart(2, '0')} às ${hora}`;
}

export function mensagemForaDoHorario(cfg: ConfigHorario, abertura: Date | null, agora: Date = new Date()): string {
  return cfg.mensagemFora.replace(/\{\{\s*horario\s*\}\}/g, resumoHorario(cfg)).replace(/\{\{\s*abertura\s*\}\}/g, descreverAbertura(abertura, cfg, agora)).trim();
}
