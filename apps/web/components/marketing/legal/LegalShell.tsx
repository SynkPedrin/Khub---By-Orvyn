import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Container } from '@/components/marketing/ui/Container';

/**
 * Casca compartilhada por Termos/Privacidade — deliberadamente SEM o `Nav`
 * da landing page (seus links são âncoras `#secao` da home; numa rota
 * própria viram link morto). Header mínimo: marca + "Voltar".
 */
export function LegalShell({ titulo, atualizadoEm, children }: { titulo: string; atualizadoEm: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--lp-rule)] py-5">
        <Container className="flex items-center justify-between">
          <Link href="/" aria-label="KHUB, início">
            <Image src="/khub-logo.png" alt="KHUB" width={751} height={301} unoptimized className="h-[22px] w-auto object-contain" />
          </Link>
          <Link href="/" className="text-sm font-medium text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]">
            ← Voltar ao início
          </Link>
        </Container>
      </header>

      <Container className="max-w-[760px] py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--lp-ink)]">{titulo}</h1>
        <p className="mt-2 text-sm text-[var(--lp-ink-2)]">Última atualização: {atualizadoEm}</p>
        <div className="prose-legal mt-10 space-y-10 text-[15px] leading-relaxed text-[var(--lp-ink-2)]">
          {children}
        </div>
      </Container>

      <footer className="border-t border-[var(--lp-rule)] py-8 text-center text-xs text-[var(--lp-ink-2)]">
        KHUB · <Link href="/termos" className="hover:underline">Termos de Uso</Link> ·{' '}
        <Link href="/privacidade" className="hover:underline">Privacidade</Link>
      </footer>
    </div>
  );
}

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--lp-ink)]">{titulo}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
