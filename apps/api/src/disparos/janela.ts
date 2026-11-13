import { z } from 'zod';

/**
 * Janela de envio de um disparo (Q4.3): dias da semana (0 = domingo) e faixa
 * de horas [inicio, fim) no fuso do disparo. Funções puras, com `agora`
 * injetável: o worker e os testes usam o mesmo cálculo.
 */
export const janelaSchema = z
  .object({
    dias: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    inicio: z.number().int().min(0).max(23),
    fim: z.number().int().min(1).max(24),
    fuso: z.string().min(3).max(60).refine(fusoValido, 'fuso horário inválido'),
  })
  .strict()
  .refine((j) => j.inicio < j.fim, { message: 'a hora de início precisa ser antes da hora de fim', path: ['fim'] });
export type JanelaEnvio = z.infer<typeof janelaSchema>;

export const JANELA_PADRAO: JanelaEnvio = { dias: [1, 2, 3, 4, 5], inicio: 9, fim: 18, fuso: 'America/Sao_Paulo' };

export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

const DIA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana, hora, minuto e segundo de `agora` no fuso. */
export function partesLocais(agora: Date, fuso: string): { dia: number; hora: number; minuto: number; segundo: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(agora);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '0';
  return { dia: DIA[p('weekday')] ?? 0, hora: Number(p('hour')) % 24, minuto: Number(p('minute')), segundo: Number(p('second')) };
}

export function dentroDaJanela(agora: Date, j: JanelaEnvio): boolean {
  const l = partesLocais(agora, j.fuso);
  return j.dias.includes(l.dia) && l.hora >= j.inicio && l.hora < j.fim;
}

/**
 * Próximo instante em que a janela está aberta (o próprio `agora` se já
 * estiver). Anda de hora cheia em hora cheia por até 8 dias; janela
 * impossível devolve `null` (o chamador pausa em vez de girar à toa).
 */
export function proximaAbertura(agora: Date, j: JanelaEnvio): Date | null {
  if (dentroDaJanela(agora, j)) return agora;
  const l = partesLocais(agora, j.fuso);
  // início da próxima hora cheia LOCAL (fusos com meia hora também alinham aqui)
  let t = new Date(agora.getTime() - (l.minuto * 60 + l.segundo) * 1000 - agora.getMilliseconds() + 3_600_000);
  for (let i = 0; i < 24 * 8; i++) {
    if (dentroDaJanela(t, j)) return t;
    t = new Date(t.getTime() + 3_600_000);
  }
  return null;
}

/** Meia-noite local de hoje (base do limite diário por tenant). */
export function inicioDoDiaLocal(agora: Date, fuso: string): Date {
  const l = partesLocais(agora, fuso);
  return new Date(agora.getTime() - ((l.hora * 60 + l.minuto) * 60 + l.segundo) * 1000 - agora.getMilliseconds());
}

/** Próxima meia-noite local (quando o limite diário zera). */
export function proximoDiaLocal(agora: Date, fuso: string): Date {
  return new Date(inicioDoDiaLocal(agora, fuso).getTime() + 86_400_000);
}
