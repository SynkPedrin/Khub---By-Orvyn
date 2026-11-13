'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, SkeletonDetail, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { PageHeader, PageShell } from '@/components/revenue/Page';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { EditorPaginaAgendamento } from '@/components/agenda/EditorPaginaAgendamento';
import { mensagemDeErro } from '@/lib/formularios';
import { paginasAgendamento, type PaginaAgendamento } from '@/lib/paginas-agendamento';

/**
 * Meu link de agendamento (CAL-PESSOAL): todo colaborador tem um calendário
 * individual, com os próprios horários, para compartilhar com os clientes.
 * As reservas caem na agenda dele e formam a visão completa da empresa.
 */
export default function MeuLinkPage() {
  const toast = useToast();
  const [pagina, setPagina] = useState<PaginaAgendamento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    setCarregando(true);
    paginasAgendamento
      .minha()
      .then(setPagina)
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, []);
  useEffect(carregar, [carregar]);

  async function criar() {
    setCriando(true);
    try {
      // Sem corpo: o servidor monta "Agendar com <seu nome>", seg a sex 9–12/13–18.
      setPagina(await paginasAgendamento.salvarMinha({}));
      toast.success('Seu link de agendamento está no ar', { description: 'Ajuste os horários e compartilhe com os clientes.' });
    } catch (e) {
      toast.error(mensagemDeErro(e, 'Não foi possível criar seu link.'));
    } finally {
      setCriando(false);
    }
  }

  if (erro) return <PageShell><ErrorState description="Não foi possível carregar sua página de agendamento." onRetry={carregar} /></PageShell>;
  if (carregando) return <PageShell><SkeletonDetail /></PageShell>;

  if (!pagina) {
    return (
      <PageShell>
        <PageHeader
          title="Meu link de agendamento"
          subtitle="Seu calendário individual: você define os horários, o cliente agenda direto com você."
          actions={<Link href="/agenda" className="btn"><Icon name="calendar" size={16} />Agenda</Link>}
        />
        <EmptyState
          icon="calendar"
          title="Você ainda não tem um link de agendamento"
          description="Crie o seu em um clique: começa com segunda a sexta, 9h às 12h e 13h às 18h, 30 minutos por encontro. As reservas caem na sua agenda e aparecem na visão da equipe."
          action={<Button variant="primary" icon="plus" loading={criando} onClick={() => void criar()}>Criar meu link</Button>}
        />
      </PageShell>
    );
  }

  return <EditorPaginaAgendamento inicial={pagina} voltarHref="/agenda" pessoal onSalvar={(patch) => paginasAgendamento.salvarMinha(patch)} />;
}
