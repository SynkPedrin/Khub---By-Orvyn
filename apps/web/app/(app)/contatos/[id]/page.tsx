'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, brl, type Contato360, type Empresa } from '@/lib/crm';
import { Confirm, SkeletonDetail, useToast } from '@/components/kit';
import { CamposPersonalizados } from '@/components/crm/CamposPersonalizados';
import { PerfilTagsNaoPerturbe } from '@/components/crm/leads/PerfilTagsNaoPerturbe';
import { AutomacoesDoContato } from '@/components/automations/AutomacoesDoContato';
import { PedirAvaliacao } from '@/components/avaliacoes/PedirAvaliacao';

const TONE: Record<string, 'brand' | 'green' | 'amber' | 'neutral'> = {
  'Lead quente': 'amber', Lead: 'neutral', Paciente: 'brand', Cliente: 'green',
};
const TOM_TIMELINE: Record<string, string> = { success: 'bg-success', warn: 'bg-warning', neutral: 'bg-brand' };

function quando(iso: string | null): string {
  if (!iso) return '-';
  const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function Contato360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Contato360 | null>(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', tag: 'Lead', valorEstimado: '', companyId: '' });
  const [nota, setNota] = useState('');
  const [tarefa, setTarefa] = useState({ titulo: '', dueAt: '', prioridade: 'media' });
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const d = await crm.contact(id);
      setC(d);
      setForm({
        nome: d.nome, email: d.email ?? '', telefone: d.telefone ?? '', tag: d.tag,
        valorEstimado: String(d.valor || ''), companyId: d.company?.id ?? '',
      });
    } catch {
      setErro('Contato não encontrado.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { crm.companies().then(setEmpresas).catch(() => setEmpresas([])); }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await crm.updateContact(id, {
        nome: form.nome,
        email: form.email,
        telefone: form.telefone,
        tag: form.tag,
        valorEstimado: Number(form.valorEstimado) || 0,
        companyId: form.companyId || undefined,
      });
      setEditando(false);
      await load();
      toast.success('Contato atualizado.');
    } catch {
      toast.error('Não foi possível salvar o contato.', { description: 'Confira os campos e tente de novo.' });
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    setExcluindo(true);
    try {
      await crm.deleteContact(id);
      toast.success('Contato excluído.');
      router.replace('/contatos');
    } catch {
      toast.error('Não foi possível excluir o contato.');
      setExcluindo(false);
      setConfirmando(false);
    }
  };

  const addNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota.trim()) return;
    try {
      await crm.createNote({ corpo: nota, contactId: id });
      setNota('');
      await load();
    } catch {
      toast.error('Não foi possível salvar a nota.');
    }
  };

  const addTarefa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tarefa.titulo.trim()) return;
    try {
      await crm.createTask({
        titulo: tarefa.titulo,
        prioridade: tarefa.prioridade,
        dueAt: tarefa.dueAt ? new Date(tarefa.dueAt).toISOString() : undefined,
        contactId: id,
      });
      setTarefa({ titulo: '', dueAt: '', prioridade: 'media' });
      await load();
      toast.success('Tarefa criada.');
    } catch {
      toast.error('Não foi possível criar a tarefa.');
    }
  };

  const toggleTarefa = async (tid: string) => {
    try {
      await crm.toggleTask(tid);
      await load();
    } catch {
      toast.error('Não foi possível atualizar a tarefa.');
    }
  };

  if (erro) return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><p className="text-muted">{erro}</p><Link href="/contatos" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">← Voltar para contatos</Link></div>;
  if (!c)
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <SkeletonDetail label="Carregando contato" />
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/contatos" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
        <Icon name="chevronRight" size={13} className="rotate-180" /> Contatos
      </Link>

      {/* Cabeçalho */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={c.nome} size={56} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-fg">{c.nome}</h1>
                <Badge tone={TONE[c.tag] ?? 'neutral'}>{c.tag}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                Cliente desde {new Date(c.createdAt).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PedirAvaliacao contato={c} />
            <Button variant="ghost" onClick={() => setEditando((v) => !v)}><Icon name="settings" size={15} /> {editando ? 'Cancelar' : 'Editar'}</Button>
            <Button variant="ghost" onClick={() => setConfirmando(true)} className="btn-danger"><Icon name="trash" size={15} /> Excluir</Button>
          </div>
        </div>

        {editando ? (
          <form onSubmit={salvar} className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field>
            <Field label="E-mail"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
            <Field label="Tag">
              <select className="input" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
                {['Lead', 'Lead quente', 'Paciente', 'Cliente'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Valor estimado (R$)"><Input type="number" value={form.valorEstimado} onChange={(e) => setForm({ ...form, valorEstimado: e.target.value })} /></Field>
            <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button></div>
          </form>
        ) : (
          <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-4">
            <Info rotulo="E-mail" valor={c.email ?? '-'} />
            <Info rotulo="Telefone" valor={c.telefone ?? '-'} />
            <Info rotulo="Valor estimado" valor={brl(c.valor)} />
            <Info rotulo="Último contato" valor={quando(c.ultimoContatoAt)} />
          </div>
        )}
      </Card>

      <Card className="p-5">
        <PerfilTagsNaoPerturbe id={id} tags={c.tags ?? []} optedOutAt={c.optedOutAt ?? null} onMudou={load} />
      </Card>

      <Card className="p-5">
        <CamposPersonalizados entidade="contact" valores={c.camposCustom} onSalvar={async (camposCustom) => { await crm.updateContact(id, { camposCustom }); await load(); }} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Negócios */}
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Negócios ({c.negocios.length})</h2>
            {c.negocios.length === 0 && <p className="py-4 text-center text-sm text-muted">Nenhum negócio ainda.</p>}
            <div className="space-y-2">
              {c.negocios.map((d) => (
                <Link key={d.id} href={`/pipeline?deal=${d.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-surface2">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: d.cor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{d.titulo}</span>
                    <span className="text-xs text-muted">{d.stage}{d.origem ? ` · ${d.origem}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular text-fg">{brl(d.valor)}</span>
                </Link>
              ))}
            </div>
          </Card>

          {/* Notas */}
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Notas</h2>
            <form onSubmit={addNota} className="mb-3 flex gap-2">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escreva uma nota sobre este contato…" className="input flex-1" />
              <Button type="submit" disabled={!nota.trim()}>Adicionar</Button>
            </form>
            {c.notas.length === 0 && <p className="py-3 text-center text-sm text-muted">Nenhuma nota.</p>}
            <div className="space-y-2">
              {c.notas.map((n) => (
                <div key={n.id} className="rounded-xl bg-surface2 px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-sm text-fg">{n.corpo}</p>
                  <p className="mt-1 text-[11px] text-muted">{n.autor ?? 'alguém'} · {quando(n.createdAt)}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Timeline */}
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Histórico</h2>
            {c.timeline.length === 0 && <p className="py-3 text-center text-sm text-muted">Sem atividade registrada.</p>}
            <div className="space-y-3">
              {c.timeline.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TOM_TIMELINE[a.tone] ?? 'bg-brand'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg"><span className="font-semibold">{a.actor}</span> {a.acao}</p>
                    <p className="text-[11px] text-muted">{quando(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {/* Tarefas */}
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Tarefas</h2>
            <form onSubmit={addTarefa} className="mb-3 space-y-2">
              <Input value={tarefa.titulo} onChange={(e) => setTarefa({ ...tarefa, titulo: e.target.value })} placeholder="Nova tarefa…" />
              <div className="flex gap-2">
                <input type="date" value={tarefa.dueAt} onChange={(e) => setTarefa({ ...tarefa, dueAt: e.target.value })} className="input flex-1 text-xs" />
                <select className="input w-24 text-xs" value={tarefa.prioridade} onChange={(e) => setTarefa({ ...tarefa, prioridade: e.target.value })}>
                  <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={!tarefa.titulo.trim()}>Adicionar tarefa</Button>
            </form>
            {c.tarefas.length === 0 && <p className="py-2 text-center text-sm text-muted">Nada pendente.</p>}
            <div className="space-y-1.5">
              {c.tarefas.map((t) => (
                <button key={t.id} onClick={() => toggleTarefa(t.id)} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface2">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${t.status === 'concluida' ? 'border-brand bg-brand text-white' : 'border-line'}`}>
                    {t.status === 'concluida' && <Icon name="check" size={11} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${t.status === 'concluida' ? 'text-muted line-through' : 'text-fg'}`}>{t.titulo}</span>
                    {t.dueAt && <span className="text-[11px] text-muted">{new Date(t.dueAt).toLocaleDateString('pt-BR')}</span>}
                  </span>
                  {t.prioridade === 'alta' && t.status === 'aberta' && <span className="pill pill-danger h-5 shrink-0 px-2 text-2xs">Alta</span>}
                </button>
              ))}
            </div>
          </Card>

          {/* Automações (Q3.3): fluxos em que o contato está, com "remover deste fluxo" */}
          <AutomacoesDoContato contactId={id} />

          {/* Conversas */}
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Conversas</h2>
            {c.conversas.length === 0 && <p className="py-2 text-center text-sm text-muted">Nenhuma conversa.</p>}
            <div className="space-y-2">
              {c.conversas.map((cv) => (
                <Link key={cv.id} href={`/inbox?c=${cv.id}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 hover:bg-surface2">
                  <Icon name="inbox" size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-fg">{cv.canal}</span>
                    <span className="block truncate text-[11px] text-muted">{cv.ultimaPrevia ?? '-'}</span>
                  </span>
                  {cv.naoLidas > 0 && <span className="shrink-0 rounded-full bg-brand px-1.5 text-2xs font-bold text-white">{cv.naoLidas}</span>}
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Confirm
        open={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={excluir}
        loading={excluindo}
        title={`Excluir ${c.nome}?`}
        description="As tarefas e notas deste contato somem junto. Os negócios e conversas ficam, sem o vínculo. Não dá para desfazer."
        confirmLabel="Excluir contato"
      />
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{rotulo}</p>
      <p className="mt-0.5 text-sm font-semibold text-fg">{valor}</p>
    </div>
  );
}
