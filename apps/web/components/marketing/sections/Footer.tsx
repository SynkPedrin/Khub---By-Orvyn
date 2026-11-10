import Link from 'next/link';
import { Container } from '@/components/marketing/ui/Container';
import { Wordmark } from '@/components/marketing/ui/Wordmark';
import { LOGIN_URL, SIGNUP_URL } from '@/lib/marketing/env';

const SECOES = [
  { href: '#fluxo', label: 'O fluxo' },
  { href: '#produto', label: 'Produto' },
  { href: '#nyro', label: 'NICO' },
  { href: '#crm', label: 'CRM vs Revenue OS' },
];

/** Rodapé compacto — uma faixa, não meia tela vazia. */
export function Footer() {
  return (
    <footer className="border-t border-[var(--lp-rule)]">
      <Container className="flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-4">
          <Wordmark height={20} label="KHUB" />
          <p className="max-w-[34ch] text-[13px] leading-[1.55] text-[var(--lp-ink-3)]">
            Sistema para um crescimento real. Leads, conversas, pipeline, automação e inteligência no mesmo
            registro.
          </p>
        </div>

        <nav aria-label="Rodapé" className="flex flex-wrap gap-x-8 gap-y-3">
          {SECOES.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="text-[13px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]"
            >
              {s.label}
            </a>
          ))}
          <Link href={LOGIN_URL} className="text-[13px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]">
            Entrar
          </Link>
          <Link
            href={SIGNUP_URL}
            className="text-[13px] font-semibold text-[var(--lp-ink)] transition-colors hover:text-[var(--lp-accent)]"
          >
            Criar conta
          </Link>
        </nav>
      </Container>

      <Container className="flex flex-col gap-2 border-t border-[var(--lp-rule-soft)] py-5 text-[12px] text-[var(--lp-ink-4)] sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} KHUB</p>
        <p>NICO, camada de automação e inteligência da KHUB</p>
      </Container>
    </footer>
  );
}
