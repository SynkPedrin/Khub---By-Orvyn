'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../ui';

/**
 * Assinatura visual em movimento da KHUB — vídeo de cristal usado com
 * moderação em superfícies estratégicas (login, hero do Dashboard,
 * Biblioteca), nunca como decoração repetida em toda tela.
 *
 * Extraído do hero da Biblioteca (`app/(app)/marketing/page.tsx`), que já
 * resolvia certo: carrega só quando a página fica ociosa (não compete com o
 * conteúdo real pelo 1º paint) e respeita `prefers-reduced-motion`. Este
 * componente existe para que as três outras superfícies que passam a usar
 * vídeo (login, Dashboard, Biblioteca) parem de reimplementar a mesma lógica.
 *
 * O arquivo (`/crystal-video.mp4`) é o mesmo `videoROXO.mp4` fornecido —
 * MD5 idêntico, confirmado. Ele **não está otimizado para streaming**
 * (átomo `moov` a 99,8% do arquivo, não no início): o navegador não consegue
 * começar a tocar progressivamente enquanto baixa. É por isso que aqui:
 *   - o vídeo entra depois do 1º paint (ocioso), nunca bloqueando conteúdo;
 *   - existe SEMPRE um poster estático mostrado instantaneamente por baixo;
 *   - a troca do poster pelo vídeo só acontece em `onCanPlay` (crossfade),
 *     nunca antes — sem isso o vídeo "pipoca" na tela quando o buffer
 *     inicial (quase o arquivo inteiro) termina de chegar.
 * Reexportar com `ffmpeg -movflags +faststart` resolveria na raiz; não há
 * ffmpeg neste ambiente para fazer isso agora — ver docs/BRAND_ASSETS.md.
 */
export function KhubBrandMotion({
  poster,
  className,
  overlay,
  eager = false,
}: {
  /** Imagem estática mostrada instantaneamente e usada como fallback/poster. */
  poster?: string;
  /** Classes do container (tamanho, posição, radius) — object-fit já é cover. */
  className?: string;
  /** Camada de scrim/gradiente própria de cada superfície, por cima do vídeo. */
  overlay?: ReactNode;
  /**
   * Pula o `requestIdleCallback` e tenta tocar assim que montar. Usar só
   * onde o vídeo É o conteúdo principal da superfície (ex.: login) — em
   * qualquer outro lugar, `false` (padrão) é o comportamento certo.
   */
  eager?: boolean;
}) {
  const [mostrar, setMostrar] = useState(eager);
  const [pronto, setPronto] = useState(false);
  const [reduzido, setReduzido] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduzido(mq.matches);
    const onChange = () => setReduzido(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (eager || reduzido || typeof window === 'undefined') return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const t = idle ? idle(() => setMostrar(true)) : window.setTimeout(() => setMostrar(true), 1200);
    return () => {
      if (!idle) window.clearTimeout(t as number);
    };
  }, [eager, reduzido]);

  return (
    // `relative h-full w-full`: SEMPRE — é o que ancora os filhos `absolute
    // inset-0`. Nunca passar `absolute`/`fixed` em `className`: colidiria
    // com este `relative` (dois utilitários de `position` no mesmo
    // elemento, resultado imprevisível — foi exatamente esse bug que
    // colapsou o painel do login para 0×0 na primeira versão). Quem
    // precisa posicionar o componente na página envolve com a PRÓPRIA div
    // posicionada por fora, como o AuthShell/Dashboard/Biblioteca fazem.
    <div className={cx('relative h-full w-full overflow-hidden', className)} aria-hidden>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className={cx(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
            pronto && !reduzido ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}

      {mostrar && !reduzido && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          onCanPlay={() => setPronto(true)}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: pronto ? 1 : 0 }}
        >
          <source src="/crystal-video.mp4" type="video/mp4" />
        </video>
      )}

      {overlay}
    </div>
  );
}
