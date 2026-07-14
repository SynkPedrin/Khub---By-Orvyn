'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { crm, brl, type PipelineData } from '@/lib/crm';

export default function PipelinePage() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = () => crm.pipeline().then(setData).catch(() => setData({ stages: [] }));
  useEffect(() => { load(); }, []);

  const move = async (stageId: string) => {
    if (!dragId || !data) return;
    const id = dragId;
    // otimista
    setData((d) => {
      if (!d) return d;
      let moved: PipelineData['stages'][0]['deals'][0] | undefined;
      const stages = d.stages.map((s) => {
        const keep = s.deals.filter((x) => (x.id === id ? ((moved = x), false) : true));
        return { ...s, deals: keep };
      });
      return { stages: stages.map((s) => (s.id === stageId && moved ? { ...s, deals: [...s.deals, moved] } : s)) };
    });
    setDragId(null);
    setOver(null);
    try { await crm.moveDeal(id, stageId); } catch { load(); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-fg">Pipeline de vendas</h1>
          <p className="text-sm text-muted">Arraste os cards — as mudanças são salvas no banco.</p>
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={16} /> Novo negócio</button>
      </div>

      <div className="flex-1 overflow-x-auto p-4 scrollbar-thin sm:p-6">
        {!data && <p className="text-sm text-muted">Carregando pipeline…</p>}
        <div className="flex gap-4" style={{ minWidth: 'min-content' }}>
          {data?.stages.map((stage) => {
            const sum = stage.deals.reduce((s, d) => s + d.valor, 0);
            return (
              <div
                key={stage.id}
                onDragOver={(e) => { e.preventDefault(); setOver(stage.id); }}
                onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
                onDrop={() => move(stage.id)}
                className="flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-surface2 transition-colors"
                style={{ outline: over === stage.id ? '2px solid var(--brand)' : 'none' }}
              >
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.cor }} />
                    <span className="text-sm font-bold text-fg">{stage.nome}</span>
                    <span className="rounded-full bg-surface3 px-1.5 text-[11px] font-semibold text-muted">{stage.deals.length}</span>
                  </div>
                </div>
                <p className="px-3 pb-2 text-[11px] font-medium text-muted">{brl(sum)}</p>
                <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3 scrollbar-thin" style={{ minHeight: 120 }}>
                  {stage.deals.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      className="card cursor-grab p-3 active:cursor-grabbing"
                      style={{ opacity: dragId === d.id ? 0.5 : 1 }}
                    >
                      <p className="text-sm font-semibold leading-snug text-fg">{d.titulo}</p>
                      <p className="mt-1 text-xs text-muted">{d.contato}</p>
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="text-sm font-bold text-brand">{brl(d.valor)}</span>
                        {d.origem && <Badge tone="neutral">{d.origem}</Badge>}
                      </div>
                    </div>
                  ))}
                  {stage.deals.length === 0 && (
                    <div className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-muted">Solte um card aqui</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
