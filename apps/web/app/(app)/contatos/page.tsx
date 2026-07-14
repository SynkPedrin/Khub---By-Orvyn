'use client';

import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, brl, type Contato } from '@/lib/crm';

const TONE: Record<string, 'brand' | 'green' | 'amber' | 'neutral'> = {
  'Lead quente': 'amber', Lead: 'neutral', Paciente: 'brand', Cliente: 'green',
};

export default function ContatosPage() {
  const [rows, setRows] = useState<Contato[] | null>(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', tag: 'Lead', valorEstimado: '' });
  const [saving, setSaving] = useState(false);

  const load = (query?: string) => crm.contacts(query).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSaving(true);
    try {
      await crm.createContact({ ...form, valorEstimado: Number(form.valorEstimado) || 0 });
      setModal(false);
      setForm({ nome: '', email: '', telefone: '', tag: 'Lead', valorEstimado: '' });
      await load(q);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-fg">Contatos</h1>
          <p className="text-sm text-muted">{rows ? `${rows.length} contatos` : 'carregando…'} · salvos no banco</p>
        </div>
        <Button onClick={() => setModal(true)}><Icon name="plus" size={16} /> Novo contato</Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3.5 py-2.5 sm:max-w-sm">
        <Icon name="search" size={17} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, tag…" className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Contato</th>
                <th className="px-4 py-3 font-semibold">Telefone</th>
                <th className="px-4 py-3 font-semibold">Tag</th>
                <th className="px-4 py-3 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.nome} size={36} />
                      <div>
                        <p className="font-semibold text-fg">{c.nome}</p>
                        <p className="text-xs text-muted">{c.email ?? '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{c.telefone ?? '—'}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[c.tag] ?? 'neutral'}>{c.tag}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-fg">{brl(c.valor)}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted">Nenhum contato. Crie o primeiro.</td></tr>
              )}
              {!rows && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted">Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(20,15,28,0.5)' }} onClick={() => setModal(false)}>
          <Card className="w-full max-w-md animate-scale-in p-6" >
            <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="space-y-4">
              <h2 className="text-lg font-bold text-fg">Novo contato</h2>
              <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" autoFocus /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="E-mail"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@..." /></Field>
                <Field label="Telefone"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="+55…" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tag">
                  <select className="input" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
                    {['Lead', 'Lead quente', 'Paciente', 'Cliente'].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Valor estimado (R$)"><Input type="number" value={form.valorEstimado} onChange={(e) => setForm({ ...form, valorEstimado: e.target.value })} placeholder="0" /></Field>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Criar contato'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
