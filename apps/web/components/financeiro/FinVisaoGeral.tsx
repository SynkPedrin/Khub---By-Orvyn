'use client';

import { useEffect, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SkeletonRows } from '@/components/kit';
import { financeiro, type FluxoCaixa } from '@/lib/financeiro';
import { falhaDeCarga, money, type FalhaCarga } from './fin-utils';
import { FinFalha } from './FinEstado';

/**
 * Visão geral do período: quanto entrou, quanto saiu, saldo, o que ainda
 * falta receber/pagar e a quebra por categoria: o "pra onde o dinheiro vai".
 */
export function FinVisaoGeral({ de, ate }: { de: string; ate: string }) {
  const [fluxo, setFluxo] = useState<FluxoCaixa | null>(null);
  const [falha, setFalha] = useState<FalhaCarga | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setFluxo(null);
    setFalha(null);
    financeiro
      .fluxo(de, ate)
      .then((f) => vivo && setFluxo(f))
      .catch((e) => vivo && setFalha(falhaDeCarga(e, 'o fluxo de caixa')));
    return () => {
      vivo = false;
    };
  }, [de, ate, tentativa]);

  if (falha) return <Card><FinFalha falha={falha} onTentar={() => setTentativa((t) => t + 1)} /></Card>;

  const kpis = [
    { l: 'Entradas', v: fluxo ? money(fluxo.entradasCentavos) : '–', cor: 'text-emerald-600 dark:text-emerald-400', icon: 'trend' as const },
    { l: 'Saídas', v: fluxo ? money(fluxo.saidasCentavos) : '–', cor: 'text-red-500 dark:text-red-400', icon: 'finance' as const },
    { l: 'Saldo', v: fluxo ? money(fluxo.saldoCentavos) : '–', cor: fluxo && fluxo.saldoCentavos < 0 ? 'text-red-500 dark:text-red-400' : 'text-fg', icon: 'dashboard' as const },
    { l: 'A receber', v: fluxo ? money(fluxo.aReceberCentavos) : '–', cor: 'text-fg', icon: 'inbox' as const },
    { l: 'A pagar', v: fluxo ? money(fluxo.aPagarCentavos) : '–', cor: 'text-amber-600 dark:text-amber-400', icon: 'alert' as const },
  ];

  const saidas = (fluxo?.porCategoria ?? []).filter((c) => c.tipo === 'saida');
  const entradas = (fluxo?.porCategoria ?? []).filter((c) => c.tipo === 'entrada');
  const maiorSaida = Math.max(1, ...saidas.map((c) => c.total));
  const maiorEntrada = Math.max(1, ...entradas.map((c) => c.total));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.l} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">{k.l}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name={k.icon} size={17} /></span>
            </div>
            <p className={cx('mt-2 text-xl font-semibold', k.cor)}>{k.v}</p>
          </Card>
        ))}
      </div>

      {!fluxo && <Card><SkeletonRows rows={4} label="Carregando fluxo de caixa" /></Card>}

      {fluxo && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="font-bold text-fg">Pra onde o dinheiro está indo</h2>
            <p className="mt-0.5 text-xs text-muted">Saídas pagas no período, por categoria.</p>
            <div className="mt-4 space-y-3">
              {saidas.length === 0 && <p className="text-sm text-muted">Nenhuma saída paga no período.</p>}
              {saidas.map((c) => (
                <div key={c.categoriaId ?? 'sem'}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-fg">{c.nome ?? 'Sem categoria'}</span>
                    <span className="font-semibold text-fg">{money(c.total)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-red-400/80" style={{ width: `${Math.max(3, (c.total / maiorSaida) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{c.qtd} lançamento{c.qtd !== 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-fg">De onde o dinheiro está vindo</h2>
            <p className="mt-0.5 text-xs text-muted">Entradas pagas no período, por categoria.</p>
            <div className="mt-4 space-y-3">
              {entradas.length === 0 && <p className="text-sm text-muted">Nenhuma entrada paga no período.</p>}
              {entradas.map((c) => (
                <div key={c.categoriaId ?? 'sem'}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-fg">{c.nome ?? 'Sem categoria'}</span>
                    <span className="font-semibold text-fg">{money(c.total)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${Math.max(3, (c.total / maiorEntrada) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{c.qtd} lançamento{c.qtd !== 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
