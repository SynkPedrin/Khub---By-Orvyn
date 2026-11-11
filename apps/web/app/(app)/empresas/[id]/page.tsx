'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, brl, type Empresa360 } from '@/lib/crm';
import { SkeletonDetail } from '@/components/kit';
import { CamposPersonalizados } from '@/components/crm/CamposPersonalizados';

const TAMANHOS = ['1-10', '11-50', '51-200', '200+'];

export default function Empresa360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Empresa360 | null>(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ nome: '', dominio: '', telefone: '', endereco: '', segmento: '', tamanho: '', site: '' });
  const [nota, setNota] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await crm.company(id);
      setC(d);
      setForm({
        nome: d.nome, dominio: d.dominio ?? '', telefone: d.telefone ?? '', endereco: d.endereco ?? '',
        segmento: d.segmento ?? '', tamanho: d.tamanho ?? '', site: d.site ?? '',
      });
    } catch {
      setErro('Empresa não encontrada.');
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      await crm.updateCompany(id, form);
      setEditando(false);
      await load();
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => { await crm.deleteCompany(id); router.replace('/empresas'); };

  const addNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota.trim()) return;
    await crm.createNote({ corpo: nota, companyId: id });
    setNota('');
    await load();
  };

  if (erro) return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><p className="text-muted">{erro}</p><Link href="/empresas" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">← Voltar</Link></div>;
  if (!c)
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <SkeletonDetail label="Carregando empresa" />
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <Link href="/empresas" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
        <Icon name="chevronRight" size={13} className="rotate-180" /> Empresas
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/12 text-lg font-bold text-brand">{c.nome.slice(0, 2).toUpperCase()}</span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-fg">{c.nome}</h1>
              <p className="mt-0.5 text-sm text-muted">{[c.segmento, c.tamanho && `${c.tamanho} pessoas`, c.dominio].filter(Boolean).join(' · ') || '-'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setEditando((v) => !v)}><Icon name="settings" size={15} /> {editando ? 'Cancelar' : 'Editar'}</Button>
            <Button variant="ghost" onClick={() => setConfirmando(true)} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">Excluir</Button>
          </div>
        </div>

        {editando ? (
          <form onSubmit={salvar} className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field>
            <Field label="Domínio"><Input value={form.dominio} onChange={(e) => setForm({ ...form, dominio: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
            <Field label="Site"><Input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} /></Field>
            <Field label="Segmento"><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} /></Field>
            <Field label="Tamanho">
              <select className="input" value={form.tamanho} onChange={(e) => setForm({ ...form, tamanho: e.target.value })}>
                <option value="">-</option>{TAMANHOS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2"><Field label="Endereço"><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></Field></div>
            <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button></div>
          </form>
        ) : (
          <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-4">
            <Info rotulo="Contatos" valor={String(c.contatos.length)} />
            <Info rotulo="Negócios" valor={String(c.negocios.length)} />
            <Info rotulo="Em aberto" valor={brl(c.valorAberto)} />
            <Info rotulo="Telefone" valor={c.telefone ?? '-'} />
          </div>
        )}
      </Card>

      <Card className="p-5">
        <CamposPersonalizados entidade="company" valores={c.camposCustom} onSalvar={async (camposCustom) => { await crm.updateCompany(id, { camposCustom }); await load(); }} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Contatos ({c.contatos.length})</h2>
            {c.contatos.length === 0 && <p className="py-4 text-center text-sm text-muted">Nenhum contato ligado a esta empresa.</p>}
            <div className="space-y-2">
              {c.contatos.map((p) => (
                <Link key={p.id} href={`/contatos/${p.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-surface2">
                  <Avatar name={p.nome} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{p.nome}</span>
                    <span className="block truncate text-xs text-muted">{p.email ?? p.telefone ?? '-'}</span>
                  </span>
                  <Badge tone="neutral">{p.tag}</Badge>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Negócios do portfólio</h2>
            {c.negocios.length === 0 && <p className="py-4 text-center text-sm text-muted">Nenhum negócio.</p>}
            <div className="space-y-2">
              {c.negocios.map((d) => (
                <Link key={d.id} href={`/pipeline?deal=${d.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-surface2">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: d.cor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{d.titulo}</span>
                    <span className="text-xs text-muted">{d.stage}{d.contato ? ` · ${d.contato}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-fg">{brl(d.valor)}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 font-bold text-fg">Notas</h2>
            <form onSubmit={addNota} className="mb-3 space-y-2">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota sobre a conta…" className="input w-full" />
              <Button type="submit" className="w-full" disabled={!nota.trim()}>Adicionar</Button>
            </form>
            {c.notas.length === 0 && <p className="py-2 text-center text-sm text-muted">Nenhuma nota.</p>}
            <div className="space-y-2">
              {c.notas.map((n) => (
                <div key={n.id} className="rounded-xl bg-surface2 px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-sm text-fg">{n.corpo}</p>
                  <p className="mt-1 text-[11px] text-muted">{n.autor ?? 'alguém'} · {new Date(n.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
              ))}
            </div>
          </Card>

          {c.tarefas.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 font-bold text-fg">Tarefas abertas</h2>
              <div className="space-y-1.5">
                {c.tarefas.map((t) => (
                  <div key={t.id} className="rounded-lg px-2 py-1.5 text-sm text-fg">{t.titulo}</div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {confirmando && (
        <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setConfirmando(false)}>
          <Card className="lg-sheet w-full max-w-sm animate-scale-in p-6">
            <div onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-fg">Excluir {c.nome}?</h2>
              <p className="mt-2 text-sm text-muted">
                Os {c.contatos.length} contato(s) <strong>continuam</strong> no CRM, só perdem o vínculo com a empresa. As notas e tarefas da empresa somem.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
                <Button onClick={excluir} className="bg-red-600 hover:bg-red-700">Excluir empresa</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
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
