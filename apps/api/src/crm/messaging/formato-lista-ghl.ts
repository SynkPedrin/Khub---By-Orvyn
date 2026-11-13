/**
 * Mensagem interativa de lista do GHL (`#list|...`) em texto legível.
 *
 * O GHL serializa o balão de botões assim:
 *   #list|<texto com |n e | como quebras>/VER OPÇÕES |OPÇÕES|<titulo*desc idN>/...
 * (o idN é o identificador do botão; título e descrição às vezes vêm colados).
 * Importações trazem esse payload cru para o Inbox — aqui ele vira texto
 * legível na HORA DE EXIBIR (o corpo gravado não é alterado).
 */
export function formatarListaGhl(corpo: string): string {
  if (!corpo.startsWith('#list|')) return corpo;
  const bruto = corpo.slice('#list|'.length);
  const [textoBruto, opcoesBruto] = bruto.split(/\/VER OPÇÕES\s*\|OPÇÕES\|?/);
  const texto = textoBruto
    .split(/\|n|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
  if (!opcoesBruto) return texto;
  const opcoes = opcoesBruto
    .split('/')
    .map((o) => o.replace(/\s*\*?\s*id\d+\s*$/, '').replace(/\*/, ' — ').trim())
    .filter(Boolean);
  return opcoes.length ? `${texto}\n\n${opcoes.map((o) => `• ${o}`).join('\n')}` : texto;
}

/** Prévia de uma linha para a lista de conversas (primeiro parágrafo legível). */
export function previaLegivel(previa: string): string {
  return formatarListaGhl(previa).split('\n')[0];
}
