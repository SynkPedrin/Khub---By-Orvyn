'use client';

import { useEffect, useState } from 'react';

/**
 * `prefers-reduced-motion` sem quebrar a hidratação.
 *
 * O `useReducedMotion` do Framer Motion lê a media query já na primeira
 * renderização do cliente. Como o servidor não tem media query, quando o
 * usuário pede menos movimento a árvore do cliente sai diferente da do
 * servidor — o React derruba o HTML do servidor e remonta a página
 * inteira ("Hydration failed"). Foi exatamente o que o QA com
 * `reducedMotion: reduce` pegou.
 *
 * Aqui a primeira renderização é sempre `false` (igual ao servidor) e a
 * preferência entra no efeito, depois da hidratação.
 */
export function useReducedMotionSafe() {
  const [reduzido, setReduzido] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduzido(mq.matches);
    const onChange = () => setReduzido(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return reduzido;
}
