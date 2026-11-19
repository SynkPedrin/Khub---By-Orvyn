/**
 * Hora de mensagem/conversa no fuso da OPERAÇÃO, não do servidor.
 *
 * O Render roda em UTC: `toLocaleTimeString` sem fuso gravava 14:00 para uma
 * mensagem das 11:00 de Brasília, e todas as conversas apareciam 3h adiantadas.
 * O texto `hora` continua existindo (compatibilidade e realtime), mas a tela
 * deve preferir o ISO (`criadaEm`/`ultimaEm`) formatado no navegador.
 */
export function fusoPadrao(): string {
  return process.env.APP_TIMEZONE || 'America/Sao_Paulo';
}

/** "14:05" no fuso da operação. */
export function horaCurta(d: Date = new Date(), fuso: string = fusoPadrao()): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso });
}

/** Partes da data/hora no fuso (sem depender do fuso do servidor). */
export function partesLocais(ms: number, fuso: string): { data: string; diaSemana: number; minutos: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { data: `${p.year}-${p.month}-${p.day}`, diaSemana: dias[p.weekday] ?? 0, minutos: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Instante (epoch ms) de `data` às `minutos` no fuso, resolvendo o deslocamento do próprio dia. */
export function instanteNoFuso(data: string, minutos: number, fuso: string): number {
  const [y, m, d] = data.split('-').map(Number);
  const palpite = Date.UTC(y, m - 1, d, Math.floor(minutos / 60), minutos % 60);
  // Ajusta pelo deslocamento observado no palpite (2 passos cobrem virada de horário de verão).
  let t = palpite;
  for (let i = 0; i < 2; i++) {
    const p = partesLocais(t, fuso);
    const [py, pm, pd] = p.data.split('-').map(Number);
    const visto = Date.UTC(py, pm - 1, pd, Math.floor(p.minutos / 60), p.minutos % 60);
    t += palpite - visto;
  }
  return t;
}
