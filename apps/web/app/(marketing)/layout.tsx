/**
 * Grupo de rotas público (marketing): a landing page em "/" e as páginas legais.
 *
 * Escopa a superfície off-white da LP num `<div>` em vez de reescrever o
 * `body` global (`app/layout.tsx`), que o app autenticado também usa.
 * `antialiased` + `selection` ametista alinham a renderização da LP com
 * as telas de auth (`components/app/AuthShell.tsx`).
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--lp-bg)] text-[var(--lp-ink)] antialiased selection:bg-[var(--lp-accent)] selection:text-[var(--lp-bg)]">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      {children}
    </div>
  );
}
