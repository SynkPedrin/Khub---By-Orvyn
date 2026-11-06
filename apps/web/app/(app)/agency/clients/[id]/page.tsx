'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';
import { PageShell, PageHeader, Section } from '@/components/revenue/Page';
import { EmptyState } from '@/components/revenue/States';
import { Quando } from '@/components/revenue/Quando';
import { useAgency } from '@/components/agency/AgencyProvider';
import { agency, type DetalheClienteAgencia } from '@/lib/agency';
import { moeda } from '@/lib/format';

const ATALHOS: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/leads', label: 'Leads', icon: 'leads' },
  { href: '/pipeline', label: 'Pipeline', icon: 'chart' },
  { href: '/conversas', label: 'Conversas', icon: 'chat' },
  { href: '/automacoes', label: 'Automações', icon: 'zap' },
  { href: '/marketing/ads', label: 'Campanhas', icon: 'marketing' },
  { href: '/analytics', label: 'Analytics', icon: 'trend' },
];

/**
 * Não duplica NENHUMA dessas telas (seção 16 do brief) — os atalhos só
 * entram no contexto do cliente (`entrarNoCliente`) e navegam pra rota
 * operacional real, que já existe e já é real.
 */
export default function AgencyClientDetailPage() {
  const params = useParams<{ id: string }>();
  const { entrarNoCliente, clienteAtivo } = useAgency();
  const [cliente, setCliente] = useState<DetalheClienteAgencia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setCarregando(true);
    setErro(false);
    agency
      .detalheCliente(params.id)
      .then(setCliente)
      .catch(() => setErro(true))
      .finally(() => setCarregando(false));
  }, [params.id]);

  if (carregando) {
    return (
      <PageShell>
        <div className="card h-64 animate-pulse" />
      </PageShell>
    );
  }

  if (erro || !cliente) {
    return (
      <PageShell>
        <div className="card">
          <EmptyState icon="alert" title="Cliente não encontrado" description="Ele pode ter sido removido ou você não tem acesso." action={<Link href="/agency/clients" className="btn btn-sm">Voltar</Link>} />
        </div>
      </PageShell>
    );
  }

  const ativo = cliente.id === clienteAtivo?.id;

  return (
    <PageShell>
      <PageHeader
        title={cliente.nome}
        subtitle={cliente.tenant?.nicho ?? undefined}
        actions={
          <button type="button" className="btn btn-primary" disabled={ativo} onClick={() => entrarNoCliente(cliente.id)}>
            {ativo ? 'Operação atual' : 'Entrar na operação'}
            {!ativo && <Icon name="arrowRight" size={16} />}
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Section title="Atalhos" info="Abrem no contexto real deste cliente">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ATALHOS.map((a) => (
              <button
                key={a.href}
                type="button"
                onClick={async () => {
                  await entrarNoCliente(cliente.id);
                }}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left text-[13px] font-medium text-fg transition hover:border-line-strong hover:bg-surface2"
              >
                <Icon name={a.icon} size={16} className="text-muted" />
                {a.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Resumo">
          <dl className="space-y-3 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Status</dt><dd className="font-medium text-fg">{cliente.status === 'active' ? 'Ativo' : cliente.status}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Leads</dt><dd className="font-medium text-fg">{cliente.contatos}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Negócios</dt><dd className="font-medium text-fg">{cliente.negocios}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Receita registrada</dt><dd className="font-semibold text-brand">{moeda(cliente.receitaFechada)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Criado em</dt><dd className="font-medium text-fg"><Quando data={cliente.createdAt} formato="data" /></dd></div>
          </dl>
        </Section>
      </div>
    </PageShell>
  );
}
