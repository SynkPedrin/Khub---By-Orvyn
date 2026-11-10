'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { cx } from '../ui';
import { Icon } from '../icons';

/**
 * Campo de senha com ícone de cadeado + alternância mostrar/esconder — usado
 * por login e cadastro para não duplicar o mesmo botão/estado em cada
 * formulário.
 */
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div className="group relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-muted transition-colors group-focus-within:text-[#7B2EFF]">
        <Icon name="lock" size={16} />
      </span>
      <input type={visivel ? 'text' : 'password'} className={cx('input pl-10 pr-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7B2EFF]/40 rounded-r-xl"
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visivel}
        tabIndex={0}
      >
        <Icon name={visivel ? 'eyeOff' : 'eye'} size={17} />
      </button>
    </div>
  );
}
