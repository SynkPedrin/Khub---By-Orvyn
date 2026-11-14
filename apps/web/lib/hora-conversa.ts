/**
 * Hora de mensagens e da lista de conversas, SEMPRE a partir do instante ISO e
 * no fuso do navegador. O texto `hora` que vem da API era gravado no fuso do
 * servidor (UTC no Render: tudo 3h adiantado); fica só como último recurso
 * para registros antigos sem data.
 */
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function data(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14:05" da mensagem. */
export function horaMensagem(criadaEm: string | null | undefined, fallback?: string | null): string {
  const d = data(criadaEm);
  return d ? hhmm(d) : fallback ?? '';
}

/** Lista, como no WhatsApp: hoje "14:05", ontem "Ontem", na semana "seg.", antes "12/11" (ou "12/11/25"). */
export function horaLista(iso: string | null | undefined, fallback?: string | null, agora = new Date()): string {
  const d = data(iso);
  if (!d) return fallback ?? '';
  if (mesmoDia(d, agora)) return hhmm(d);
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(d, ontem)) return 'Ontem';
  const dias = (agora.getTime() - d.getTime()) / 864e5;
  if (dias > 0 && dias < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', d.getFullYear() === agora.getFullYear() ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: '2-digit' });
}
