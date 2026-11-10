/**
 * Camada ambiente persistente atrás de todo o shell autenticado.
 *
 * Montada uma única vez em `app/(app)/layout.tsx`, nunca dentro de uma
 * página — layouts do App Router não remontam em navegação dentro do mesmo
 * grupo, então isto já garante persistência sem nenhum estado extra.
 *
 * Decisão (rev. 2026-11-09): o fundo é só ILUMINAÇÃO — feixes roxo/lima em
 * CSS puro sobre o off-white, sem foto. O papel de parede oficial da marca
 * (`public/khub-fundo.jpg`) mora dentro dos cards (ver `.card` no globals).
 * `pointer-events-none` pra nunca capturar clique por engano.
 */
export function AmbientBackground() {
  return <div className="ambient-bg pointer-events-none" aria-hidden />;
}
