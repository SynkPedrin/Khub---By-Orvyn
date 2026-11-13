'use client';

import { useId } from 'react';
import { motion } from 'framer-motion';

/**
 * Marca da Meta (o "∞") desenhada em SVG e animada:
 *  - ao montar, o traço se desenha (pathLength 0 → 1);
 *  - um brilho percorre o laço sem parar (lento em repouso, rápido simulando);
 *  - simulando, o halo pulsa.
 * `MotionConfig reducedMotion="user"` no layout desliga o movimento para
 * quem pediu menos animação. Cores fixas da marca (não seguem o tema).
 */
const LACO =
  'M50 30 C58 18 66 12 75 12 C86 12 92 22 92 32 C92 42 86 48 78 48 C68 48 58 38 50 30 C42 21 34 12 25 12 C14 12 8 22 8 32 C8 42 14 48 22 48 C32 48 42 39 50 30 Z';

export function MetaLogoAnimado({ size = 44, simulando = false, comFundo = true }: { size?: number; simulando?: boolean; comFundo?: boolean }) {
  const id = useId().replace(/:/g, '');
  const traco = comFundo ? '#ffffff' : `url(#meta-grad-${id})`;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
      {comFundo && (
        <motion.span
          className="absolute inset-0 rounded-[28%]"
          style={{ background: 'linear-gradient(135deg, #0064e0 0%, #0081fb 55%, #00a6ff 100%)' }}
          animate={simulando ? { boxShadow: ['0 0 0 0 rgba(0,129,251,0.55)', '0 0 0 10px rgba(0,129,251,0)'] } : { boxShadow: '0 6px 18px -6px rgba(0,129,251,0.6)' }}
          transition={simulando ? { duration: 1.1, repeat: Infinity, ease: 'easeOut' } : { duration: 0.3 }}
        />
      )}
      <svg viewBox="0 0 100 60" width={size * (comFundo ? 0.74 : 1)} height={size * (comFundo ? 0.74 : 1) * 0.6} className="relative overflow-visible">
        <defs>
          <linearGradient id={`meta-grad-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0064e0" />
            <stop offset="50%" stopColor="#0081fb" />
            <stop offset="100%" stopColor="#00a6ff" />
          </linearGradient>
          <filter id={`meta-brilho-${id}`} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        {/* laço base: desenha ao montar */}
        <motion.path
          d={LACO}
          fill="none"
          stroke={traco}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
        />
        {/* brilho que percorre o laço */}
        <motion.path
          d={LACO}
          fill="none"
          stroke={comFundo ? '#bfe3ff' : '#ffffff'}
          strokeWidth={9}
          strokeLinecap="round"
          filter={`url(#meta-brilho-${id})`}
          initial={{ pathLength: 0.14, pathOffset: 0, opacity: 0 }}
          animate={{ pathOffset: [0, 0.86], opacity: [0, 0.95, 0.95, 0] }}
          transition={{ duration: simulando ? 0.9 : 3.2, repeat: Infinity, ease: 'linear', delay: 1.1, repeatDelay: simulando ? 0 : 1.4 }}
        />
      </svg>
    </span>
  );
}
