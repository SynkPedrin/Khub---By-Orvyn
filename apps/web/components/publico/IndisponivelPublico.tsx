import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';

/** Estado de erro das páginas públicas (API fora, limite de acesso). 404 usa o not-found do app. */
export function IndisponivelPublico({ status, compacto }: { status: number; compacto?: boolean }) {
  const limite = status === 429;
  return (
    <div className={cx('state', compacto ? 'py-8' : 'card py-14')} role="alert">
      <span className="icon-tile icon-tile-neutral h-11 w-11 rounded-lg">
        <Icon name="alert" size={21} />
      </span>
      <p className="t-section mt-1">{limite ? 'Muitos acessos seguidos' : 'Página indisponível no momento'}</p>
      <p className="max-w-sm text-sm text-muted">{limite ? 'Aguarde alguns minutos e recarregue a página.' : 'Tente de novo em instantes. Se continuar, fale com a empresa por outro canal.'}</p>
    </div>
  );
}
