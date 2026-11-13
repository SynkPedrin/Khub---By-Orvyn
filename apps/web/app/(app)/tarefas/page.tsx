'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Field, Input } from '@/components/ui';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Icon } from '@/components/icons';
import { crm, type Contato, type Tarefa } from '@/lib/crm';
import { SkeletonRows } from '@/components/kit';

type Filtro = 'abertas' | 'hoje' | 'atrasadas' | 'concluidas' | 'todas';
const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'abertas', label: 'Abertas' },
  { key: 'hoje', label: 'Para hoje' },
  { key: 'atrasadas', label: 'Atrasadas' },
  { key: 'concluidas', label: 'Concluídas' },
  { key: 'todas', label: 'Todas' },
];
const COR_PRIORIDADE: Record<string, string> = { alta: 'text-red-500', media: 'text-amber-500', baixa: 'text-muted' };

export default function TarefasPage() {
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [rows, setRows] = useState<Tarefa[] | null>(null);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [modal, setModal] = useState(false);
  const dialogRef = useDialogFocus(modal, () => setModal(false));
  const [form, setForm] = useState({ titulo: '', descricao: '', dueAt: '', prioridade: 'media', contactId: '' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const load = useCallback(() => crm.tasks(filtro).then(setRows).catch(() => setErro('Não foi possível carregar as tarefas. Tente atualizar a página.')), [filtro]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { crm.contacts({ limit: 100 }).then((p) => setContatos(p.items)).catch(() => setContatos([])); }, []);

  const toggle = async (id: string) => {
    // otimista: o check responde na hora; o servidor confirma logo atrás
    setRows((r) => r?.map((t) => (t.id === id ? { ...t, status: t.status === 'aberta' ? 'concluida' : 'aberta' } : t)) ?? r);
    try { await crm.toggleTask(id); } catch { setErro('Não foi possível atualizar a tarefa.'); } finally { await load(); }
  };

  const excluir = async (id: string) => { try { await crm.deleteTask(id); await load(); } catch { setErro('Não foi possível excluir a tarefa.'); } };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      await crm.createTask({
        titulo: form.titulo,
        descricao: form.descricao || undefined,
        prioridade: form.prioridade,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
        contactId: form.contactId || undefined,
      });
      setModal(false);
      setForm({ titulo: '', descricao: '', dueAt: '', prioridade: 'media', contactId: '' });
      await load();
    } catch {
      setErro('Não foi possível salvar a tarefa. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Tarefas</h1>
          <p className="text-sm text-muted">{rows ? `${rows.length} tarefa${rows.length === 1 ? '' : 's'}` : 'carregando…'}</p>
        </div>
        <Button onClick={() => setModal(true)}><Icon name="plus" size={16} /> Nova tarefa</Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filtro === f.key ? 'bg-brand text-white' : 'bg-surface2 text-muted hover:text-fg'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
      <Card className="p-2">
        {!rows && <SkeletonRows rows={5} label="Carregando tarefas" />}
        {rows && rows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            {filtro === 'atrasadas' ? 'Nada atrasado. ' : filtro === 'concluidas' ? 'Nada concluído ainda.' : 'Nada pendente aqui.'}
          </p>
        )}
        {rows?.map((t) => (
          <div key={t.id} className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface2">
            <button aria-label={`${t.status === 'concluida' ? 'Reabrir' : 'Concluir'} tarefa ${t.titulo}`} onClick={() => toggle(t.id)} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${t.status === 'concluida' ? 'border-brand bg-brand text-white' : 'border-line hover:border-brand'}`}>
              {t.status === 'concluida' && <Icon name="check" size={12} />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${t.status === 'concluida' ? 'text-muted line-through' : 'text-fg'}`}>{t.titulo}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                {t.dueAt && (
                  <span className={t.atrasada ? 'font-bold text-red-500' : ''}>
                    {t.atrasada ? '⚠ ' : ''}{new Date(t.dueAt).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {t.prioridade !== 'media' && <span className={`font-bold uppercase ${COR_PRIORIDADE[t.prioridade]}`}>{t.prioridade}</span>}
                {t.contato && <Link href={`/contatos/${t.contato.id}`} className="hover:text-brand">· {t.contato.nome}</Link>}
                {t.negocio && <span>· {t.negocio.titulo}</span>}
              </div>
            </div>
            <button onClick={() => excluir(t.id)} className="shrink-0 rounded-lg p-1.5 text-muted opacity-100 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100" aria-label="Excluir tarefa">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </Card>

      {modal && (
        <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <Card ref={(el) => { dialogRef.current = el; }} role="dialog" aria-modal="true" aria-label="Nova tarefa" tabIndex={-1} className="lg-sheet w-full max-w-md animate-scale-in p-6">
            <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="space-y-4">
              <h2 className="text-lg font-bold text-fg">Nova tarefa</h2>
              <Field label="O que precisa ser feito"><Input required value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ligar para o cliente…" autoFocus /></Field>
              <Field label="Detalhes (opcional)"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Contexto…" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prazo"><Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
                <Field label="Prioridade">
                  <select className="input" value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}>
                    <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
                  </select>
                </Field>
              </div>
              <Field label="Contato (opcional)">
                <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
                  <option value="">- nenhum -</option>
                  {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Field>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Criar tarefa'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
