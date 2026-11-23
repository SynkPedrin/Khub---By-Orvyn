'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Número que transiciona suavemente quando o valor muda (KPIs que trocam de
 * período). Implementação própria (~rAF + easing), sem dependência — ver
 * docs/brand/03-tecnologia.md. Usa tabular-nums via classe `tabular`.
 * Respeita prefers-reduced-motion: mostra o valor final direto.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 600,
  className,
}: {
  value: number;
  /** Formatação do valor exibido (moeda, milhar…). Recebe o valor interpolado. */
  format?: (n: number) => string;
  /** Duração da transição em ms (máx. permitido pelo sistema: 600). */
  duration?: number;
  className?: string;
}) {
  const [exibido, setExibido] = useState(value);
  const anterior = useRef(value);
  const raf = useRef<number>(0);

  useEffect(() => {
    const reduz = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const de = anterior.current;
    const para = value;
    anterior.current = value;
    if (reduz || de === para) {
      setExibido(para);
      return;
    }
    const inicio = performance.now();
    const tick = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duration);
      const e = 1 - (1 - t) ** 3; // easeOutCubic
      setExibido(de + (para - de) * e);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(exibido)}
    </span>
  );
}
