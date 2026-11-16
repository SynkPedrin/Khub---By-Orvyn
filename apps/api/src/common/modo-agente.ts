/**
 * Modo de um agente de IA ATIVO, como no Conversation AI do GHL (ADR-0048).
 * - `automatico` (piloto automático): como agente principal do canal, responde
 *   todas as conversas que não estão com um humano;
 * - `sugestivo`: não responde sozinho; sugere no Inbox e só responde nas
 *   conversas em que foi ativado (nó "Ativar IA" ou botão na conversa).
 * Desativado = `status !== 'ativo'` (fora do config).
 *
 * Fica em `common` porque CRM (estado inicial da conversa) e agents leem.
 */
export const MODOS_AGENTE = ['automatico', 'sugestivo'] as const;
export type ModoAgente = (typeof MODOS_AGENTE)[number];

/** Modo a partir do `config` cru do banco. Sem Zod: roda em toda conversa nova. Ausente = `automatico`. */
export function modoDoAgente(config: unknown): ModoAgente {
  const modo = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).modo : undefined;
  return modo === 'sugestivo' ? 'sugestivo' : 'automatico';
}
