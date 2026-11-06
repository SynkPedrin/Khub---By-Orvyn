import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { ProductScreen } from '@/lib/marketing/screens';

/** Ponto de interesse dentro da janela do app já recortada (0–1) e o
 *  quanto aproximar. `centro` é o que deve ficar no meio do enquadramento;
 *  a conversão para `transform-origin` é feita aqui. */
export type Focus = { x: number; y: number; scale: number };

/** transform-origin que deixa `centro` no meio do quadro para uma dada
 *  escala. Com origem O e escala s, a janela visível é
 *  [O(1−1/s), O(1−1/s)+1/s] — logo O = (c − 0.5/s) / (1 − 1/s). */
function origem(centro: number, scale: number) {
  if (scale <= 1) return 0.5;
  const o = (centro - 0.5 / scale) / (1 - 1 / scale);
  return Math.min(1, Math.max(0, o));
}

function vars(focus: Focus | undefined, chaves: readonly [string, string, string]): CSSProperties {
  if (!focus) return {};
  return {
    [chaves[0]]: focus.scale,
    [chaves[1]]: `${origem(focus.x, focus.scale) * 100}%`,
    [chaves[2]]: `${origem(focus.y, focus.scale) * 100}%`,
  } as CSSProperties;
}

const CHAVES_DESKTOP = ['--lp-zoom', '--lp-zoom-x', '--lp-zoom-y'] as const;
const CHAVES_MOBILE = ['--lp-zoom-m', '--lp-zoom-mx', '--lp-zoom-my'] as const;

/** Só a camada de imagem recortada — sem moldura. Usada quando várias
 *  telas dividem a MESMA moldura (o Revenue Flow troca a tela por dentro
 *  de um único `.lp-shot`). */
export function ProductShotLayer({
  screen,
  sizes = '70vw',
  quality = 82,
  priority = false,
}: {
  screen: ProductScreen;
  sizes?: string;
  quality?: number;
  priority?: boolean;
}) {
  return (
    <Image
      src={screen.src}
      alt={screen.alt}
      width={1448}
      height={1086}
      sizes={sizes}
      quality={quality}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      className="lp-shot-img"
    />
  );
}

/**
 * Moldura de screenshot real do produto.
 *
 * O PNG de origem tem uma moldura clara em volta da janela do app (e uma
 * assinatura no rodapé). `ProductShot` recorta exatamente a janela — os
 * percentuais vivem em `.lp-shot-img` (`app/globals.css`) — para que a
 * interface encoste nas bordas e possa ocupar 60–90% da largura sem
 * parecer "print colado dentro de um card".
 *
 * `focus` / `focusMobile` aproximam uma região sem gerar novo arquivo: é
 * a mesma captura, só enquadrada mais perto. No mobile isso é o que faz a
 * interface continuar legível em 390px.
 */
export function ProductShot({
  screen,
  priority = false,
  sizes = '(max-width: 1024px) 100vw, 70vw',
  focus,
  focusMobile,
  className = '',
  dark = false,
  quality = 92,
}: {
  screen: ProductScreen;
  priority?: boolean;
  sizes?: string;
  focus?: Focus;
  focusMobile?: Focus;
  className?: string;
  dark?: boolean;
  quality?: number;
}) {
  return (
    <div
      className={`lp-shot ${dark ? 'lp-shot-dark' : ''} ${className}`}
      style={{ ...vars(focus, CHAVES_DESKTOP), ...vars(focusMobile, CHAVES_MOBILE) }}
    >
      <div className="lp-shot-frame">
        <Image
          src={screen.src}
          alt={screen.alt}
          width={1448}
          height={1086}
          sizes={sizes}
          quality={quality}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className="lp-shot-img"
        />
      </div>
    </div>
  );
}
