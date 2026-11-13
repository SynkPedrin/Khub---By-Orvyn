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
  khub: {
    // Já recortado rente ao conteúdo (751×301) — sem margem pra remover.
    src: '/khub-logo.png',
    alt: 'KHUB',
    natural: [751, 301] as const,
    ratio: 751 / 301,
    width: 100,
    height: 100,
    left: 0,
    top: 0,
  },
  nyro: {
    src: '/lp-revenue/brand/nyro-wordmark.png',
    alt: 'NYRO',
    natural: [2172, 724] as const,
    // caixa de tinta: x 120→2076, y 182→502 de 2172×724
    ratio: 1956 / 320,
    width: (2172 / 1956) * 100,
    height: (724 / 320) * 100,
    left: (-120 / 1956) * 100,
    top: (-182 / 320) * 100,
  },
  nico: {
    src: '/nico-logo.png',
    alt: 'NICO',
    natural: [2172, 724] as const,
    // caixa de tinta: x 142→2070, y 58→708 de 2172×724
    ratio: 1928 / 650,
    width: (2172 / 1928) * 100,
    height: (724 / 650) * 100,
    left: (-142 / 1928) * 100,
    top: (-58 / 650) * 100,
  },
} as const;

export function Wordmark({
  mark = 'khub',
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
        width={m.natural[0]}
        height={m.natural[1]}
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
