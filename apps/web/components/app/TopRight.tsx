'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { Avatar } from '../ui';
import { NotificationsBell } from './NotificationsBell';
import { useAuth } from '@/lib/auth';

export function TopRight() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    setDark(root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches));
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggleTheme = () => {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
    setDark(!isDark);
  };

  return (
    <div ref={ref} className="fixed right-3 top-3 z-50 flex items-center gap-1.5">
      <div className="glass crystal-edge flex items-center gap-1 rounded-full px-1.5 py-1.5">
        <button onClick={toggleTheme} aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'} title={dark ? 'Tema escuro' : 'Tema claro'} className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
          <Icon name={dark ? 'moon' : 'sun'} size={18} />
          <span className="sr-only">{dark ? 'Escuro' : 'Claro'}</span>
        </button>
        <NotificationsBell />
        <Link href="/configuracoes" aria-label="Configurações" className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10">
          <Icon name="settings" size={18} />
        </Link>

        <button onClick={() => setMenu((m) => !m)} className="ml-0.5 flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2.5 hover:bg-white/40 dark:hover:bg-white/10">
          <Avatar name={user?.name ?? 'Você'} size={34} />
          <div className="hidden text-left leading-tight sm:block">
            <p className="text-sm font-bold text-fg">{user?.name?.split(' ')[0] ?? 'Você'}</p>
            <p className="text-2xs text-muted">{user?.email}</p>
          </div>
          <Icon name="chevronDown" size={15} className="hidden text-muted sm:block" />
        </button>
      </div>

      {menu && (
        <div className="glass crystal-edge absolute right-0 top-14 w-64 animate-scale-in overflow-hidden rounded-2xl p-1.5">
          <div className="flex items-center gap-3 border-b border-line/60 px-3 py-3">
            <Avatar name={user?.name ?? 'Você'} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-fg">{user?.name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
          </div>
          <Link href="/configuracoes?tab=perfil" onClick={() => setMenu(false)} className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/40 dark:hover:bg-white/10"><Icon name="user" size={17} className="text-muted" /> Meu perfil</Link>
          <Link href="/configuracoes" onClick={() => setMenu(false)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/40 dark:hover:bg-white/10"><Icon name="settings" size={17} className="text-muted" /> Configurações da conta</Link>
          <button onClick={toggleTheme} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg hover:bg-white/40 dark:hover:bg-white/10"><Icon name={dark ? 'moon' : 'sun'} size={17} className="text-muted" /> Tema: {dark ? 'escuro' : 'claro'}</button>
          <button onClick={async () => { await signOut(); router.replace('/login'); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"><Icon name="logout" size={17} /> Sair</button>
        </div>
      )}
    </div>
  );
}
