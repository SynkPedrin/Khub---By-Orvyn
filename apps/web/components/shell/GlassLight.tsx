'use client';

import { useEffect } from 'react';

/** Elementos cujo brilho especular segue o ponteiro (ver globals.css). */
const ALVO = '.btn, .lg-interactive';

/**
 * Luz do Liquid Glass: o brilho especular dos controles acompanha o
 * ponteiro, como o realce que reage ao movimento nas plataformas Apple.
 *
 * Um único listener passivo no documento (delegação), no máximo uma
 * escrita por frame, e só no elemento sob o ponteiro: grava `--lg-x` e
 * `--lg-y`, que o `::after` de `.btn`/`.lg-interactive` usa como centro
 * do gradiente. Em telas de toque não há hover, então nem registra.
 * Sem o script, o brilho cai no padrão (topo-centro) — nada quebra.
 */
export function GlassLight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let frame = 0;
    let ultimo: PointerEvent | null = null;

    const aplicar = () => {
      frame = 0;
      const e = ultimo;
      if (!e || !(e.target instanceof Element)) return;
      const el = e.target.closest<HTMLElement>(ALVO);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--lg-x', `${e.clientX - r.left}px`);
      el.style.setProperty('--lg-y', `${e.clientY - r.top}px`);
    };

    const mover = (e: PointerEvent) => {
      ultimo = e;
      if (!frame) frame = requestAnimationFrame(aplicar);
    };

    document.addEventListener('pointermove', mover, { passive: true });
    return () => {
      document.removeEventListener('pointermove', mover);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
