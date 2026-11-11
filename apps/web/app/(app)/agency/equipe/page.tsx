'use client';

import { useEffect, useMemo, useState } from 'react';
import { AgencyInvites } from '@/components/agency/AgencyInvites';
import { Avatar, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PageShell, PageHeader, Section } from '@/components/revenue/Page';
import { EmptyState } from '@/components/revenue/States';
import { Quando } from '@/components/revenue/Quando';
import { agency, type ClienteAgencia, type MembroAgencia, type MeuContextoAgencia } from '@/lib/agency';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Membro', viewer: 'Visualizador' };
const ROLES_EDITAVEIS = ['admin', 'member', 'viewer'] as const;

/**
 * Gestão de equipe estilo GHL: cada membro tem papel na agência e uma lista
 * de subcontas visíveis. Lista vazia = acesso global (mesma regra da API).
 * Só owner/admin editam; o dono da agência nunca é editável.
 */
export default function AgencyEquipePage() {
  const [membros, setMembros] = useState<MembroAgencia[] | null>(null);
  const [clientes, setClientes] = useState<ClienteAgencia[]>([]);
  const [contexto, setContexto] = useState<MeuContextoAgencia | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = () => {
    Promise.all([agency.listarMembros(), agency.listarClientes().catch(() => []), agency.meuContexto()])
      .then(([m, c, ctx]) => {
        setMembros(m);
        setClientes(c);
        setContexto(ctx);
      })
      .catch(() => setErro(true));
  };

  useEffect(carregar, []);

  const podeGerenciar = contexto?.role === 'owner' || contexto?.role === 'admin';
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);

  return (
    <PageShell>
      <PageHeader title="Equipe" subtitle="Quem tem acesso a esta agência — e a quais subcontas cada pessoa vê." />

      <AgencyInvites />
      <Section title="Membros">
        {erro ? (
          <EmptyState icon="alert" title="Não foi possível carregar" description="Tente novamente em instantes." />
        ) : !membros ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-12 rounded-md" />)}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {membros.map((m) => (
              <MembroLinha
                key={m.id}
                membro={m}
                clientes={clientes}
                nomeCliente={nomeCliente}
                podeGerenciar={podeGerenciar && m.role !== 'owner'}
                onChange={(atualizado) => setMembros((atual) => atual?.map((x) => (x.id === atualizado.id ? atualizado : x)) ?? null)}
                onRemove={(id) => setMembros((atual) => atual?.filter((x) => x.id !== id) ?? null)}
              />
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}

function MembroLinha({
  membro,
  clientes,
  nomeCliente,
  podeGerenciar,
  onChange,
  onRemove,
}: {
  membro: MembroAgencia;
  clientes: ClienteAgencia[];
  nomeCliente: Map<string, string>;
  podeGerenciar: boolean;
  onChange: (m: MembroAgencia) => void;
  onRemove: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>(membro.clientIds);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const global = membro.clientIds.length === 0;
  const sujo = selecionados.length !== membro.clientIds.length || selecionados.some((id) => !membro.clientIds.includes(id));

  const alternar = (id: string) =>
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));

  const salvarAcesso = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await agency.atualizarMembro(membro.id, { clientIds: selecionados });
      onChange({ ...membro, clientIds: selecionados });
      setAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não foi possível salvar o acesso');
    } finally {
      setSalvando(false);
    }
  };

  const mudarRole = async (role: 'admin' | 'member' | 'viewer') => {
    setErro(null);
    try {
      await agency.atualizarMembro(membro.id, { role });
      onChange({ ...membro, role });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não foi possível mudar o papel');
    }
  };

  const remover = async () => {
    if (!window.confirm(`Remover ${membro.email} da agência? O acesso dele a todas as subcontas cai na hora.`)) return;
    setErro(null);
    try {
      await agency.removerMembro(membro.id);
      onRemove(membro.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não foi possível remover o membro');
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={membro.email} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-fg">{membro.email}</p>
          <p className="text-xs text-muted">
            Membro desde <Quando data={membro.createdAt} formato="data" />
            {' · '}
            {global ? 'Acesso global' : `${membro.clientIds.length} de ${clientes.length} subcontas`}
          </p>
        </div>

        {podeGerenciar ? (
          <>
            <select
              className="select w-auto"
              value={membro.role}
              onChange={(e) => void mudarRole(e.target.value as 'admin' | 'member' | 'viewer')}
              aria-label={`Papel de ${membro.email}`}
            >
              {ROLES_EDITAVEIS.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
              <Icon name="building" size={15} />
              Subcontas
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void remover()}>
              Remover
            </button>
          </>
        ) : (
          <span className="pill shrink-0">{ROLE_LABEL[membro.role] ?? membro.role}</span>
        )}
      </div>

      {erro && <p role="alert" className="mt-2 text-xs text-danger">{erro}</p>}

      {aberto && podeGerenciar && (
        <div className="card-inset mt-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted">Subcontas visíveis para este membro</p>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="checkbox"
                checked={selecionados.length === 0}
                onChange={(e) => setSelecionados(e.target.checked ? [] : clientes.map((c) => c.id))}
              />
              Acesso global (todas)
            </label>
          </div>
          <ul className={cx('mt-3 grid gap-1.5 sm:grid-cols-2', selecionados.length === 0 && 'pointer-events-none opacity-45')}>
            {clientes.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-fg hover:bg-surface3">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selecionados.includes(c.id)}
                    onChange={() => alternar(c.id)}
                  />
                  <span className="truncate">{nomeCliente.get(c.id) ?? c.nome}</span>
                </label>
              </li>
            ))}
            {clientes.length === 0 && <li className="text-xs text-muted">Nenhuma subconta cadastrada ainda.</li>}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={!sujo || salvando} onClick={() => void salvarAcesso()}>
              {salvando ? 'Salvando…' : 'Salvar acesso'}
            </button>
            {sujo && <span className="text-xs text-muted">Alterações não salvas</span>}
          </div>
        </div>
      )}
    </li>
  );
}
