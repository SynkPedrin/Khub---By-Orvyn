'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { brl } from '@/lib/crm';

/**
 * Gerenciador de anúncios em modo SIMULAÇÃO. Enquanto a Meta não está conectada,
 * o operador cria e gerencia campanhas → conjuntos → anúncios com métricas
 * derivadas do orçamento (determinísticas). Estado local (localStorage). Ao
 * plugar a Meta, o painel real assume — isto é a versão treino/demonstração.
 */
interface Anuncio { id: string; nome: string }
interface Conjunto { id: string; nome: string; publico: string; anuncios: Anuncio[] }
interface Campanha { id: string; nome: string; objetivo: string; orcamentoDia: number; status: 'active' | 'paused'; conjuntos: Conjunto[] }

const OBJETIVOS = ['Geração de leads', 'Conversões', 'Tráfego', 'Alcance', 'Engajamento'];
const KEY = 'khub:ads-sim';
const uid = () => Math.random().toString(36).slice(2, 9);

function metrica(orcamentoDia: number, ativo: boolean) {
  const gasto = ativo ? Math.round(orcamentoDia * 30) : 0; // 30 dias
  const cliques = Math.round(gasto * 2.4);
  const leads = Math.round(cliques * 0.08);
  const cpl = leads ? gasto / leads : 0;
  const roas = gasto ? (leads * 480) / gasto : 0; // ticket médio R$480
  return { gasto, cliques, leads, cpl, roas };
}

