'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAgency } from '@/components/agency/AgencyProvider';

/**
 * Guard de rota: só quem tem `contexto` (é membro de alguma agência) pode
 * ver qualquer coisa sob /agency/*. Sem isto um cliente direto que digita a
 * URL na mão via UI renderiza (vazio, mas ainda assim UI de agência com
 * botão "Novo cliente") — o backend já bloqueia a mutação, mas a regra
 * "cliente direto vê ZERO UI de agência" é sobre a UI, não só sobre dado.
 */
export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  const { contexto, carregando } = useAgency();
  const router = useRouter();

  useEffect(() => {
    if (!carregando && !contexto) router.replace('/dashboard');
  }, [carregando, contexto, router]);

  if (carregando || !contexto) {
    return <div className="min-h-screen bg-bg" aria-hidden />;
  }

  return <>{children}</>;
}
