'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { Avatar, cx } from '../ui';
import { useAuth } from '@/lib/auth';

function IslandBtn({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
      {children}
    </button>
  );
}

export function DynamicIsland({ onMobileMenu }: { onMobileMenu: () => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const open = hovered || menu;

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
  };

  return (
    <div ref={ref} className="fixed left-3 top-3 z-50" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="flex items-center gap-2">
        {/* Logo — canto superior esquerdo (trigger da ilha) */}
        <button
          onClick={() => router.push('/')}
          aria-label="Início"
          className="glass depth-hover flex h-[3.4rem] w-[3.4rem] shrink-0 items-center justify-center overflow-hidden rounded-[1.15rem]"
        >
          <Image src="/logo-orvynos.png" alt="ORVYN OS" width={56} height={56} className="h-full w-full object-contain p-1.5" priority />
        </button>

        {/* Ilha dinâmica — expande para a direita no hover (sempre visível no mobile) */}
        <div
          className={cx(
            'glass flex items-center gap-0.5 rounded-[1.6rem] py-2 transition-all duration-300 ease-out',
            open ? 'max-w-[640px] px-2.5 opacity-100' : 'max-w-0 px-0 opacity-0',
            'max-lg:!max-w-[640px] max-lg:!px-2.5 max-lg:!opacity-100',
          )}
          style={{ overflow: menu ? 'visible' : 'hidden' }}
        >
          <IslandBtn label="Menu" onClick={onMobileMenu}>
            <span className="lg:hidden"><Icon name="menu" size={19} /></span>
            <span className="hidden lg:block"><Icon name="dashboard" size={18} /></span>
          </IslandBtn>
          <IslandBtn label="Buscar" onClick={() => window.dispatchEvent(new Event('orvyn:cmdk'))}><Icon name="search" size={18} /></IslandBtn>
          <div className="hidden items-center rounded-full bg-white/25 px-3 text-xs text-muted sm:flex dark:bg-white/5">
            Buscar… <kbd className="ml-2 rounded border border-line px-1 text-[10px]">⌘K</kbd>
          </div>
          <IslandBtn label="Tema" onClick={toggleTheme}><Icon name="sparkles" size={18} /></IslandBtn>
          <div className="relative">
            <IslandBtn label="Notificações">
              <span className="relative"><Icon name="bell" size={18} /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand" /></span>
            </IslandBtn>
          </div>

          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="ml-0.5 flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 hover:bg-white/40 dark:hover:bg-white/10">
              <Avatar name={user?.name ?? 'Você'} size={32} />
              <span className="hidden text-sm font-semibold text-fg sm:block">{user?.name?.split(' ')[0] ?? 'Você'}</span>
            </button>
            {menu && (
              <div className="glass absolute right-0 top-11 w-60 animate-scale-in overflow-hidden rounded-2xl p-1.5">
                <div className="border-b border-line/60 px-3 py-2">
                  <p className="truncate text-sm font-bold text-fg">{user?.name}</p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                </div>
                <button className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/40 dark:hover:bg-white/10"><Icon name="user" size={17} className="text-muted" /> Meu perfil</button>
                <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/40 dark:hover:bg-white/10"><Icon name="settings" size={17} className="text-muted" /> Configurações</button>
                <button onClick={async () => { await signOut(); router.replace('/login'); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"><Icon name="logout" size={17} /> Sair</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
