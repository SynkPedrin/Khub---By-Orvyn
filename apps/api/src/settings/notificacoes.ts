/**
 * Central de notificações (Q2.6) — regra de "nova" e de "lida", pura para teste.
 *
 * Duas origens:
 *  - DERIVADAS (conversa não lida, integração quebrada): sem tabela. "Lida"
 *    é global por `notifsSeenAt` (abrir/marcar todas) ou por item em
 *    `prefs.notifsLidas[id] = ISO`; voltam a ser novas se o objeto mudar
 *    depois (ts > lida).
 *  - PERSISTIDAS (`notifications`, ex.: @menção): "lida" = `lida_em`.
 */

export type TipoNotificacao = 'mensagem' | 'integracao' | 'mencao' | 'disparo_aprovacao' | 'avaliacao_negativa' | 'nico';

export interface NotificationItem {
  id: string;
  tipo: TipoNotificacao;
  titulo: string;
  detalhe: string;
  url: string;
  ts: string;
  novo: boolean;
}

export interface Derivada {
  id: string;
  tipo: 'mensagem' | 'integracao';
  titulo: string;
  detalhe: string;
  url: string;
  ts: string;
}

export interface Persistida {
  id: string;
  titulo: string;
  detalhe: string;
  url: string;
  createdAt: Date;
  lidaEm: Date | null;
  /** Ausente = @menção (registros anteriores à db/061). */
  tipo?: string;
}

const PERSISTIDAS = new Set<TipoNotificacao>(['mencao', 'disparo_aprovacao', 'avaliacao_negativa', 'nico']);
function tipoPersistida(t: string | undefined): TipoNotificacao {
  return t && PERSISTIDAS.has(t as TipoNotificacao) ? (t as TipoNotificacao) : 'mencao';
}

/** Máximo de itens derivados com "lida" individual guardados nas prefs. */
export const MAX_LIDAS_INDIVIDUAIS = 100;

export const ID_NOTIFICACAO = /^(conv|int|men):[0-9a-f-]{36}$/i;

export function lidasDasPrefs(prefs: unknown): Record<string, string> {
  const v = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>).notifsLidas : undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

export function montarNotificacoes(derivadas: Derivada[], persistidas: Persistida[], vistoEm: Date, lidas: Record<string, string>): { items: NotificationItem[]; naoLidas: number } {
  const items: NotificationItem[] = [
    ...derivadas.map((d) => {
      const lida = lidas[d.id];
      const novo = d.ts > vistoEm.toISOString() && !(lida && lida >= d.ts);
      return { ...d, novo };
    }),
    ...persistidas.map((p) => ({
      id: `men:${p.id}`,
      tipo: tipoPersistida(p.tipo),
      titulo: p.titulo,
      detalhe: p.detalhe,
      url: p.url,
      ts: p.createdAt.toISOString(),
      novo: !p.lidaEm,
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  return { items, naoLidas: items.filter((i) => i.novo).length };
}

/** Grava a leitura individual de um item derivado, descartando as mais antigas acima do teto. */
export function registrarLida(lidas: Record<string, string>, id: string, agora: string): Record<string, string> {
  const novo = { ...lidas, [id]: agora };
  const ordenadas = Object.entries(novo).sort((a, b) => b[1].localeCompare(a[1])).slice(0, MAX_LIDAS_INDIVIDUAIS);
  return Object.fromEntries(ordenadas);
}
