import Image from 'next/image';
import { cx } from '../ui';

/**
 * Marca ORVYN Revenue OS — wordmark oficial (`/logo-revenue.png`), sem o
 * símbolo à parte.
 */
export function OrvynMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const h = { sm: 20, md: 40, lg: 56 }[size];
  const w = Math.round((h * 2172) / 724);

  return (
    <span className={cx('inline-flex items-center', className)}>
      <Image
        src="/logo-revenue.png"
        alt="ORVYN Revenue OS"
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
export function OrvynSignature({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-6 px-6 py-4', className)}>
      <OrvynMark size="sm" />
      <div className="hidden items-center gap-4 md:flex">
        <span className="h-px w-14 bg-line" aria-hidden />
        <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-faint">
          Sistemas para um crescimento real
        </span>
      </div>
    </div>
  );
}
