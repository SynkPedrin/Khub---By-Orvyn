'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '../icons';
import { crm, type SearchResult } from '@/lib/crm';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/modulos';

interface Item {
  label: string;
  href: string;
  icon: IconName;
  hint: string;
}
const NAV_ITEMS: Omit<Item, 'hint'>[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
  { label: 'Pipeline de negócios', href: '/pipeline', icon: 'pipeline' },
  { label: 'Contatos', href: '/contatos', icon: 'contacts' },
  { label: 'Inbox omnichannel', href: '/inbox', icon: 'inbox' },
  { label: 'Agenda', href: '/agenda', icon: 'calendar' },
  { label: 'Marketing', href: '/marketing', icon: 'marketing' },
  { label: 'Financeiro', href: '/financeiro', icon: 'finance' },
  { label: 'Base de conhecimento', href: '/conhecimento', icon: 'knowledge' },
];

// dados reais do CRM (S0-4): GET /v1/crm/search — tenant vem do JWT
const CRM_ICON: Record<SearchResult['tipo'], IconName> = { contato: 'contacts', negocio: 'pipeline', conversa: 'inbox' };
const CRM_HINT: Record<SearchResult['tipo'], string> = { contato: 'Contato', negocio: 'Negócio', conversa: 'Conversa' };

export function CommandBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<{ title: string; slug: string }[]>([]);
  const [crmRows, setCrmRows] = useState<SearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const modulos = useAuth().user?.modulos;
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
    window.addEventListener('khub:cmdk', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('khub:cmdk', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setCrmRows([]);
      setTimeout(() => inputRef.current?.focus(), 20);
      if (!docs.length) {
        fetch('/api/cerebro').then((r) => r.json()).then((d) => setDocs(d.docs ?? [])).catch(() => undefined);
      }
    }
  }, [open, docs.length]);

  // Busca no CRM com debounce — uma query por pausa de digitação, não por tecla.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setCrmRows([]); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(() => {
      crm.search(term)
        .then(setCrmRows)
        .catch(() => setCrmRows([]))
        .finally(() => setBuscando(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const results = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    // Acesso por módulo (ADR-0045): atalho para tela bloqueada não aparece.
    const nav: Item[] = NAV_ITEMS.filter((n) => podeVer(modulos, n.href) && (!term || n.label.toLowerCase().includes(term))).map((n) => ({ ...n, hint: 'Ir para' }));
    const dados: Item[] = crmRows.map((r) => ({ label: r.titulo, href: r.url, icon: CRM_ICON[r.tipo], hint: CRM_HINT[r.tipo] }));
    const knowledge: Item[] = docs
      .filter((d) => term && podeVer(modulos, '/conhecimento') && (d.title + d.slug).toLowerCase().includes(term))
      .slice(0, 4)
      .map((d) => ({ label: d.title, href: `/conhecimento/${d.slug}`, icon: 'knowledge' as IconName, hint: 'Conhecimento' }));
    // dados do tenant primeiro: quem digita um nome quer o contato, não a seção
    return [...dados, ...nav, ...knowledge].slice(0, 12);
  }, [q, docs, crmRows, modulos]);

  useEffect(() => { setActive(0); }, [results.length]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;
  return (
    <div className="lg-backdrop fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div className="lg-sheet w-full max-w-xl animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active].href); }
            }}
            placeholder="Buscar contatos, negócios, conversas, seções…"
            className="w-full bg-transparent py-4 text-base text-fg outline-none placeholder:text-muted"
          />
          {buscando && <span className="animate-pulse text-[11px] text-muted">buscando…</span>}
        </div>
        <div className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
          {results.length === 0 && (
            <div className="px-3 py-6 text-sm text-muted">{buscando ? 'Buscando…' : 'Nada encontrado.'}</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.href + i}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
              style={{ background: i === active ? 'color-mix(in srgb, var(--brand) 12%, transparent)' : 'transparent' }}
            >
              <Icon name={r.icon} size={18} className="text-muted" />
              <span className="flex-1 truncate text-sm font-medium text-fg">{r.label}</span>
              <span className="shrink-0 text-[11px] text-muted">{r.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-muted">
          <span>↑↓ navegar · ↵ abrir · esc fechar</span>
          <span className="font-medium tracking-[0.08em] text-faint">KHUB</span>
        </div>
      </div>
    </div>
  );
}
