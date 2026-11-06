import type { ReactNode } from 'react';

/** Coluna de conteúdo da LP — largura máxima larga (1560) e gutter fluido,
 *  para que os screenshots do produto possam ocupar 60–90% da tela em vez
 *  de ficarem espremidos num container de blog. */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`lp-container ${className}`}>{children}</div>;
}
