'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, Input } from '@/components/ui';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { Icon } from '@/components/icons';
import { crm, type Empresa } from '@/lib/crm';

const TAMANHOS = ['1-10', '11-50', '51-200', '200+'];

export default function EmpresasPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Empresa[] | null>(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const dialogRef = useDialogFocus(modal, () => setModal(false));
  const [form, setForm] = useState({ nome: '', dominio: '', telefone: '', segmento: '', tamanho: '', site: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroCarga, setErroCarga] = useState('');

  const load = useCallback((query?: string) => crm.companies(query).then((data) => { setRows(data); setErroCarga(''); }).catch(() => setErroCarga('Não foi possível carregar as empresas. Tente novamente.')), []);
  useEffect(() => { const t = setTimeout(() => load(q || undefined), 250); return () => clearTimeout(t); }, [q, load]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      await crm.createCompany({
        nome: form.nome,
        dominio: form.dominio || undefined,
        telefone: form.telefone || undefined,
        segmento: form.segmento || undefined,
        tamanho: form.tamanho || undefined,
        site: form.site || undefined,
      });
      setModal(false);
      setForm({ nome: '', dominio: '', telefone: '', segmento: '', tamanho: '', site: '' });
      await load(q || undefined);
    } catch (e) {
      setErro((e as Error).message.includes('409') || /existe/.test((e as Error).message) ? 'Já existe uma empresa com esse nome.' : 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Empresas</h1>
          <p className="text-sm text-muted">{rows ? `${rows.length} empresas` : 'carregando…'} · contas do seu portfólio</p>
        </div>
        <Button onClick={() => setModal(true)}><Icon name="plus" size={16} /> Nova empresa</Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3.5 py-2.5 sm:max-w-sm">
        <Icon name="search" size={17} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, domínio, segmento…" className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
      </div>

      {erroCarga && <p role="alert" className="text-sm text-danger">{erroCarga}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows?.map((c) => (
          <Card key={c.id} onClick={() => router.push(`/empresas/${c.id}`)} className="cursor-pointer p-4 transition hover:border-brand/40">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-sm font-bold text-brand">
                {c.nome.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-fg">{c.nome}</p>
                <p className="truncate text-xs text-muted">{c.dominio ?? c.site ?? c.segmento ?? '-'}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-xs text-muted">
              <span className="flex items-center gap-1"><Icon name="contacts" size={13} /> {c.contatos} contato{c.contatos === 1 ? '' : 's'}</span>
              {c.tamanho && <span>· {c.tamanho} pessoas</span>}
            </div>
          </Card>
        ))}
      </div>
      {rows && rows.length === 0 && (
        <Card className="border-dashed p-10 text-center">
          <p className="text-sm text-muted">{q ? `Nenhuma empresa para “${q}”.` : 'Nenhuma empresa cadastrada. Agrupe seus contatos por conta.'}</p>
        </Card>
      )}
      {!rows && <p className="py-10 text-center text-sm text-muted">Carregando…</p>}

      {modal && (
        <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <Card ref={(el) => { dialogRef.current = el; }} role="dialog" aria-modal="true" aria-label="Nova empresa" tabIndex={-1} className="lg-sheet w-full max-w-md animate-scale-in p-6">
            <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="space-y-4">
              <h2 className="text-lg font-bold text-fg">Nova empresa</h2>
              <Field label="Nome"><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome da empresa" autoFocus /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Domínio"><Input value={form.dominio} onChange={(e) => setForm({ ...form, dominio: e.target.value })} placeholder="empresa.com.br" /></Field>
                <Field label="Telefone"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="+55…" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Segmento"><Input value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} placeholder="Saúde, Jurídico…" /></Field>
                <Field label="Tamanho">
                  <select className="input" value={form.tamanho} onChange={(e) => setForm({ ...form, tamanho: e.target.value })}>
                    <option value="">-</option>
                    {TAMANHOS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{erro}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Criar empresa'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
