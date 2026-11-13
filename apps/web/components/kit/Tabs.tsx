'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/components/ui';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Contador ao lado do rótulo (ex.: itens na aba). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  /** Nome acessível do grupo de abas. */
  label: string;
  /** `underline` (perfil, painéis) ou `segmented` (filtros curtos). */
  variant?: 'underline' | 'segmented';
  /** Prefixo dos ids de aba/painel; use o mesmo em `TabPanel`. */
  idBase: string;
  className?: string;
}

const idAba = (base: string, v: string) => `${base}-aba-${v}`;
const idPainel = (base: string, v: string) => `${base}-painel-${v}`;

/**
 * Abas com o padrão WAI-ARIA: `tablist`/`tab`, foco móvel (só a aba ativa
 * entra no Tab), setas esquerda/direita, Home e End. Ativação automática:
 * mover com a seta já troca o painel.
 */
export function Tabs<T extends string>({ value, onChange, items, label, variant = 'underline', idBase, className }: TabsProps<T>) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const habilitadas = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = habilitadas.findIndex((i) => i.value === value);
    let proxima: TabItem<T> | undefined;
    if (e.key === 'ArrowRight') proxima = habilitadas[(idx + 1) % habilitadas.length];
    else if (e.key === 'ArrowLeft') proxima = habilitadas[(idx - 1 + habilitadas.length) % habilitadas.length];
    else if (e.key === 'Home') proxima = habilitadas[0];
    else if (e.key === 'End') proxima = habilitadas[habilitadas.length - 1];
    if (!proxima) return;
    e.preventDefault();
    onChange(proxima.value);
    refs.current.get(proxima.value)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(variant === 'segmented' ? 'segbar max-w-full overflow-x-auto' : 'flex gap-5 overflow-x-auto border-b border-line', className)}
    >
      {items.map((i) => {
        const ativa = i.value === value;
        return (
          <button
            key={i.value}
            ref={(el) => {
              if (el) refs.current.set(i.value, el);
              else refs.current.delete(i.value);
            }}
            type="button"
            role="tab"
            id={idAba(idBase, i.value)}
            aria-selected={ativa}
            aria-controls={idPainel(idBase, i.value)}
            tabIndex={ativa ? 0 : -1}
            disabled={i.disabled}
            onClick={() => onChange(i.value)}
            onKeyDown={onKeyDown}
            className={cx(variant === 'segmented' ? 'seg shrink-0' : 'tab shrink-0', 'disabled:cursor-not-allowed disabled:opacity-50')}
          >
            {i.label}
            {typeof i.count === 'number' && <span className="tabular text-2xs text-muted">{i.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Painel de uma aba (renderiza só quando ativo). */
export function TabPanel({ idBase, value, active, children, className }: { idBase: string; value: string; active: boolean; children: ReactNode; className?: string }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={idPainel(idBase, value)} aria-labelledby={idAba(idBase, value)} tabIndex={0} className={cx('outline-none', className)}>
      {children}
    </div>
  );
}
