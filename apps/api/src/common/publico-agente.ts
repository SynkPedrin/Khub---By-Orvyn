/**
 * Público do agente por tag (ADR-0059).
 *
 * Com `config.publico.tags` preenchido, o agente só atende contatos que tenham
 * pelo menos uma dessas tags: não assume a conversa no piloto automático, a
 * conversa nova não nasce com ele e, se mesmo assim chegar uma mensagem numa
 * conversa dele (nó "Ativar IA", botão na conversa), ele não responde.
 * Vazio = todos os contatos (comportamento de antes).
 *
 * Serve para testar um agente só com contatos marcados (ex.: tag "testia")
 * sem ele falar com os clientes reais. Fica em `common` porque CRM (estado
 * inicial da conversa) e agents (modo e runtime) leem. Sem Zod: roda em toda
 * mensagem.
 */
export function publicoDoAgente(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const publico = (config as Record<string, unknown>).publico;
  if (!publico || typeof publico !== 'object' || Array.isArray(publico)) return [];
  const tags = (publico as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** O contato está no público? Público vazio = todos. Comparação sem caixa. */
export function contatoNoPublico(tagsDoContato: readonly string[] | null | undefined, publico: readonly string[]): boolean {
  if (!publico.length) return true;
  if (!tagsDoContato?.length) return false;
  const alvo = new Set(publico.map((t) => t.trim().toLowerCase()));
  return tagsDoContato.some((t) => alvo.has(t.trim().toLowerCase()));
}

/**
 * Variações de caixa para filtrar no banco (`tags hasSome`), que compara exato.
 * O runtime confere de novo sem caixa, então isto só reduz o que é assumido.
 */
export function variacoesDeTag(publico: readonly string[]): string[] {
  const v = new Set<string>();
  for (const t of publico) {
    v.add(t);
    v.add(t.toLowerCase());
    v.add(t.toUpperCase());
    v.add(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }
  return [...v];
}
