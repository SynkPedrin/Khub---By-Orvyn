'use client';

import { useEffect } from 'react';

/**
 * Grupos de elementos cuja luz segue o ponteiro (ver globals.css):
 *  - controles: brilho especular de `.btn`/`.lg-interactive` (ADR-0029);
 *  - superfícies: reflexo roxo dos StatCards `.card-crystal` (ADR-0034/0036).
 * `.card` saiu da lista no Q1.7: o card comum não usa mais `--lg-x/--lg-y`
 * (superfície neutra, sem holofote), então escrever nele era trabalho morto.
 * Um botão dentro de um StatCard atualiza OS DOIS.
 */
const GRUPOS = ['.btn, .lg-interactive', '.card-crystal'];

/**
 * Luz que reage ao ponteiro.
 *
 * Um único listener passivo no documento (delegação), no máximo uma
 * escrita por frame, e só nos elementos sob o ponteiro: grava `--lg-x` e
 * `--lg-y`, que os gradientes usam como centro. Em telas de toque não há
 * hover, então nem registra. Sem o script, a luz cai no padrão (topo-centro)
 * — nada quebra.
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
      for (const alvo of GRUPOS) {
        const el = e.target.closest<HTMLElement>(alvo);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--lg-x', `${e.clientX - r.left}px`);
        el.style.setProperty('--lg-y', `${e.clientY - r.top}px`);
      }
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
