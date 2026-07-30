'use client';

import Image from 'next/image';
import Link from 'next/link';

/**
 * Marca ORVYN OS no topo-centro do navbar — presente em toda a área logada
 * (montada no layout). z-40 fica abaixo das ilhas interativas (z-50) dos cantos,
 * então nunca captura clique delas; escondida em telas estreitas para não colidir.
 */
export function TopCenterLogo() {
  return (
    <div className="pointer-events-none fixed left-1/2 top-1 z-40 hidden -translate-x-1/2 sm:block">
      <Link href="/" aria-label="ORVYN OS" className="pointer-events-auto crystal-logo grid place-items-center rounded-2xl">
        <Image src="/ORVYNOS.png" alt="ORVYN OS" width={208} height={208} unoptimized priority className="h-40 w-40 object-contain sm:h-52 sm:w-52" />
      </Link>
    </div>
  );
}
