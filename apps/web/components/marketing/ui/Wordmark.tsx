import Image from 'next/image';

/**
 * Wordmarks reais da marca, recortados.
 *
 * Os PNG originais (2172×724) têm margem transparente enorme: usados
 * direto, a marca renderiza com menos de metade da altura declarada e
 * some no topo da página — foi o que aconteceu na V1. Aqui o recorte é
 * feito no CSS a partir da caixa de tinta medida no arquivo, então
 * `height` é a altura real da marca.
 */
const MARKS = {
  orvyn: {
    src: '/lp-revenue/brand/orvyn-revenue-wordmark.png',
    alt: 'ORVYN Revenue OS',
    // caixa de tinta: x 370→1802, y 224→518 de 2172×724
    ratio: 1432 / 294,
    width: (2172 / 1432) * 100,
    height: (724 / 294) * 100,
    left: (-370 / 1432) * 100,
    top: (-224 / 294) * 100,
  },
  nyro: {
    src: '/lp-revenue/brand/nyro-wordmark.png',
    alt: 'NYRO',
    // caixa de tinta: x 120→2076, y 182→502 de 2172×724
    ratio: 1956 / 320,
    width: (2172 / 1956) * 100,
    height: (724 / 320) * 100,
    left: (-120 / 1956) * 100,
    top: (-182 / 320) * 100,
  },
} as const;

export function Wordmark({
  mark = 'orvyn',
  height = 26,
  priority = false,
  className = '',
  label,
}: {
  mark?: keyof typeof MARKS;
  height?: number;
  priority?: boolean;
  className?: string;
  /** Sobrescreve o alt — use `''` quando a marca for decorativa e o
   *  contexto já nomear a página. */
  label?: string;
}) {
  const m = MARKS[mark];
  return (
    <span
      className={`relative block overflow-hidden ${className}`}
      style={{ height, width: height * m.ratio }}
    >
      <Image
        src={m.src}
        alt={label ?? m.alt}
        width={2172}
        height={724}
        priority={priority}
        className="absolute"
        style={{
          maxWidth: 'none',
          width: `${m.width}%`,
          height: `${m.height}%`,
          left: `${m.left}%`,
          top: `${m.top}%`,
        }}
      />
    </span>
  );
}
