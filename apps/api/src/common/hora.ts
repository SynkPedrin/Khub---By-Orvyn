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
