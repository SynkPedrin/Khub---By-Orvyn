'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, brl, type Contato, type Empresa } from '@/lib/crm';
import { ApiError } from '@/lib/api-error';

const TONE: Record<string, 'brand' | 'green' | 'amber' | 'neutral'> = {
  'Lead quente': 'amber', Lead: 'neutral', Paciente: 'brand', Cliente: 'green',
};
const PAGINA = 25;

export default function ContatosPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Contato[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', tag: 'Lead', valorEstimado: '', companyId: '' });
  const [saving, setSaving] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);

  // primeira página (ou nova busca): substitui a lista
  const load = useCallback(async (query?: string) => {
    try {
      const p = await crm.contacts({ q: query, limit: PAGINA });
      setRows(p.items);
      setCursor(p.nextCursor);
    } catch {
      setRows([]);
      setCursor(null);
    }
  }, []);

  // páginas seguintes: acumulam pelo cursor (keyset — não repete nem pula linha)
  const carregarMais = async () => {
    if (!cursor || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const p = await crm.contacts({ q: q || undefined, cursor, limit: PAGINA });
      setRows((r) => [...(r ?? []), ...p.items]);
      setCursor(p.nextCursor);
    } catch (e) {
      // cursor expirado (o contato-âncora foi excluído por alguém): recomeça a
      // lista em vez de deixar o botão morto
      if (e instanceof ApiError && e.status === 400) await load(q || undefined);
    } finally {
      setCarregandoMais(false);
    }
  };

  useEffect(() => { crm.companies().then(setEmpresas).catch(() => setEmpresas([])); }, []);
  useEffect(() => { const t = setTimeout(() => load(q || undefined), 250); return () => clearTimeout(t); }, [q, load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSaving(true);
    try {
      await crm.createContact({
        nome: form.nome,
        email: form.email || undefined,
        telefone: form.telefone || undefined,
        tag: form.tag,
        valorEstimado: Number(form.valorEstimado) || 0,
        companyId: form.companyId || undefined,
      });
      setModal(false);
      setForm({ nome: '', email: '', telefone: '', tag: 'Lead', valorEstimado: '', companyId: '' });
      await load(q || undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Contatos</h1>
          <p className="text-sm text-muted">
            {rows ? `${rows.length}${cursor ? '+' : ''} contatos` : 'carregando…'} · salvos no banco
          </p>
        </div>
        <Button onClick={() => setModal(true)}><Icon name="plus" size={16} /> Novo contato</Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3.5 py-2.5 sm:max-w-sm">
        <Icon name="search" size={17} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, telefone, empresa…" className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Contato</th>
                <th className="px-4 py-3 font-semibold">Empresa</th>
                <th className="px-4 py-3 font-semibold">Telefone</th>
                <th className="px-4 py-3 font-semibold">Tag</th>
                <th className="px-4 py-3 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/contatos/${c.id}`)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface2"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.nome} size={36} />
                      <div>
                        <p className="font-semibold text-fg">{c.nome}</p>
                        <p className="text-xs text-muted">{c.email ?? '-'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.empresa ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{c.telefone ?? '-'}</td>
                  <td className="px-4 py-3"><Badge tone={TONE[c.tag] ?? 'neutral'}>{c.tag}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-fg">{brl(c.valor)}</td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">{q ? `Nenhum contato para “${q}”.` : 'Nenhum contato. Crie o primeiro.'}</td></tr>
              )}
              {!rows && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
        {cursor && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={carregarMais} disabled={carregandoMais}>
              {carregandoMais ? 'Carregando…' : 'Carregar mais'}
            </Button>
          </div>
        )}
      </Card>

      {modal && (
        <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <Card className="lg-sheet w-full max-w-md animate-scale-in p-6">
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
