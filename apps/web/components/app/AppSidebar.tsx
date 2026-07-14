'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
  { href: '/contatos', label: 'Contatos', icon: 'contacts' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar' },
  { href: '/marketing', label: 'Marketing', icon: 'marketing' },
  { href: '/financeiro', label: 'Financeiro', icon: 'finance' },
  { href: '/conhecimento', label: 'Conhecimento', icon: 'knowledge' },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="flex h-full w-64 flex-col border-r border-line bg-surface">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-4">
        <Image src="/logo.png" alt="Orvyn" width={34} height={34} className="rounded-lg" priority />
        <span className="text-lg font-extrabold tracking-tight text-fg">ORVYN</span>
      </Link>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 scrollbar-thin">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={cx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive(n.href) ? 'bg-brand/12 text-brand' : 'text-fg hover:bg-surface3',
            )}
          >
            <Icon name={n.icon} size={19} className={isActive(n.href) ? 'text-brand' : 'text-muted'} />
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="p-3">
        <div className="rounded-2xl border border-line bg-surface2 p-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
              <Icon name="sparkles" size={15} />
            </span>
            <span className="text-sm font-bold text-fg">Nyro</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">Peça para a Nyro criar um funil, responder um lead ou analisar suas campanhas.</p>
          <Link href="/nyro" onClick={onNavigate} className="btn btn-primary mt-3 w-full text-[13px]">
            Falar com a Nyro
          </Link>
        </div>
      </div>
    </div>
  );
}
