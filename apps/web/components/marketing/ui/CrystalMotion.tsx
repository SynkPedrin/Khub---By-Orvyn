'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Macro de ametista real (`/lp-revenue/motion/crystal.mp4`) — usada como
 * MATERIAL, não como fundo roxo.
 *
 * Segue a mesma lógica de carregamento do `KhubBrandMotion` do app
 * (`components/brand/KhubBrandMotion.tsx`): poster instantâneo, vídeo só
 * depois de `onCanPlay`, e nada de vídeo com `prefers-reduced-motion`.
 *
 * O arquivo não tem o átomo `moov` no início (não está otimizado para
 * streaming), então o poster (`crystal-poster.jpg`) nunca é opcional. Por
 * isso também o vídeo só entra em cena quando o bloco aparece na tela —
 * a LP não paga 5 MB antes do primeiro scroll.
 */
export function CrystalMotion({
  className,
  overlay,
  eager = false,
}: {
  className?: string;
  overlay?: ReactNode;
  eager?: boolean;
}) {
  const [visivel, setVisivel] = useState(eager);
  const [pronto, setPronto] = useState(false);
  const [reduzido, setReduzido] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduzido(mq.matches);
    const onChange = () => setReduzido(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (eager || typeof window === 'undefined') return;
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisivel(true);
          io.disconnect();
        }
      },
      { rootMargin: '280px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  return (
    <div ref={hostRef} className={`relative h-full w-full overflow-hidden ${className ?? ''}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/lp-revenue/posters/crystal-poster.jpg"
        alt=""
        loading="lazy"
        decoding="async"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          pronto && !reduzido ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {visivel && !reduzido && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          onCanPlay={() => setPronto(true)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: pronto ? 1 : 0 }}
        >
          <source src="/lp-revenue/motion/crystal.mp4" type="video/mp4" />
        </video>
      )}

      {overlay}
    </div>
  );
}