export function AdsSimulador() {
  const [camps, setCamps] = useState<Campanha[]>([]);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ nome: '', objetivo: OBJETIVOS[0], orcamentoDia: 50 });
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s) setCamps(JSON.parse(s)); } catch { /* ignore */ }
  }, []);
  const salvar = (next: Campanha[]) => { setCamps(next); localStorage.setItem(KEY, JSON.stringify(next)); };

  const criar = () => {
    if (!form.nome.trim()) return;
    salvar([{ id: uid(), nome: form.nome.trim(), objetivo: form.objetivo, orcamentoDia: form.orcamentoDia, status: 'active', conjuntos: [] }, ...camps]);
    setForm({ nome: '', objetivo: OBJETIVOS[0], orcamentoDia: 50 });
    setNovo(false);
  };
  const patch = (id: string, fn: (c: Campanha) => Campanha) => salvar(camps.map((c) => (c.id === id ? fn(c) : c)));
  const remover = (id: string) => salvar(camps.filter((c) => c.id !== id));
  const addConjunto = (id: string) => patch(id, (c) => ({ ...c, conjuntos: [...c.conjuntos, { id: uid(), nome: `Conjunto ${c.conjuntos.length + 1}`, publico: 'Público amplo', anuncios: [] }] }));
  const addAnuncio = (cid: string, sid: string) => patch(cid, (c) => ({ ...c, conjuntos: c.conjuntos.map((s) => (s.id === sid ? { ...s, anuncios: [...s.anuncios, { id: uid(), nome: `Anúncio ${s.anuncios.length + 1}` }] } : s)) }));

  const total = camps.reduce((acc, c) => { const m = metrica(c.orcamentoDia, c.status === 'active'); acc.gasto += m.gasto; acc.leads += m.leads; return acc; }, { gasto: 0, leads: 0 });

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="marketing" size={17} /></span>
          <div>
            <h2 className="font-bold text-fg">Gerenciador de campanhas</h2>
            <p className="text-[11px] text-muted">Modo simulação, conecte a Meta para operar contas reais.</p>
          </div>
        </div>
        <button onClick={() => setNovo((v) => !v)} className="btn btn-primary text-sm"><Icon name="plus" size={15} /> Nova campanha</button>
      </div>

      {(camps.length > 0) && (
        <div className="mt-4 flex gap-3">
          <div className="flex-1 rounded-xl border border-line bg-surface2 p-3"><p className="text-[11px] text-muted">Campanhas ativas</p><p className="text-lg font-bold text-fg">{camps.filter((c) => c.status === 'active').length}</p></div>
          <div className="flex-1 rounded-xl border border-line bg-surface2 p-3"><p className="text-[11px] text-muted">Gasto (30d)</p><p className="text-lg font-bold text-fg">{brl(total.gasto)}</p></div>
          <div className="flex-1 rounded-xl border border-line bg-surface2 p-3"><p className="text-[11px] text-muted">Leads estimados</p><p className="text-lg font-bold text-fg">{total.leads}</p></div>
        </div>
      )}

      {novo && (
        <div className="mt-4 rounded-2xl border border-line bg-surface2 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1"><label className="mb-1 block text-xs font-semibold text-muted">Nome</label><input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Captação - Consulta" autoFocus /></div>
            <div><label className="mb-1 block text-xs font-semibold text-muted">Objetivo</label><select className="input" value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })}>{OBJETIVOS.map((o) => <option key={o}>{o}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-semibold text-muted">Orçamento/dia (R$)</label><input type="number" min={5} className="input" value={form.orcamentoDia} onChange={(e) => setForm({ ...form, orcamentoDia: Math.max(5, Number(e.target.value) || 5) })} /></div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setNovo(false)} className="btn btn-ghost text-sm">Cancelar</button>
            <button onClick={criar} className="btn btn-primary text-sm">Criar campanha</button>
          </div>
        </div>
      )}

      {camps.length === 0 && !novo && (
        <div className="mt-4 rounded-2xl border border-dashed border-line py-8 text-center">
          <p className="text-sm font-semibold text-fg">Nenhuma campanha ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">Crie uma campanha para simular investimento, conjuntos de anúncios e resultados.</p>
        </div>
      )}

      <div className="mt-4 space-y-2.5">
        {camps.map((c) => {
          const m = metrica(c.orcamentoDia, c.status === 'active');
          const anuncios = c.conjuntos.reduce((n, s) => n + s.anuncios.length, 0);
          const open = aberta === c.id;
          return (
            <div key={c.id} className="rounded-2xl border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-3 p-3.5">
                <button onClick={() => setAberta(open ? null : c.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Icon name="chevronRight" size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-fg">{c.nome}</span>
                    <span className="block truncate text-[11px] text-muted">{c.objetivo} · {brl(c.orcamentoDia)}/dia · {c.conjuntos.length} conjunto(s) · {anuncios} anúncio(s)</span>
                  </span>
                </button>
                <div className="flex items-center gap-4 text-right text-xs">
                  <span><span className="block text-2xs text-muted">Gasto</span><b className="text-fg">{brl(m.gasto)}</b></span>
                  <span><span className="block text-2xs text-muted">Leads</span><b className="text-fg">{m.leads}</b></span>
                  <span><span className="block text-2xs text-muted">CPL</span><b className="text-fg">{brl(m.cpl)}</b></span>
                  <span><span className="block text-2xs text-muted">ROAS</span><b className="text-brand">{m.roas.toFixed(1)}x</b></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => patch(c.id, (x) => ({ ...x, status: x.status === 'active' ? 'paused' : 'active' }))} className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${c.status === 'active' ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400' : 'border-line text-muted'}`}>
                    {c.status === 'active' ? 'Ativa' : 'Pausada'}
                  </button>
                  <button onClick={() => remover(c.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label="Excluir"><Icon name="close" size={14} /></button>
                </div>
              </div>

              {open && (
                <div className="border-t border-line bg-surface2/50 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted">Conjuntos de anúncios</p>
                    <button onClick={() => addConjunto(c.id)} className="text-xs font-semibold text-brand hover:underline">+ Conjunto</button>
                  </div>
                  {c.conjuntos.length === 0 && <p className="text-xs text-muted">Sem conjuntos. Adicione o primeiro.</p>}
                  <div className="space-y-2">
                    {c.conjuntos.map((s) => (
                      <div key={s.id} className="rounded-xl border border-line bg-surface p-3">
                        <div className="flex items-center justify-between">
                          <div><p className="text-sm font-semibold text-fg">{s.nome}</p><p className="text-[11px] text-muted">{s.publico} · {s.anuncios.length} anúncio(s)</p></div>
                          <button onClick={() => addAnuncio(c.id, s.id)} className="text-xs font-semibold text-brand hover:underline">+ Anúncio</button>
                        </div>
                        {s.anuncios.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {s.anuncios.map((a) => <span key={a.id} className="rounded-full bg-surface3 px-2.5 py-0.5 text-[11px] text-fg">{a.nome}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
