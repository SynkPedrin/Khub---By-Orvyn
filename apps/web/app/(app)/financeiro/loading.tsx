import { SkeletonRows } from '@/components/kit';

/** Estado de carregamento da rota (App Router): skeleton no lugar de tela em branco. */
export default function Loading() {
  return (
    <div className="page-shell mx-auto w-full max-w-[1680px] px-4 py-6 lg:px-8 lg:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="skeleton mb-6 h-8 w-56 rounded-card" />
      <SkeletonRows rows={6} />
    </div>
  );
}
