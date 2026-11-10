import type { InputHTMLAttributes } from 'react';
import { cx } from '../ui';
import { Icon, type IconName } from '../icons';

/** Input com ícone à esquerda — usado nos formulários de autenticação. */
export function IconInput({ icon, className, ...rest }: { icon: IconName } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="group relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-muted transition-colors group-focus-within:text-[#7B2EFF]">
        <Icon name={icon} size={16} />
      </span>
      <input className={cx('input pl-10', className)} {...rest} />
    </div>
  );
}
