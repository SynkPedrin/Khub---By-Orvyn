'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/components/ui';

type Gatilho = ReactElement<{
  'aria-describedby'?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
}>;

export interface TooltipProps {
  /** Texto curto de apoio. Não coloque ação nem link dentro (não é focável). */
  content: ReactNode;
  /** Um único elemento focável (botão, link). */
  children: Gatilho;
  side?: 'top' | 'bottom';
  /** Atraso para aparecer no hover, em ms (foco por teclado mostra na hora). */
  delay?: number;
  className?: string;
}

/**
 * Dica acessível sem dependência: aparece no hover e no foco, some com Esc,
 * no blur e ao sair o ponteiro; liga-se ao gatilho por `aria-describedby`
 * (o leitor de tela lê a dica junto do rótulo do controle).
 */
export function Tooltip({ content, children, side = 'top', delay = 350, className }: TooltipProps) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aberto]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!isValidElement(children)) return children;
  const p = children.props;
  // Sempre ligado: elemento oculto referenciado por aria-describedby ainda descreve o
  // controle, então o leitor lê a dica já no foco, sem esperar a re-renderização.
  const descricao = [p['aria-describedby'], id].filter(Boolean).join(' ');

  const gatilho = cloneElement(children, {
    'aria-describedby': descricao,
    onMouseEnter: (e: MouseEvent) => {
      p.onMouseEnter?.(e);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAberto(true), delay);
    },
    onMouseLeave: (e: MouseEvent) => {
      p.onMouseLeave?.(e);
      clearTimeout(timer.current);
      setAberto(false);
    },
    onFocus: (e: FocusEvent) => {
      p.onFocus?.(e);
      setAberto(true);
    },
    onBlur: (e: FocusEvent) => {
      p.onBlur?.(e);
      clearTimeout(timer.current);
      setAberto(false);
    },
  });

  return (
    <span className="relative inline-flex">
      {gatilho}
      <span
        id={id}
        role="tooltip"
        hidden={!aberto}
        className={cx(
          'lg-popover pointer-events-none absolute left-1/2 z-dropdown w-max max-w-[240px] -translate-x-1/2 animate-fade-in px-2.5 py-1.5 text-xs font-medium text-fg',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
