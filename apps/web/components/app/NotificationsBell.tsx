'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { settingsApi, type NotificationItem } from '@/lib/settings';

const ICONE = { mensagem: 'inbox', integracao: 'marketing' } as const;

function quando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

/** Sino real (S0-5): não lidas do inbox + integrações quebradas. Poll a cada 45s. */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const carregar = useCallback(() => {
    settingsApi.notifications()
      .then((d) => { setItems(d.items); setNaoLidas(d.naoLidas); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 45_000);
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => { clearInterval(t); document.removeEventListener('mousedown', h); };
  }, [carregar]);

  const abrir = async () => {
    const novo = !open;
    setOpen(novo);
    if (novo) {
      carregar();
      if (naoLidas > 0) {
        setNaoLidas(0); // marca visto: o painel foi aberto
        await settingsApi.markNotificationsRead().catch(() => undefined);
      }
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={abrir}
        aria-label={naoLidas > 0 ? `Notificações (${naoLidas} não lidas)` : 'Notificações'}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/40 hover:text-fg dark:hover:bg-white/10"
      >
        <Icon name="bell" size={18} />
        {naoLidas > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-2xs font-bold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div className="glass absolute right-0 top-12 w-80 animate-scale-in overflow-hidden rounded-2xl p-1.5">
          <p className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted">Notificações</p>
          {items.length === 0 && <p className="px-3 pb-4 pt-1 text-sm text-muted">Tudo em dia. Nada precisa de você agora.</p>}
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => { setOpen(false); router.push(n.url); }}
                className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-white/40 dark:hover:bg-white/10"
              >
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${n.tipo === 'integracao' ? 'bg-amber-400/20 text-amber-600 dark:text-amber-400' : 'bg-brand/12 text-brand'}`}>
                  <Icon name={ICONE[n.tipo]} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-fg">{n.titulo}</span>
                    {n.novo && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                  </span>
                  <span className="block truncate text-xs text-muted">{n.detalhe}</span>
                </span>
                <span className="shrink-0 text-2xs text-muted">{quando(n.ts)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
