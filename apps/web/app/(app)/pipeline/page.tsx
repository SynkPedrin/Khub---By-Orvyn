'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { DealDrawer } from '@/components/app/DealDrawer';
import { crm, brl, type Contato, type PipelineData } from '@/lib/crm';
import { useRealtime } from '@/lib/realtime';

export default function PipelinePage() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [form, setForm] = useState({ titulo: '', contactId: '', stageId: '', valor: '', origem: '' });
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(() => crm.pipeline().then(setData).catch(() => setData({ stages: [] })), []);
  useEffect(() => { load(); }, [load]);

  // D2: colega moveu/criou/excluiu um card → o funil se atualiza sozinho.
  // `arrastandoRef` evita o recarregamento puxar o card da mão de quem arrasta.
  const arrastandoRef = useRef(false);
  const recarregarSePossivel = useCallback(() => { if (!arrastandoRef.current) void load(); }, [load]);
  const { conectado } = useRealtime({
    'deal.moved': recarregarSePossivel,
    'deal.created': recarregarSePossivel,
    'deal.updated': recarregarSePossivel,
    'deal.deleted': recarregarSePossivel,
  });
  useEffect(() => { crm.contacts({ limit: 100 }).then((p) => setContatos(p.items)).catch(() => setContatos([])); }, []);

  // deep link vindo da busca ⌘K / perfil 360: /pipeline?deal=<id>
  useEffect(() => {
    const alvo = new URLSearchParams(window.location.search).get('deal');
    if (alvo) setAberto(alvo);
  }, []);

  const stages = data?.stages.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })) ?? [];

  const move = async (stageId: string) => {
    if (!dragId || !data) return;
    const id = dragId;
    // otimista
    setData((d) => {
      if (!d) return d;
      let moved: PipelineData['stages'][0]['deals'][0] | undefined;
      const st = d.stages.map((s) => {
        const keep = s.deals.filter((x) => (x.id === id ? ((moved = x), false) : true));
        return { ...s, deals: keep };
      });
      return { stages: st.map((s) => (s.id === stageId && moved ? { ...s, deals: [...s.deals, moved] } : s)) };
    });
    setDragId(null);
    setOver(null);
    arrastandoRef.current = false;
    try { await crm.moveDeal(id, stageId); } catch { load(); }
  };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo.trim() || !form.stageId) return;
    setSalvando(true);
    try {
      await crm.createDeal({
        titulo: form.titulo,
        stageId: form.stageId,
        contactId: form.contactId || undefined,
        valor: Number(form.valor) || 0,
        origem: form.origem || undefined,
      });
      setModal(false);
      setForm({ titulo: '', contactId: '', stageId: '', valor: '', origem: '' });
      await load();
    } finally {
      setSalvando(false);
    }
  };

  const abrirModal = () => {
    setForm((f) => ({ ...f, stageId: f.stageId || stages[0]?.id || '' }));
    setModal(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight text-fg">Pipeline de vendas</h1>
            <span
              title={conectado ? 'Ao vivo: o que a equipe mover aparece aqui' : 'Sem conexão ao vivo — recarregue para ver mudanças da equipe'}
              className={`h-2 w-2 shrink-0 rounded-full ${conectado ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />
          </div>
          <p className="text-sm text-muted">Arraste os cards ou clique para abrir — tudo salvo no banco.</p>
        </div>
        <Button onClick={abrirModal}><Icon name="plus" size={16} /> Novo negócio</Button>
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
                      onDragStart={() => { arrastandoRef.current = true; setDragId(d.id); }}
                      onDragEnd={() => { arrastandoRef.current = false; setDragId(null); setOver(null); }}
                      onClick={() => setAberto(d.id)}
                      className="card cursor-pointer p-3 transition hover:border-brand/40"
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

      {aberto && (
        <DealDrawer
          dealId={aberto}
          stages={stages}
          onClose={() => {
            setAberto(null);
            // limpa o ?deal= para o refresh não reabrir o drawer
            window.history.replaceState(null, '', '/pipeline');
          }}
          onChanged={load}
        />
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(20,15,28,0.5)' }} onClick={() => setModal(false)}>
          <Card className="w-full max-w-md animate-scale-in p-6">
            <form onClick={(e) => e.stopPropagation()} onSubmit={criar} className="space-y-4">
              <h2 className="text-lg font-bold text-fg">Novo negócio</h2>
              <Field label="Título"><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Consulta, projeto, contrato…" autoFocus /></Field>
              <Field label="Contato">
                <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
                  <option value="">— sem contato —</option>
                  {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Etapa">
                  <select className="input" value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })}>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </Field>
                <Field label="Valor (R$)"><Input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0" /></Field>
              </div>
              <Field label="Origem"><Input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} placeholder="Indicação, Meta Ads…" /></Field>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={salvando || !form.stageId}>{salvando ? 'Salvando…' : 'Criar negócio'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
