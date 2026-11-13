'use client';

import { useCallback, useEffect, useState } from 'react';
import { SkeletonDetail } from '@/components/kit';
import { PageShell } from '@/components/revenue/Page';
import { ErrorState } from '@/components/revenue/States';
import { EditorPaginaAgendamento } from '@/components/agenda/EditorPaginaAgendamento';
import { paginasAgendamento, type PaginaAgendamento } from '@/lib/paginas-agendamento';

/** Editor da página de agendamento da equipe (Q4.2). */
export default function EditorPaginaAgendamentoPage({ params }: { params: { id: string } }) {
  const [inicial, setInicial] = useState<PaginaAgendamento | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    paginasAgendamento.obter(params.id).then(setInicial).catch(() => setErro(true));
  }, [params.id]);
  useEffect(carregar, [carregar]);

  if (erro) return <PageShell><ErrorState description="A página não foi encontrada ou a conexão falhou." onRetry={carregar} /></PageShell>;
  if (!inicial) return <PageShell><SkeletonDetail /></PageShell>;

  return <EditorPaginaAgendamento inicial={inicial} voltarHref="/agenda/paginas" onSalvar={(patch) => paginasAgendamento.atualizar(inicial.id, patch)} />;
}
