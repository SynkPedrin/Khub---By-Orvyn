'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Field, Input } from '@/components/ui';
import { Confirm, Drawer, SkeletonLines, Skeleton, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { crm, brl, type Atendente, type Negocio360 } from '@/lib/crm';
import { CamposPersonalizados } from '@/components/crm/CamposPersonalizados';
import { MotivoPerdaModal } from '@/components/crm/MotivoPerdaModal';
import type { DadosPerda } from '@/lib/pipeline';

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
  const [form, setForm] = useState({ titulo: '', valor: '', origem: '', stageId: '', status: 'aberto', ownerId: '' });
  // Marcar como perdido pede o motivo (Q2.1) antes de salvar.
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [donos, setDonos] = useState<Atendente[]>([]);
  const [nota, setNota] = useState('');
  const [tarefa, setTarefa] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await crm.deal(dealId);
      setD(r);
      setForm({ titulo: r.titulo, valor: String(r.valor || ''), origem: r.origem ?? '', stageId: r.stage?.id ?? '', status: r.status, ownerId: r.ownerId ?? '' });
    } catch {
      setErro('Negócio não encontrado.');
    }
  }, [dealId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (editando && !donos.length) crm.atendentes().then(setDonos).catch(() => undefined); }, [editando, donos.length]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.status === 'perdido' && d?.status !== 'perdido') { setPedindoMotivo(true); return; }
    await gravar();
  };

  /** PATCH do formulário; `perda` vem do modal quando o negócio está sendo marcado como perdido. */
  const gravar = async (perda?: DadosPerda) => {
    setSalvando(true);
    try {
      await crm.updateDeal(dealId, {
        titulo: form.titulo,
        valor: Number(form.valor) || 0,
        origem: form.origem,
        stageId: form.stageId || undefined,
        status: form.status,
        ...(form.ownerId !== (d?.ownerId ?? '') ? { ownerId: form.ownerId || null } : {}),
        ...(perda ?? {}),
      });
      setPedindoMotivo(false);
      setEditando(false);
      await load();
      onChanged();
      toast.success('Negócio atualizado.');
    } catch (err) {
      // com o modal aberto, o erro aparece nele (ex.: motivo desativado entre abrir e salvar)
      if (perda) throw err;
      toast.error('Não foi possível salvar o negócio.', { description: 'Confira os campos e tente de novo.' });
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    setExcluindo(true);
    try {
      await crm.deleteDeal(dealId);
      toast.success('Negócio excluído.');
      onChanged();
      onClose();
    } catch {
      toast.error('Não foi possível excluir o negócio.');
      setExcluindo(false);
      setConfirmando(false);
    }
  };

  const addNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota.trim()) return;
    try {
      await crm.createNote({ corpo: nota, dealId });
      setNota('');
      await load();
    } catch {
      toast.error('Não foi possível salvar a nota.');
    }
  };

  const addTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tarefa.trim()) return;
    try {
      await crm.createTask({ titulo: tarefa, dealId });
      setTarefa('');
      await load();
    } catch {
      toast.error('Não foi possível criar a tarefa.');
    }
  };

  const toggleTarefa = async (id: string) => {
    try {
      await crm.toggleTask(id);
      await load();
    } catch {
      toast.error('Não foi possível atualizar a tarefa.');
    }
  };

  return (
    // Kit Drawer (Q1.8): role="dialog", foco preso, Esc fecha, foco volta ao card, rolagem travada.
    <Drawer open onClose={onClose} title="Negócio" ariaLabel={d ? `Negócio ${d.titulo}` : 'Negócio'}>
        {erro && <p className="py-10 text-center text-sm text-muted">{erro}</p>}
        {!d && !erro && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-6 w-3/5 rounded-sm" />
              <Skeleton className="h-6 w-24 rounded-sm" />
            </div>
            <SkeletonLines lines={4} label="Carregando negócio" />
          </div>
        )}

        {d && (
          <div className="space-y-5">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold leading-tight text-fg">{d.titulo}</h2>
                <span className="shrink-0 text-lg font-semibold tabular text-fg">{brl(d.valor)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {d.stage && <Badge tone="brand">{d.stage.nome}</Badge>}
                <Badge tone={d.status === 'ganho' ? 'green' : d.status === 'perdido' ? 'amber' : 'neutral'}>{d.status}</Badge>
                {d.origem && <Badge tone="neutral">{d.origem}</Badge>}
              </div>
              {d.status === 'perdido' && (d.motivoPerda || d.motivoPerdaObs) && (
                <p className="mt-2 text-sm text-muted">
                  <span className="font-medium text-fg">Motivo da perda:</span> {d.motivoPerda?.nome ?? 'não informado'}
                  {d.motivoPerdaObs && <span className="mt-0.5 block whitespace-pre-wrap">{d.motivoPerdaObs}</span>}
                </p>
              )}
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
              <Button variant="ghost" onClick={() => setConfirmando(true)} className="btn-danger"><Icon name="trash" size={15} /> Excluir</Button>
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
                <Field label="Dono">
                  <select className="input" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                    <option value="">Sem dono</option>
                    {form.ownerId && !donos.some((m) => m.identityId === form.ownerId) && <option value={form.ownerId}>Responsável atual</option>}
                    {donos.map((m) => <option key={m.identityId} value={m.identityId}>{m.nome}</option>)}
                  </select>
                </Field>
                <Button type="submit" className="w-full" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button>
              </form>
            )}

            <CamposPersonalizados
              compacto
              entidade="deal"
              valores={d.camposCustom}
              className="rounded-2xl border border-line p-4"
              onSalvar={async (camposCustom) => { await crm.updateDeal(dealId, { camposCustom }); await load(); }}
            />

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

        <MotivoPerdaModal
          open={pedindoMotivo}
          alvo={d ? `"${d.titulo}"` : 'o negócio'}
          onClose={() => setPedindoMotivo(false)}
          onConfirm={gravar}
        />

        <Confirm
          open={confirmando && !!d}
          onClose={() => setConfirmando(false)}
          onConfirm={excluir}
          loading={excluindo}
          title={`Excluir “${d?.titulo ?? ''}”?`}
          description="O negócio, suas tarefas e notas somem. O contato continua no CRM. Não dá para desfazer."
          confirmLabel="Excluir negócio"
        />
    </Drawer>
  );
}
