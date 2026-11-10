'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';

/**
 * Toast do kit KHUB: retorno após uma ação ("Etapa atualizada", "Não foi
 * possível salvar"). Empilha (no máximo `max`), some sozinho e pode ser
 * fechado. Leitor de tela: sucesso/info em `role="status"` (polite), erro
 * em `role="alert"` (assertive), para o erro não esperar a fila.
 *
 * Uso: `const toast = useToast(); toast.success('Salvo.')`.
 */

export type ToastTom = 'success' | 'error' | 'info';

export interface ToastOpcoes {
  /** Linha de apoio sob o título. */
  description?: string;
  /** Milissegundos até sumir. Padrão: 4000 (erro: 7000). `0` = só fecha no X. */
  duration?: number;
}

export interface ToastItem extends ToastOpcoes {
  id: number;
  tone: ToastTom;
  title: string;
}

export interface ToastApi {
  /** Mostra um toast e devolve o id (para `dismiss`). */
  show: (t: { tone: ToastTom; title: string } & ToastOpcoes) => number;
  success: (title: string, opts?: ToastOpcoes) => number;
  error: (title: string, opts?: ToastOpcoes) => number;
  info: (title: string, opts?: ToastOpcoes) => number;
  dismiss: (id: number) => void;
}

const DURACAO: Record<ToastTom, number> = { success: 4000, info: 4000, error: 7000 };
const ICONE: Record<ToastTom, IconName> = { success: 'check', error: 'alert', info: 'info' };
const TILE: Record<ToastTom, string> = { success: 'icon-tile-success', error: 'icon-tile-danger', info: 'icon-tile-info' };

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children, max = 4 }: { children: ReactNode; max?: number }) {
  const [itens, setItens] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItens((x) => x.filter((i) => i.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    ({ tone, title, description, duration }) => {
      const id = ++seq.current;
      setItens((x) => [...x, { id, tone, title, description, duration }].slice(-max));
      const ms = duration ?? DURACAO[tone];
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss, max],
  );

  useEffect(() => {
    const mapa = timers.current;
    return () => {
      mapa.forEach((t) => clearTimeout(t));
      mapa.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, opts) => show({ tone: 'success', title, ...opts }),
      error: (title, opts) => show({ tone: 'error', title, ...opts }),
      info: (title, opts) => show({ tone: 'info', title, ...opts }),
    }),
    [show, dismiss],
  );

  const polidos = itens.filter((i) => i.tone !== 'error');
  const erros = itens.filter((i) => i.tone === 'error');

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-toast flex w-[min(380px,calc(100vw-40px))] flex-col gap-2">
        {/* Regiões vivas sempre montadas: o leitor só anuncia mudança em região que já existia. */}
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {polidos.map((t) => (
            <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {erros.map((t) => (
            <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
          ))}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ t, onClose }: { t: ToastItem; onClose: () => void }) {
  return (
    <div className="lg-popover pointer-events-auto flex animate-fade-in items-start gap-2.5 px-3.5 py-3 text-sm text-fg" data-tone={t.tone}>
      <span className={cx('icon-tile mt-0.5 h-6 w-6 rounded-md', TILE[t.tone])} aria-hidden>
        <Icon name={ICONE[t.tone]} size={13} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        <p className="font-medium">{t.title}</p>
        {t.description && <p className="mt-0.5 text-xs text-muted">{t.description}</p>}
      </div>
      <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1 h-7 w-7 shrink-0" aria-label="Fechar aviso" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/**
 * Acesso ao toast. Fora de um `ToastProvider` devolve uma API que não faz
 * nada (e avisa no console em desenvolvimento) em vez de quebrar a tela.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (ctx) return ctx;
  return SEM_PROVIDER;
}

const avisar = () => {
  if (process.env.NODE_ENV !== 'production') console.warn('useToast() usado fora de <ToastProvider>.');
  return 0;
};
const SEM_PROVIDER: ToastApi = { show: avisar, success: avisar, error: avisar, info: avisar, dismiss: () => undefined };
