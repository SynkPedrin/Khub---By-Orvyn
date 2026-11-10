'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { EmptyState } from '@/components/revenue/States';
import { ClientCard } from '@/components/agency/ClientCard';
import { useAgency } from '@/components/agency/AgencyProvider';
import { agency } from '@/lib/agency';

export default function AgencyClientsPage() {
  const { clientes, carregando, recarregarClientes } = useAgency();
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nome.toLowerCase().includes(q));
  }, [clientes, busca]);

  return (
    <PageShell>
      <PageHeader
        title="Clientes"
        subtitle="Todas as operações desta agência."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCriando(true)}>
            <Icon name="plus" size={16} />
            Novo cliente
          </button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          className="input pl-9"
          placeholder="Buscar cliente..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar cliente"
        />
      </div>

      {carregando ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-40 animate-pulse" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="card">
          <EmptyState icon="building" title={busca ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'} description={busca ? 'Tente outro termo de busca.' : 'Crie o primeiro cliente da agência.'} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((c) => (
            <ClientCard key={c.id} cliente={c} />
          ))}
        </div>
      )}

      {criando && <NovoClienteModal onClose={() => setCriando(false)} onCriado={recarregarClientes} />}
    </PageShell>
  );
}

function NovoClienteModal({ onClose, onCriado }: { onClose: () => void; onCriado: () => Promise<void> }) {
  const [nome, setNome] = useState('');
  const [nicho, setNicho] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      // Reaproveita o provisioning de tenant que já existe (pipeline default,
      // owner, funil) — AgencyService.criarCliente() chama TenantsService.provision(),
      // não duplica essa lógica (seção 15 do brief).
      await agency.criarCliente({ nome, nicho: nicho || undefined });
      await onCriado();
      onClose();
    } catch {
      setErro('Não foi possível criar o cliente. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="lg-backdrop fixed inset-0 z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="card lg-sheet w-full max-w-sm animate-scale-in p-5">
        <h2 className="t-section">Novo cliente</h2>
        <form onSubmit={salvar} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Nome</span>
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" required autoFocus />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Tipo de negócio</span>
            <input className="input" value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Opcional" />
          </label>
          {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{erro}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" className="btn flex-1" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary flex-1" disabled={salvando}>
              {salvando ? 'Criando…' : 'Criar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
