import Image from 'next/image';
import { cx } from '../ui';

/**
 * Marca KHUB — wordmark oficial (`/khub-logo.png`, lockup "K" + "HUB" + "by
 * KHUB ai"). Cores de marca fixas no próprio arquivo: funciona nos dois
 * temas sem inversão.
 */
export function BrandMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const h = { sm: 20, md: 34, lg: 48 }[size];
  const w = Math.round((h * 751) / 301);

  return (
    <span className={cx('inline-flex items-center', className)}>
      <Image
        src="/khub-logo.png"
        alt="KHUB"
        width={w}
        height={h}
        unoptimized
        priority
        className="object-contain"
        style={{ height: h, width: w }}
      />
    </span>
  );
}

/**
 * Assinatura do rodapé: marca à esquerda, mote à direita, separados por um
 * filete. Aparece uma vez por tela, discreta.
 */
export function BrandSignature({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-6 px-6 py-4', className)}>
      <BrandMark size="sm" />
      <div className="hidden items-center gap-4 md:flex">
        <span className="h-px w-14 bg-line" aria-hidden />
        <span className="text-2xs font-medium uppercase tracking-[0.28em] text-faint">
          Sistemas para um crescimento real
        </span>
      </div>
    </div>
  );
}
