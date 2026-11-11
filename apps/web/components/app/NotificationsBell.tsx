'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';
import { settingsApi, type NotificationItem } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';

const ICONE: Record<NotificationItem['tipo'], IconName> = { mensagem: 'inbox', integracao: 'alert', mencao: 'note', disparo_aprovacao: 'send', avaliacao_negativa: 'star' };
const TOM: Record<NotificationItem['tipo'], string> = {
  mensagem: 'bg-brand-soft text-brand',
  integracao: 'bg-warning-soft text-warning',
  mencao: 'bg-warning-soft text-warning',
  disparo_aprovacao: 'bg-brand-soft text-brand',
  avaliacao_negativa: 'bg-warning-soft text-warning',
};

function quando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

/**
 * Central de notificações do topo (S0-5 · Q2.6): não lidas do inbox,
 * integrações quebradas e @menções em notas internas. Tempo real pelo socket
 * (`notification.created` do próprio membro, mensagens novas) com poll de
 * reserva a cada 45s. Clicar abre o objeto e marca aquela como lida; "Marcar
 * todas" zera o contador.
 */
export function NotificationsBell() {
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [erro, setErro] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(() => {
    settingsApi
      .notifications()
      .then((d) => { setItems(d.items); setNaoLidas(d.naoLidas); setErro(false); })
      .catch(() => setErro(true));
  }, []);
  /** Rajada de eventos (várias mensagens chegando) vira UMA leitura. */
  const recarregarEmBreve = useCallback(() => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(carregar, 800);
  }, [carregar]);

  useRealtime({
    'notification.created': (d) => { if (d.paraIdentityId === user?.identityId) recarregarEmBreve(); },
    'message.created': () => recarregarEmBreve(),
  });

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 45_000);
    return () => { clearInterval(t); if (espera.current) clearTimeout(espera.current); };
  }, [carregar]);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [open]);

  const abrirItem = (n: NotificationItem) => {
    setOpen(false);
    if (n.novo) {
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, novo: false } : x)) ?? xs);
      setNaoLidas((c) => Math.max(0, c - 1));
      settingsApi.markNotificationRead(n.id).catch(() => undefined);
    }
    router.push(n.url);
    // Já na tela de destino, a troca de `?c=` não remonta o Inbox: avisa quem estiver ouvindo.
    window.dispatchEvent(new CustomEvent('khub:abrir', { detail: n.url }));
  };

  const marcarTodas = async () => {
    setItems((xs) => xs?.map((x) => ({ ...x, novo: false })) ?? xs);
    setNaoLidas(0);
    await settingsApi.markNotificationsRead().catch(() => carregar());
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) carregar(); }}
        aria-label={naoLidas > 0 ? `Notificações (${naoLidas} não lidas)` : 'Notificações'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="btn btn-ghost btn-icon relative"
      >
        <Icon name="bell" size={19} />
        {naoLidas > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-2xs font-semibold text-white tabular" aria-hidden>
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notificações" className="lg-popover absolute right-0 top-[calc(100%+8px)] z-dropdown w-[22rem] max-w-[calc(100vw-2rem)] animate-scale-in overflow-hidden p-1.5">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold text-fg">Notificações</p>
            {naoLidas > 0 && (
              <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => void marcarTodas()}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          {erro && !items ? (
            <div className="px-3 pb-4 pt-1 text-sm text-muted">
              Não consegui carregar agora.{' '}
              <button type="button" className="font-medium text-brand hover:underline" onClick={carregar}>Tentar de novo</button>
            </div>
          ) : !items ? (
            <div className="space-y-2 px-3 pb-3" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 pb-4 pt-1 text-sm text-muted">Tudo em dia. Nada precisa de você agora.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto scrollbar-thin">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => abrirItem(n)}
                    className={cx('flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--fill-4)]', n.novo && 'bg-[color-mix(in_srgb,var(--brand)_5%,transparent)]')}
                  >
                    <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', TOM[n.tipo])}>
                      <Icon name={ICONE[n.tipo]} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cx('truncate text-sm text-fg', n.novo ? 'font-semibold' : 'font-medium')}>{n.titulo}</span>
                        {n.novo && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="não lida" />}
                      </span>
                      <span className="block truncate text-xs text-muted">{n.detalhe}</span>
                    </span>
                    <span className="shrink-0 text-2xs text-muted tabular">{quando(n.ts)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
