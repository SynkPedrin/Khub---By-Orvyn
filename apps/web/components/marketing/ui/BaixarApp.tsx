'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Ícone de celular com seta (baixar app). */
export function IconeBaixarApp({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 7.5v6.5M9.5 11.5 12 14l2.5-2.5M10.5 18.5h3" />
    </svg>
  );
}

/**
 * "Baixar app": onde o navegador permite (Chrome/Android/Edge), abre a
 * instalação direto; senão leva para /baixar, que ensina o caminho de cada
 * aparelho (no iPhone é pelo Compartilhar do Safari).
 */
export function BotaoBaixarApp({ className, children, style }: { className?: string; children?: ReactNode; style?: React.CSSProperties }) {
  const router = useRouter();
  return (
    <a
      href="/baixar"
      className={className}
      style={style}
      onClick={async (e) => {
        const pedido = typeof window !== 'undefined' ? window.__khubInstalar : null;
        if (!pedido) return; // segue o link normal para /baixar
        e.preventDefault();
        try {
          await pedido.prompt();
          const { outcome } = await pedido.userChoice;
          if (outcome === 'accepted') window.__khubInstalar = null;
          else router.push('/baixar');
        } catch {
          router.push('/baixar');
        }
      }}
    >
      {children ?? (
        <>
          <IconeBaixarApp /> Baixar app
        </>
      )}
    </a>
  );
}
