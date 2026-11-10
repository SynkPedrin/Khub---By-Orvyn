'use client';

import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '@/components/ui';

/* ------------------------------------------------------------------ Select */

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'size'> {
  value: T;
  onChange: (value: T) => void;
  /** Opções; `children` (options manuais) também funciona. */
  options?: SelectOption<T>[];
  /** Primeira opção vazia (valor `""`), ex.: "Sem empresa". */
  placeholder?: string;
  size?: 'sm' | 'md';
}

/**
 * Select nativo estilizado (`.select`): o nativo é o mais acessível em
 * teclado, leitor de tela e celular, então o kit não reinventa a lista.
 */
function SelectBase<T extends string>(
  { value, onChange, options, placeholder, size = 'md', className, children, ...rest }: SelectProps<T>,
  ref: React.ForwardedRef<HTMLSelectElement>,
) {
  return (
    <select ref={ref} className={cx('select', size === 'sm' && 'h-8 text-sm', className)} value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}
export const Select = forwardRef(SelectBase) as <T extends string = string>(p: SelectProps<T> & { ref?: React.Ref<HTMLSelectElement> }) => ReturnType<typeof SelectBase>;

/* ------------------------------------------------------------------ Switch */

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Rótulo visível (também é o nome acessível). */
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** `row` = rótulo à esquerda e chave à direita (linhas de configuração). */
  layout?: 'inline' | 'row';
  className?: string;
}

/** Chave liga/desliga com `role="switch"` e `aria-checked`. */
export function Switch({ checked, onChange, label, description, disabled, layout = 'inline', className }: SwitchProps) {
  const id = useId();
  const descId = useId();
  return (
    <div className={cx('flex items-start gap-3', layout === 'row' && 'flex-row-reverse justify-between', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-[var(--fill-1)]',
        )}
      >
        <span className={cx('absolute h-4 w-4 rounded-full bg-surface shadow-sm transition-transform duration-fast', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      <span className="min-w-0">
        <label htmlFor={id} className={cx('block cursor-pointer text-sm font-medium text-fg', disabled && 'cursor-not-allowed opacity-60')}>
          {label}
        </label>
        {description && (
          <span id={descId} className="mt-0.5 block text-xs text-muted">
            {description}
          </span>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ Textarea */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Mostra "n/max" no canto (requer `maxLength`). */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, showCount, maxLength, value, rows = 3, ...rest }, ref) {
  const tamanho = typeof value === 'string' ? value.length : 0;
  return (
    <div className="relative">
      <textarea ref={ref} className={cx('textarea', showCount && !!maxLength && 'pb-6', className)} rows={rows} maxLength={maxLength} value={value} {...rest} />
      {showCount && !!maxLength && (
        <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-2xs tabular text-faint" aria-hidden>
          {tamanho}/{maxLength}
        </span>
      )}
    </div>
  );
});
