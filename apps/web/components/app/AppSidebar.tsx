'use client';

import Link from 'next/link';
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
    <div className="glass flex h-full w-60 flex-col rounded-[1.75rem] p-3">
      <nav className="flex-1 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV.map((n) => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              className={cx(
                'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all',
                active ? 'font-bold text-white shadow-brand' : 'font-medium text-fg hover:bg-white/40 dark:hover:bg-white/10',
              )}
              style={active ? { background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' } : undefined}
            >
              <Icon name={n.icon} size={19} className={active ? 'text-white' : 'text-muted'} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-3 rounded-[1.4rem] border border-white/30 bg-white/30 p-3.5 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-white shadow-brand" style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}>
            <Icon name="sparkles" size={15} />
          </span>
          <span className="text-sm font-bold text-fg">Nyro</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">Peça um funil, resposta a lead ou análise de campanhas.</p>
        <Link href="/nyro" onClick={onNavigate} className="btn btn-primary mt-3 w-full text-[13px]">Falar com a Nyro</Link>
      </div>
    </div>
  );
}
