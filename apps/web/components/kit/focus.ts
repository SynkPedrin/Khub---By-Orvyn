'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Utilitários de foco e rolagem das sobreposições do kit (Modal, Drawer,
 * Confirm e o drawer de navegação do layout). Sem dependência nova.
 */

const FOCAVEIS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Elementos focáveis por Tab dentro de `raiz`, na ordem do documento. */
export function focaveis(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1,
  );
}

// useLayoutEffect no navegador, useEffect no servidor (sem aviso de SSR).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Prende o foco dentro de `ref` enquanto `ativo`:
 *  - ao abrir, foca `inicial` (se houver), senão o primeiro focável, senão o contêiner;
 *  - Tab / Shift+Tab circulam só dentro do contêiner;
 *  - Esc chama `onEsc` (só a sobreposição do topo responde, ver pilha abaixo);
 *  - ao fechar, devolve o foco a quem estava focado antes de abrir.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  ativo: boolean,
  opts: { onEsc?: () => void; inicial?: RefObject<HTMLElement> } = {},
) {
  const escRef = useRef(opts.onEsc);
  escRef.current = opts.onEsc;
  const inicialRef = opts.inicial;

  useIsoLayoutEffect(() => {
    if (!ativo) return;
    const raiz = ref.current;
    if (!raiz) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pilha.push(raiz);

    const alvo = inicialRef?.current ?? focaveis(raiz)[0] ?? raiz;
    if (alvo === raiz && !raiz.hasAttribute('tabindex')) raiz.setAttribute('tabindex', '-1');
    alvo.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      // Só a sobreposição do topo reage (Confirm aberto sobre um Drawer).
      if (pilha[pilha.length - 1] !== raiz) return;
      if (e.key === 'Escape') {
        if (escRef.current) {
          e.stopPropagation();
          escRef.current();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = focaveis(raiz);
      if (lista.length === 0) {
        e.preventDefault();
        raiz.focus();
        return;
      }
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || !raiz.contains(atual))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (atual === ultimo || !raiz.contains(atual))) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const i = pilha.lastIndexOf(raiz);
      if (i >= 0) pilha.splice(i, 1);
      // Devolve o foco só se ele ainda existir na página.
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true });
    };
  }, [ativo, ref, inicialRef]);
}

/** Pilha de sobreposições abertas: a do topo é quem responde ao teclado. */
const pilha: HTMLElement[] = [];

/**
 * Trava a rolagem do `<body>` enquanto `ativo`. Contador global: dois
 * sheets abertos ao mesmo tempo só destravam quando o último fechar.
 */
let travas = 0;
let overflowOriginal = '';
export function useScrollLock(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    if (travas === 0) {
      overflowOriginal = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    travas += 1;
    return () => {
      travas -= 1;
      if (travas === 0) document.body.style.overflow = overflowOriginal;
    };
  }, [ativo]);
}
