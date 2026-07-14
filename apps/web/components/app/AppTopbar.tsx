'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { Avatar } from '../ui';
import { useAuth } from '@/lib/auth';

export function AppTopbar({ onMenu }: { onMenu: () => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md">
      <button className="rounded-lg p-2 text-muted hover:bg-surface3 lg:hidden" onClick={onMenu} aria-label="Menu">
        <Icon name="menu" />
      </button>

      <button
        onClick={() => window.dispatchEvent(new Event('orvyn:cmdk'))}
        className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface2 px-3.5 text-sm text-muted transition-colors hover:border-brand/50 sm:max-w-md"
      >
        <Icon name="search" size={17} />
        <span className="truncate">Buscar contatos, negócios, conhecimento…</span>
        <kbd className="ml-auto hidden rounded border border-line px-1.5 py-0.5 text-[10px] font-medium sm:block">⌘K</kbd>
      </button>

      <button onClick={toggleTheme} className="rounded-xl p-2.5 text-muted hover:bg-surface3" aria-label="Tema">
        <Icon name="sparkles" size={19} />
      </button>
      <button className="relative rounded-xl p-2.5 text-muted hover:bg-surface3" aria-label="Notificações">
        <Icon name="bell" size={19} />
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand" />
      </button>

      <div className="relative" ref={ref}>
        <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-surface3">
          <Avatar name={user?.name ?? 'Você'} size={34} />
          <span className="hidden text-sm font-semibold text-fg sm:block">{user?.name?.split(' ')[0] ?? 'Você'}</span>
          <Icon name="chevronDown" size={16} className="hidden text-muted sm:block" />
        </button>
        {menu && (
          <div className="absolute right-0 mt-2 w-60 animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-sm font-semibold text-fg">{user?.name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                via {user?.provider ?? 'demo'}
              </span>
            </div>
            <div className="p-1.5">
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface3">
                <Icon name="user" size={17} className="text-muted" /> Meu perfil
              </button>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface3">
                <Icon name="settings" size={17} className="text-muted" /> Configurações
              </button>
              <button
                onClick={() => {
                  signOut();
                  router.push('/login');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                <Icon name="logout" size={17} /> Sair
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
