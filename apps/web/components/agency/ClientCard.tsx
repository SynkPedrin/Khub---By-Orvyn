'use client';

import { Icon } from '../icons';
import { moeda } from '@/lib/format';
import { Quando } from '../revenue/Quando';
import { useAgency } from './AgencyProvider';
import type { ClienteAgencia } from '@/lib/agency';

/**
 * Card editorial de cliente (seção 34) — nada de card genérico gigante.
 * Todo número vem de `AgencyService.listarClientes()`, que por sua vez
 * chama `CrmService.overview(tenantId)` — real, tenant-scoped, nunca somado
 * entre clientes.
 */
export function ClientCard({ cliente }: { cliente: ClienteAgencia }) {
  const { entrarNoCliente, clienteAtivo } = useAgency();
  const ativo = cliente.id === clienteAtivo?.id;

  return (
    <div className="card flex flex-col justify-between p-5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold text-fg">{cliente.nome}</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {cliente.isDemo && <span className="pill text-2xs">DEMO</span>}
            {ativo && <span className="pill pill-brand text-2xs">ATUAL</span>}
          </div>
        </div>

        <p className="mt-3 text-[13px] text-muted">
          <span className="font-semibold text-fg">{cliente.contatos}</span> leads ·{' '}
          <span className="font-semibold text-fg">{cliente.negocios}</span> negócios ·{' '}
          <span className="font-semibold text-brand">{moeda(cliente.receitaFechada)}</span> receita registrada
        </p>

        <p className="mt-1.5 text-xs text-faint">
          {cliente.ultimaAtividadeEm ? (
            <>
              Última atividade <Quando data={cliente.ultimaAtividadeEm} />
            </>
          ) : (
            'Sem atividade registrada'
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => entrarNoCliente(cliente.id)}
        disabled={ativo}
        className="btn btn-soft btn-sm mt-4 w-full disabled:opacity-60"
      >
        {ativo ? 'Operação atual' : 'Entrar na operação'}
        {!ativo && <Icon name="arrowRight" size={14} />}
      </button>
    </div>
  );
}
