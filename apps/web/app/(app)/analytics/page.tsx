'use client';

import { useEffect, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { analytics, type AiUsage, type AutomacoesStats } from '@/lib/analytics';

const usd = (v: number) => `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: number) => (v || 0).toLocaleString('pt-BR');
const PERIODOS = [7, 30, 90];

export default function AnalyticsPage() {
  const [dias, setDias] = useState(30);
  const [ia, setIa] = useState<AiUsage | null>(null);
  const [auto, setAuto] = useState<AutomacoesStats | null>(null);

  useEffect(() => {
    setIa(null); setAuto(null);
    analytics.aiUsage(dias).then(setIa).catch(() => setIa(null));
    analytics.automacoes(dias).then(setAuto).catch(() => setAuto(null));
  }, [dias]);

  const maxDia = Math.max(1, ...(ia?.porDia.map((d) => d.custo) ?? [0]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">Análises</h1>
          <p className="mt-1 text-sm text-muted">Custo de IA da Nyro e desempenho das automações — dados reais do seu tenant.</p>
        </div>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button key={p} onClick={() => setDias(p)} className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors', dias === p ? 'bg-brand text-white shadow-brand' : 'border border-line text-fg hover:bg-surface2')}>
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Custo de IA */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="sparkles" size={18} /></span>
          <h2 className="text-lg font-bold text-fg">Custo de IA (Nyro)</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { l: 'Custo total', v: ia ? usd(ia.custoUsd) : '—' },
            { l: 'Execuções', v: ia ? num(ia.execucoes) : '—' },
            { l: 'Tokens', v: ia ? num(ia.tokens) : '—' },
            { l: 'Erros', v: ia ? num(ia.erros) : '—' },
          ].map((k) => (
            <Card key={k.l} className="p-4">
              <p className="text-xs font-medium text-muted">{k.l}</p>
              <p className="mt-1.5 text-2xl font-extrabold text-fg">{k.v}</p>
            </Card>
          ))}
        </div>

        {ia && ia.execucoes === 0 && <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-muted">Sem uso de IA no período. Conecte a Anthropic e fale com a Nyro para começar a medir.</p>}

        {ia && ia.execucoes > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <p className="mb-3 text-sm font-bold text-fg">Custo por dia</p>
              <div className="flex h-28 items-end gap-1">
                {ia.porDia.map((d) => (
                  <div key={d.dia} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (d.custo / maxDia) * 100)}%` }} title={`${d.dia}: ${usd(d.custo)}`} />
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <p className="mb-3 text-sm font-bold text-fg">Por agente / modelo</p>
              <div className="space-y-1.5">
                {ia.porAgente.map((a) => (
                  <div key={a.agente} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-fg">{a.agente}</span>
                    <span className="text-muted">{usd(a.custo)} · {num(a.n)}x</span>
                  </div>
                ))}
                <div className="mt-2 border-t border-line pt-2" />
                {ia.porModelo.map((m) => (
                  <div key={m.modelo} className="flex items-center justify-between text-xs">
                    <span className="truncate font-mono text-muted">{m.modelo}</span>
                    <span className="text-muted">{usd(m.custo)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* Automações */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="pipeline" size={18} /></span>
          <h2 className="text-lg font-bold text-fg">Automações</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { l: 'Execuções', v: auto ? num(auto.total) : '—' },
            { l: 'Taxa de sucesso', v: auto ? (auto.taxaSucesso === null ? '—' : `${auto.taxaSucesso}%`) : '—' },
            { l: 'Falhas', v: auto ? num(auto.falhas) : '—' },
            { l: 'Na DLQ', v: auto ? num(auto.naDlq) : '—' },
          ].map((k) => (
            <Card key={k.l} className="p-4">
              <p className="text-xs font-medium text-muted">{k.l}</p>
              <p className="mt-1.5 text-2xl font-extrabold text-fg">{k.v}</p>
            </Card>
          ))}
        </div>
        {auto && auto.total === 0 && <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-muted">Nenhuma execução de automação no período.</p>}
      </section>
    </div>
  );
}
