'use client';
import { useEffect, useRef } from 'react';

/** Focus stays in the topmost dialog; Escape and close restore its trigger. */
export function useDialogFocus(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    const el = ref.current;
    if (!aberto || !el) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((n) => !n.hidden && n.getAttribute('aria-hidden') !== 'true' && n.getClientRects().length > 0);
    const topo = () => Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1) === el;
    (focusables()[0] ?? el).focus();
    const teclado = (e: KeyboardEvent) => {
      if (!topo()) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fecharRef.current(); return; }
      if (e.key !== 'Tab') return;
      const itens = focusables();
      const primeiro = itens[0], ultimo = itens.at(-1);
      if (!primeiro) { e.preventDefault(); el.focus(); }
      else if (!el.contains(document.activeElement) || (e.shiftKey && document.activeElement === primeiro) || (!e.shiftKey && document.activeElement === ultimo)) {
        e.preventDefault(); (e.shiftKey ? ultimo : primeiro)?.focus();
      }
    };
    document.addEventListener('keydown', teclado, true);
    return () => { document.removeEventListener('keydown', teclado, true); anterior?.focus(); };
  }, [aberto]);
  return ref;
}
