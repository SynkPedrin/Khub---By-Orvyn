/**
 * Camada ambiente persistente atrás de todo o shell autenticado.
 *
 * Montada uma única vez em `app/(app)/layout.tsx`, nunca dentro de uma
 * página — layouts do App Router não remontam em navegação dentro do mesmo
 * grupo, então isto já garante persistência sem nenhum estado extra.
 *
 * Decisão de implementação: CSS puro (gradientes + blur), não uma foto
 * arquitetônica real. Sem um asset licenciado validado, uma imagem de stock
 * arbitrária é pior que nenhuma — o brief pede explicitamente esse fallback
 * elegante quando não há asset aprovado. `pointer-events-none` pra nunca
 * capturar clique por engano.
 */
export function AmbientBackground() {
  return <div className="ambient-bg pointer-events-none" aria-hidden />;
}
