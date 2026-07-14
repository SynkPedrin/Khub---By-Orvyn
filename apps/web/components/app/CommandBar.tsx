'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '../icons';

interface Item {
  label: string;
  href: string;
  icon: IconName;
  hint?: string;
}
const NAV_ITEMS: Item[] = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  { label: 'Pipeline de negócios', href: '/pipeline', icon: 'pipeline' },
  { label: 'Contatos', href: '/contatos', icon: 'contacts' },
  { label: 'Inbox omnichannel', href: '/inbox', icon: 'inbox' },
  { label: 'Agenda', href: '/agenda', icon: 'calendar' },
  { label: 'Marketing', href: '/marketing', icon: 'marketing' },
  { label: 'Financeiro', href: '/financeiro', icon: 'finance' },
  { label: 'Base de conhecimento', href: '/conhecimento', icon: 'knowledge' },
];

export function CommandBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<{ title: string; slug: string }[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('orvyn:cmdk', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('orvyn:cmdk', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
      if (!docs.length) {
        fetch('/api/cerebro').then((r) => r.json()).then((d) => setDocs(d.docs ?? [])).catch(() => undefined);
      }
    }
  }, [open, docs.length]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const nav = NAV_ITEMS.filter((n) => !term || n.label.toLowerCase().includes(term)).map((n) => ({ ...n, kind: 'Ir para' }));
    const knowledge = docs
      .filter((d) => term && (d.title + d.slug).toLowerCase().includes(term))
      .slice(0, 6)
      .map((d) => ({ label: d.title, href: `/conhecimento/${d.slug}`, icon: 'knowledge' as IconName, hint: 'Conhecimento', kind: 'Conhecimento' }));
    return [...nav, ...knowledge].slice(0, 10);
  }, [q, docs]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" style={{ background: 'rgba(20,15,28,0.5)' }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter' && results[active]) go(results[active].href);
            }}
            placeholder="Buscar seções, contatos, conhecimento…"
            className="w-full bg-transparent py-4 text-base text-fg outline-none placeholder:text-muted"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
          {results.length === 0 && <div className="px-3 py-6 text-sm text-muted">Nada encontrado.</div>}
          {results.map((r, i) => (
            <button
              key={r.href + i}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
              style={{ background: i === active ? 'color-mix(in srgb, var(--brand) 12%, transparent)' : 'transparent' }}
            >
              <Icon name={r.icon} size={18} className="text-muted" />
              <span className="flex-1 text-sm font-medium text-fg">{r.label}</span>
              <span className="text-[11px] text-muted">{r.hint ?? 'Ir para'}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>↑↓ navegar · ↵ abrir · esc fechar</span>
          <span>Orvyn</span>
        </div>
      </div>
    </div>
  );
}
