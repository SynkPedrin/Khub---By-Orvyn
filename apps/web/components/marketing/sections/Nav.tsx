'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Container } from '@/components/marketing/ui/Container';
import { Wordmark } from '@/components/marketing/ui/Wordmark';
import { LOGIN_URL, SIGNUP_URL } from '@/lib/marketing/env';

const LINKS = [
  { href: '#fluxo', label: 'O fluxo' },
  { href: '#produto', label: 'Produto' },
  { href: '#nyro', label: 'NICO' },
  { href: '#crm', label: 'CRM vs Revenue OS' },
];

/**
 * Nav minimalista: 76px, transparente no topo e translúcida a partir do
 * primeiro scroll. Ao passar pela seção graphite (`data-lp-dark`) ela
 * inverte — fundo escuro, marca e links claros — em vez de deixar uma
 * faixa branca leitosa por cima da ruptura cromática.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [onDark, setOnDark] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const alvos = Array.from(document.querySelectorAll('[data-lp-dark]'));
    if (alvos.length === 0) return;
    // Raiz reduzida à faixa da nav (os 84px do topo da viewport): só
    // conta como "sobre o escuro" a seção que está de fato atrás dela.
    const io = new IntersectionObserver(
      (entries) => setOnDark(entries.some((e) => e.isIntersecting)),
      { rootMargin: `0px 0px -${Math.max(0, window.innerHeight - 84)}px 0px`, threshold: 0 },
    );
    alvos.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, []);

  const fundo = onDark
    ? 'bg-[rgba(21,18,25,0.78)] shadow-[inset_0_-1px_0_0_rgba(248,246,242,0.1)] backdrop-blur-xl'
    : scrolled
      ? 'bg-[rgba(248,246,242,0.82)] shadow-[inset_0_-1px_0_0_var(--lp-rule-soft)] backdrop-blur-xl backdrop-saturate-150'
      : 'bg-transparent';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ${fundo}`}
    >
      <Container className="flex h-[76px] items-center justify-between gap-6">
        <Link href="#top" aria-label="KHUB, início" className="shrink-0">
          <Wordmark
            height={22}
            priority
            label=""
            className={onDark ? 'brightness-0 invert transition-[filter] duration-500' : 'transition-[filter] duration-500'}
          />
        </Link>

        <nav className="hidden items-center gap-9 lg:flex" aria-label="Seções da página">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13.5px] font-medium tracking-[-0.01em] transition-colors duration-300"
              style={{ color: onDark ? 'var(--lp-on-dark-2)' : 'var(--lp-ink-2)' }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-5">
          <Link
            href={LOGIN_URL}
            className="hidden px-2 text-[13.5px] font-medium transition-colors duration-300 sm:inline-flex"
            style={{ color: onDark ? 'var(--lp-on-dark-2)' : 'var(--lp-ink-2)' }}
          >
            Entrar
          </Link>
          <Link
            href={SIGNUP_URL}
            className="inline-flex h-10 items-center rounded-[6px] px-[18px] text-[13.5px] font-semibold tracking-[-0.01em] transition-colors duration-300 hover:bg-[var(--lp-accent)] hover:text-white"
            style={{
              background: onDark ? 'var(--lp-on-dark)' : 'var(--lp-ink)',
              color: onDark ? 'var(--lp-graphite)' : 'var(--lp-bg)',
            }}
          >
            Criar conta
          </Link>
        </div>
      </Container>
    </header>
  );
}
