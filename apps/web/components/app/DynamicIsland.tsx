'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { cx } from '../ui';
import { usePersonalization } from './PersonalizationProvider';

export function DynamicIsland({ onMobileMenu }: { onMobileMenu: () => void }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const { logo } = usePersonalization();

  return (
    <div className="fixed left-3 top-3 z-50" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* `relative` + z-index: a ilha nasce ATRÁS da logo e desliza para fora dela. */}
      <div className="relative flex items-center">
        {/* Logo solta — sem cartão, sem moldura. Só o cristal. */}
        <button
          onClick={() => router.push('/')}
          aria-label="Início"
          className="crystal-logo relative z-10 shrink-0 rounded-full"
        >
          <Image src={logo || '/logo.png'} alt="Logo" width={96} height={96} unoptimized className="h-24 w-24 object-contain" priority />
        </button>

        {/* Ilha dinâmica — expande no hover, saindo detrás da logo.
            `-ml-11` a encaixa sob o cristal; `pl-12` impede que os botões
            fiquem escondidos embaixo dele. */}
        <div
          className={cx(
            'crystal-island relative z-0 -ml-11 flex items-center gap-0.5 overflow-hidden rounded-r-[1.8rem] py-3 transition-all duration-300 ease-out',
            hovered ? 'max-w-[560px] pl-12 pr-2.5 opacity-100' : 'max-w-11 pl-11 pr-0 opacity-0',
            'max-lg:!max-w-[560px] max-lg:!pl-12 max-lg:!pr-2.5 max-lg:!opacity-100',
          )}
        >
          <button aria-label="Menu" onClick={onMobileMenu} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
            <span className="lg:hidden"><Icon name="menu" size={19} /></span>
            <span className="hidden lg:block"><Icon name="dashboard" size={18} /></span>
          </button>
          <button aria-label="Buscar" onClick={() => window.dispatchEvent(new Event('khub:cmdk'))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
            <Icon name="search" size={18} />
          </button>
          <button onClick={() => window.dispatchEvent(new Event('khub:cmdk'))} className="ml-0.5 flex shrink-0 items-center rounded-full bg-white/25 px-3.5 py-1.5 text-xs text-muted dark:bg-white/5">
            Buscar contatos, negócios… <kbd className="ml-2 rounded border border-line px-1 text-2xs">⌘K</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
