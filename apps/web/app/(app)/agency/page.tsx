'use client';

import Link from 'next/link';
import { PageShell, PageHeader, KpiGrid } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { EmptyState } from '@/components/revenue/States';
import { ClientCard } from '@/components/agency/ClientCard';
import { useAgency } from '@/components/agency/AgencyProvider';
import { numero } from '@/lib/format';

/**
 * Agency Home — "Command Center de portfólio" (seção 33/35). NÃO reaproveita
 * o Dashboard operacional de um cliente (seção 12): números aqui são sobre
 * a AGÊNCIA (quantos clientes, negócios abertos no total), nunca uma métrica
 * financeira agregada entre clientes com moedas potencialmente diferentes
 * (seção 32 — nada de somar receita entre operações).
 */
export default function AgencyHomePage() {
  const { contexto, clientes, carregando } = useAgency();

  return (
    <PageShell>
      <PageHeader
        title={contexto ? `Agência ${contexto.nome}` : 'Agência'}
        subtitle="Suas operações, num só lugar."
      />

      {carregando ? (
        <KpiGrid>
          {[0, 1, 2].map((i) => (
            <KpiCard key={i} loading label="" value="" icon="building" />
          ))}
        </KpiGrid>
      ) : (
        <>
          <KpiGrid cols={4}>
            <KpiCard label="Clientes" value={numero(clientes.length)} icon="building" />
            <KpiCard label="Negócios abertos (total)" value={numero(clientes.reduce((s, c) => s + c.negocios, 0))} icon="briefcase" />
            <KpiCard label="Leads (total)" value={numero(clientes.reduce((s, c) => s + c.contatos, 0))} icon="leads" />
            <KpiCard label="Clientes ativos" value={numero(clientes.filter((c) => c.status === 'active').length)} icon="check2" />
          </KpiGrid>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-section">Clientes</h2>
            <Link href="/agency/clients" className="text-[13px] font-medium text-brand hover:underline">
              Ver todos →
            </Link>
          </div>

          {clientes.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="building"
                title="Nenhum cliente ainda"
                description="Crie o primeiro cliente da agência para começar a operar."
                action={
                  <Link href="/agency/clients" className="btn btn-primary btn-sm">
                    Novo cliente
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {clientes.map((c) => (
                <ClientCard key={c.id} cliente={c} />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
