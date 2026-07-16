'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { cx } from '../ui';

export function DynamicIsland({ onMobileMenu }: { onMobileMenu: () => void }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <div className="fixed left-3 top-3 z-50" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="flex items-center gap-2">
        {/* Logo — canto superior esquerdo (trigger da ilha) */}
        <button
          onClick={() => router.push('/')}
          aria-label="Início"
          className="glass depth-hover flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.7rem]"
        >
          <Image src="/logo.png" alt="ORVYN OS" width={96} height={96} unoptimized className="h-full w-full object-contain p-2" priority />
        </button>

        {/* Ilha dinâmica — expande no hover (sempre visível no mobile) */}
        <div
          className={cx(
            'glass flex items-center gap-0.5 overflow-hidden rounded-[1.8rem] py-3 transition-all duration-300 ease-out',
            hovered ? 'max-w-[520px] px-2.5 opacity-100' : 'max-w-0 px-0 opacity-0',
            'max-lg:!max-w-[520px] max-lg:!px-2.5 max-lg:!opacity-100',
          )}
        >
          <button aria-label="Menu" onClick={onMobileMenu} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
            <span className="lg:hidden"><Icon name="menu" size={19} /></span>
            <span className="hidden lg:block"><Icon name="dashboard" size={18} /></span>
          </button>
          <button aria-label="Buscar" onClick={() => window.dispatchEvent(new Event('orvyn:cmdk'))} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
            <Icon name="search" size={18} />
          </button>
          <button onClick={() => window.dispatchEvent(new Event('orvyn:cmdk'))} className="ml-0.5 flex items-center rounded-full bg-white/25 px-3.5 py-1.5 text-xs text-muted dark:bg-white/5">
            Buscar contatos, negócios… <kbd className="ml-2 rounded border border-line px-1 text-[10px]">⌘K</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
