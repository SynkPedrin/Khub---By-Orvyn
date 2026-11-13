'use client';

import { useEffect, useRef } from 'react';

type Props = {
  className?: string;
  /** Número de ondas sobrepostas. */
  lines?: number;
  /** Intensidade geral (0 a 1). */
  intensity?: number;
  /** Altura relativa das ondas em relação ao canvas. */
  amplitude?: number;
};

/**
 * "Outra frequência" (identidade Kroma, ADR-0043): ondas sobrepostas de
 * violeta a lima que vibram como um sinal sendo sintonizado. O ponteiro
 * desloca o pico de energia. Pausa fora da tela e em abas ocultas; com
 * prefers-reduced-motion desenha um quadro estático.
 */
export function FrequencyField({ className, lines = 22, intensity = 1, amplitude = 0.22 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let inView = false;
    let t = Math.random() * 100;
    const focus = { x: 0.62, target: 0.62, energy: 0.6, energyTarget: 0.6 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      focus.x += (focus.target - focus.x) * 0.04;
      focus.energy += (focus.energyTarget - focus.energy) * 0.03;
      const steps = Math.max(80, Math.round(w / 9));
      const mid = h * 0.5;
      const amp = h * amplitude * (0.75 + focus.energy * 0.5);
      for (let i = 0; i < lines; i++) {
        const p = i / (lines - 1);
        const freq = 1.6 + p * 2.4;
        const phase = t * (0.35 + p * 0.25) + i * 0.42;
        // Violeta (139,53,255) para lima (182,255,0) através das ondas
        const r = Math.round(139 + (182 - 139) * p);
        const g = Math.round(53 + (255 - 53) * p);
        const b = Math.round(255 - 255 * p);
        const alpha = (0.05 + 0.16 * Math.sin(p * Math.PI)) * intensity;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const x = s / steps;
          const envelope = Math.exp(-Math.pow((x - focus.x) / 0.26, 2));
          const carrier =
            Math.sin(x * Math.PI * 2 * freq + phase) * 0.55 +
            Math.sin(x * Math.PI * 2 * (freq * 2.1) - phase * 1.3) * 0.25 +
            Math.sin(x * Math.PI * 2 * 0.5 + phase * 0.4) * 0.2;
          const y = mid + carrier * amp * (0.18 + envelope * 0.82) + (p - 0.5) * h * 0.12;
          if (s === 0) ctx.moveTo(x * w, y);
          else ctx.lineTo(x * w, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const loop = () => {
      t += 0.0085;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduced || !inView || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      focus.target = Math.min(0.9, Math.max(0.1, (e.clientX - rect.left) / rect.width));
      const dy = Math.abs(e.clientY - (rect.top + rect.height / 2)) / rect.height;
      focus.energyTarget = Math.max(0.35, 1 - dy);
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [lines, intensity, amplitude]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
