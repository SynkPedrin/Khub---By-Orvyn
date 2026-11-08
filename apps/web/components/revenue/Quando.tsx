'use client';

import { useEffect, useState } from 'react';
import { dataCurta, hora, tempoRelativo } from '@/lib/format';

/**
 * Tempo relativo seguro para SSR.
 *
 * "2 min atrás" depende de `Date.now()`, que difere entre o render do
 * servidor e o do cliente — e o React trata essa diferença como erro de
 * hidratação, derrubando a página inteira para render no cliente.
 *
 * A solução é renderizar uma forma **estável** (data absoluta) no servidor e
 * no primeiro render do cliente, e só trocar para a forma relativa depois de
 * montado. O texto final é o mesmo; some a divergência.
 */
export function Quando({
  data,
  formato = 'relativo',
  className,
}: {
  data: string | Date | null | undefined;
  formato?: 'relativo' | 'data' | 'hora';
  className?: string;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  if (!data) return <span className={className}>-</span>;

  if (formato === 'hora') return <span className={className}>{hora(data)}</span>;
  if (formato === 'data') return <span className={className}>{dataCurta(data)}</span>;

  // Antes de montar: forma absoluta, idêntica nos dois lados.
  const texto = montado ? tempoRelativo(data) : dataCurta(data);

  return (
    <span className={className} suppressHydrationWarning>
      {texto}
    </span>
  );
}
