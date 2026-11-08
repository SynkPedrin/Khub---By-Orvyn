'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, brl, type Negocio360 } from '@/lib/crm';

interface Props {
  dealId: string;
  stages: { id: string; nome: string; cor: string }[];
  onClose: () => void;
  onChanged: () => void;
}

/** Negócio 360 (D1): ver, editar, tarefas, notas e excluir — sem sair do funil. */
export function DealDrawer({ dealId, stages, onClose, onChanged }: Props) {
  const [d, setD] = useState<Negocio360 | null>(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ titulo: '', valor: '', origem: '', stageId: '', status: 'aberto' });
  const [nota, setNota] = useState('');
  const [tarefa, setTarefa] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await crm.deal(dealId);
      setD(r);
      setForm({ titulo: r.titulo, valor: String(r.valor || ''), origem: r.origem ?? '', stageId: r.stage?.id ?? '', status: r.status });
    } catch {
      setErro('Negócio não encontrado.');
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await crm.updateDeal(dealId, {
        titulo: form.titulo,
        valor: Number(form.valor) || 0,
        origem: form.origem,
        stageId: form.stageId || undefined,
        status: form.status,
      });
      setEditando(false);
      await load();
      onChanged();
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => { await crm.deleteDeal(dealId); onChanged(); onClose(); };

  const addNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota.trim()) return;
    await crm.createNote({ corpo: nota, dealId });
    setNota('');
    await load();
  };

  const addTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tarefa.trim()) return;
    await crm.createTask({ titulo: tarefa, dealId });
    setTarefa('');
    await load();
  };

  const toggleTarefa = async (id: string) => { await crm.toggleTask(id); await load(); };

  return (
    <div className="lg-backdrop fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      <div
        className="lg-sheet lg-sheet-side w-full max-w-lg animate-fade-in overflow-y-auto p-5 scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Negócio</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label="Fechar"><Icon name="close" size={16} /></button>
        </div>

        {erro && <p className="py-10 text-center text-sm text-muted">{erro}</p>}
        {!d && !erro && <p className="py-10 text-center text-sm text-muted">Carregando…</p>}

        {d && (
          <div className="space-y-5">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold leading-tight text-fg">{d.titulo}</h2>
                <span className="shrink-0 text-lg font-bold text-brand">{brl(d.valor)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {d.stage && <Badge tone="brand">{d.stage.nome}</Badge>}
                <Badge tone={d.status === 'ganho' ? 'green' : d.status === 'perdido' ? 'amber' : 'neutral'}>{d.status}</Badge>
                {d.origem && <Badge tone="neutral">{d.origem}</Badge>}
              </div>
              {d.contato && (
                <Link href={`/contatos/${d.contato.id}`} className="mt-3 flex items-center gap-2 rounded-xl border border-line px-3 py-2 hover:bg-surface2">
                  <Icon name="contacts" size={15} className="text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{d.contato.nome}</span>
                    <span className="block truncate text-xs text-muted">{d.contato.email ?? d.contato.telefone ?? '-'}</span>
                  </span>
                  <Icon name="chevronRight" size={14} className="text-muted" />
                </Link>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditando((v) => !v)} className="flex-1"><Icon name="settings" size={15} /> {editando ? 'Cancelar' : 'Editar'}</Button>
              <Button variant="ghost" onClick={() => setConfirmando(true)} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">Excluir</Button>
            </div>

            {editando && (
              <form onSubmit={salvar} className="space-y-3 rounded-2xl border border-line p-4">
                <Field label="Título"><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor (R$)"><Input type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></Field>
                  <Field label="Origem"><Input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Etapa">
                    <select className="input" value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })}>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="aberto">Aberto</option><option value="ganho">Ganho</option><option value="perdido">Perdido</option>
                    </select>
                  </Field>
                </div>
                <Button type="submit" className="w-full" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button>
              </form>
            )}

            <div>
              <h3 className="mb-2 text-sm font-bold text-fg">Tarefas</h3>
              <form onSubmit={addTarefa} className="mb-2 flex gap-2">
                <input value={tarefa} onChange={(e) => setTarefa(e.target.value)} placeholder="Próximo passo…" className="input flex-1 text-sm" />
                <Button type="submit" disabled={!tarefa.trim()}>+</Button>
              </form>
              {d.tarefas.length === 0 && <p className="py-2 text-center text-xs text-muted">Nenhuma tarefa.</p>}
              {d.tarefas.map((t) => (
                <button key={t.id} onClick={() => toggleTarefa(t.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface2">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${t.status === 'concluida' ? 'border-brand bg-brand text-white' : 'border-line'}`}>
                    {t.status === 'concluida' && <Icon name="check" size={11} />}
                  </span>
                  <span className={`flex-1 text-sm ${t.status === 'concluida' ? 'text-muted line-through' : 'text-fg'}`}>{t.titulo}</span>
                </button>
              ))}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold text-fg">Notas</h3>
              <form onSubmit={addNota} className="mb-2 flex gap-2">
                <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Anotar algo…" className="input flex-1 text-sm" />
                <Button type="submit" disabled={!nota.trim()}>+</Button>
              </form>
              {d.notas.length === 0 && <p className="py-2 text-center text-xs text-muted">Nenhuma nota.</p>}
              <div className="space-y-2">
                {d.notas.map((n) => (
                  <div key={n.id} className="rounded-xl bg-surface2 px-3 py-2">
                    <p className="whitespace-pre-wrap text-sm text-fg">{n.corpo}</p>
                    <p className="mt-1 text-[11px] text-muted">{n.autor ?? 'alguém'} · {new Date(n.createdAt).toLocaleDateString('pt-BR')}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {confirmando && d && (
          <div className="lg-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4" onClick={() => setConfirmando(false)}>
            <Card className="lg-sheet w-full max-w-sm animate-scale-in p-6">
              <div onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-fg">Excluir “{d.titulo}”?</h2>
                <p className="mt-2 text-sm text-muted">O negócio, suas tarefas e notas somem. O contato continua no CRM. Não dá para desfazer.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
                  <Button onClick={excluir} className="bg-red-600 hover:bg-red-700">Excluir</Button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
