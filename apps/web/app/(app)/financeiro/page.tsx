'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tabs } from '@/components/kit';
import { Icon } from '@/components/icons';
import { FinVisaoGeral } from '@/components/financeiro/FinVisaoGeral';
import { FinLancamentos } from '@/components/financeiro/FinLancamentos';
import { FinComissoes } from '@/components/financeiro/FinComissoes';
import { FinCobrancas } from '@/components/financeiro/FinCobrancas';
import { FinCategorias } from '@/components/financeiro/FinCategorias';
import { mesAtual } from '@/components/financeiro/fin-utils';

type Aba = 'visao' | 'lancamentos' | 'comissoes' | 'cobrancas' | 'categorias';

/**
 * Financeiro: gestão completa do dinheiro da empresa: fluxo de caixa
 * (entradas/saídas por categoria), comissões da equipe, cobranças a clientes
 * e importação de planilhas (Avec).
 */
export default function FinanceiroPage() {
  const [aba, setAba] = useState<Aba>('visao');
  const [periodo, setPeriodo] = useState(mesAtual());
  const [tick, setTick] = useState(0);
  const recarregar = () => setTick((t) => t + 1);

  const comPeriodo = aba === 'visao' || aba === 'lancamentos';

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Financeiro</h1>
          <p className="mt-1 text-sm text-muted">Gestão completa: entradas, saídas, comissões da equipe e cobranças.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {comPeriodo && (
            <div className="flex items-center gap-1.5 text-sm text-muted">
              <input type="date" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} className="input" aria-label="Início do período" />
              <span>até</span>
              <input type="date" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} className="input" aria-label="Fim do período" />
            </div>
          )}
          <Link href="/financeiro/importacao" className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-semibold text-fg hover:bg-surface2">
            <Icon name="upload" size={15} /> Importar planilha
          </Link>
        </div>
      </div>

      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        label="Seções do financeiro"
        idBase="fin"
        items={[
          { value: 'visao', label: 'Visão geral' },
          { value: 'lancamentos', label: 'Entradas & saídas' },
          { value: 'comissoes', label: 'Comissões' },
          { value: 'cobrancas', label: 'Cobranças' },
          { value: 'categorias', label: 'Categorias' },
        ]}
      />

      {aba === 'visao' && <FinVisaoGeral de={periodo.de} ate={periodo.ate} key={`v${tick}`} />}
      {aba === 'lancamentos' && <FinLancamentos de={periodo.de} ate={periodo.ate} tick={tick} onMudou={recarregar} />}
      {aba === 'comissoes' && <FinComissoes />}
      {aba === 'cobrancas' && <FinCobrancas onMudou={recarregar} />}
      {aba === 'categorias' && <FinCategorias />}
    </div>
  );
}
