'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Modal, SkeletonRows, Tabs, useToast } from '@/components/kit';
import { moeda } from '@/lib/format';
import { carteiraApi, type Carteira, type ClienteCarteira, type StatusCarteira } from '@/lib/comercial';

type Filtro = 'todos' | StatusCarteira | 'recompra';
const ROTULO: Record<StatusCarteira, { t: string; tom: 'green' | 'amber' | 'neutral' }> = {
  ativo: { t: 'Ativo', tom: 'green' },
  em_risco: { t: 'Em risco', tom: 'amber' },
  inativo: { t: 'Inativo', tom: 'neutral' },
};
const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

export default function CarteiraPage() {
  const toast = useToast();
  const [dados, setDados] = useState<Carteira | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');
  const [limites, setLimites] = useState({ ativo: 90, risco: 180 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [marcando, setMarcando] = useState(false);

  const carregar = () => carteiraApi.ver(limites.ativo, limites.risco).then((d) => { setDados(d); setSel(new Set()); }).catch((e) => toast.error('Não foi possível carregar a carteira', { description: msg(e) }));
  useEffect(() => { carregar(); }, [limites]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    const termo = q.trim().toLowerCase();
    return (dados?.clientes ?? []).filter((c) =>
      (filtro === 'todos' || (filtro === 'recompra' ? c.recompraAtrasada : c.status === filtro)) &&
      (!termo || c.nome.toLowerCase().includes(termo) || (c.telefone ?? '').includes(termo) || (c.email ?? '').toLowerCase().includes(termo)));
  }, [dados, filtro, q]);

  const r = dados?.resumo;
  const tudoSelecionado = lista.length > 0 && lista.every((c) => sel.has(c.contactId));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display">Carteira de clientes</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Quem já comprou de você. Cada negócio ganho conta como uma compra. Clientes em risco e com recompra atrasada são a sua lista de reativação: marque com uma tag e ligue uma automação de &quot;Tag adicionada&quot;.</p>
        </div>
        <LimitesForm valor={limites} onChange={setLimites} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { l: 'Clientes', v: r ? String(r.clientes) : '-', d: r ? `${r.recorrentes} recorrente(s)` : '' },
          { l: 'Ativos', v: r ? String(r.ativos) : '-', d: `compraram nos últimos ${limites.ativo} dias` },
          { l: 'Em risco', v: r ? String(r.emRisco) : '-', d: `${limites.ativo + 1} a ${limites.risco} dias sem comprar`, alerta: !!r?.emRisco },
          { l: 'Recompra atrasada', v: r ? String(r.recompraAtrasada) : '-', d: 'passaram do ciclo de compra', alerta: !!r?.recompraAtrasada },
          { l: 'LTV médio', v: r ? moeda(r.ltvMedio) : '-', d: r ? `ticket médio ${moeda(r.ticketMedio)}` : '' },
        ].map((k) => (
          <Card key={k.l} className={cx('p-4', k.alerta && 'ring-1 ring-amber-400/50')}>
            <p className="text-xs font-medium text-muted">{k.l}</p>
            <p className={cx('mt-2 text-2xl font-semibold tabular-nums', k.alerta ? 'text-amber-600 dark:text-amber-400' : 'text-fg')}>{k.v}</p>
            <p className="mt-0.5 text-[11px] text-muted">{k.d}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Filtro> label="Filtrar carteira" variant="segmented" idBase="carteira" value={filtro} onChange={setFiltro} items={[
          { value: 'todos', label: 'Todos', count: r?.clientes },
          { value: 'ativo', label: 'Ativos', count: r?.ativos },
          { value: 'em_risco', label: 'Em risco', count: r?.emRisco },
          { value: 'inativo', label: 'Inativos', count: r?.inativos },
          { value: 'recompra', label: 'Recompra atrasada', count: r?.recompraAtrasada },
        ]} />
        <div className="flex items-center gap-2">
          <div className="w-60"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" /></div>
          <Button variant="secondary" disabled={!sel.size} onClick={() => setMarcando(true)}><Icon name="tag" size={15} /> Marcar {sel.size || ''}</Button>
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" className="accent-brand" checked={tudoSelecionado} onChange={() => setSel(tudoSelecionado ? new Set() : new Set(lista.map((c) => c.contactId)))} aria-label="Selecionar todos" /></th>
              <th className="px-3 py-3">Cliente</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Compras</th>
              <th className="px-3 py-3 text-right">Total</th>
              <th className="px-3 py-3">Última compra</th>
              <th className="px-3 py-3">Próxima prevista</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!dados && <tr><td colSpan={7} className="p-0"><SkeletonRows rows={5} label="Carregando carteira" /></td></tr>}
            {dados && lista.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center">
                <p className="font-semibold text-fg">{dados.clientes.length ? 'Ninguém neste filtro.' : 'Sua carteira ainda está vazia.'}</p>
                {!dados.clientes.length && <p className="mt-1 text-sm text-muted">Ela se forma com os negócios ganhos. Marque um negócio como ganho no <Link href="/pipeline" className="font-semibold text-brand">funil</Link> ou registre o aceite de uma <Link href="/propostas" className="font-semibold text-brand">proposta</Link>.</p>}
              </td></tr>
            )}
            {lista.map((c) => <Linha key={c.contactId} c={c} marcado={sel.has(c.contactId)} onToggle={() => alternar(c.contactId)} />)}
          </tbody>
        </table>
      </Card>

      {marcando && <MarcarModal ids={[...sel]} onClose={() => setMarcando(false)} onFeito={() => { setMarcando(false); carregar(); }} />}
    </div>
  );
}

function Linha({ c, marcado, onToggle }: { c: ClienteCarteira; marcado: boolean; onToggle: () => void }) {
  return (
    <tr className={cx(marcado && 'bg-brand/5')}>
      <td className="px-4 py-3"><input type="checkbox" className="accent-brand" checked={marcado} onChange={onToggle} aria-label={`Selecionar ${c.nome}`} /></td>
      <td className="px-3 py-3">
        <Link href={`/contatos/${c.contactId}`} className="font-semibold text-fg hover:text-brand">{c.nome}</Link>
        <p className="text-[11px] text-muted">{c.telefone ?? c.email ?? ''}{c.optOut ? ' · não quer receber mensagens' : ''}</p>
      </td>
      <td className="px-3 py-3"><div className="flex flex-wrap gap-1"><Badge tone={ROTULO[c.status].tom}>{ROTULO[c.status].t}</Badge>{c.recompraAtrasada && <Badge tone="amber">Recompra atrasada</Badge>}</div></td>
      <td className="px-3 py-3 text-right tabular-nums">{c.compras}</td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">{moeda(c.totalComprado)}</td>
      <td className="px-3 py-3"><span className="tabular-nums">{dataBR(c.ultimaCompra)}</span><p className="text-[11px] text-muted">há {c.diasSemComprar} dia(s)</p></td>
      <td className="px-3 py-3">{c.proximaCompraPrevista ? <><span className="tabular-nums">{dataBR(c.proximaCompraPrevista)}</span><p className="text-[11px] text-muted">ciclo de {c.cicloDias} dias</p></> : <span className="text-[11px] text-muted">precisa de 2 compras</span>}</td>
    </tr>
  );
}

function LimitesForm({ valor, onChange }: { valor: { ativo: number; risco: number }; onChange: (v: { ativo: number; risco: number }) => void }) {
  const [a, setA] = useState(String(valor.ativo));
  const [r, setR] = useState(String(valor.risco));
  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    const ativo = Math.max(7, Number(a) || 90);
    onChange({ ativo, risco: Math.max(ativo + 1, Number(r) || 180) });
  };
  return (
    <form onSubmit={aplicar} className="flex items-end gap-2 text-xs text-muted">
      <label>Ativo até<Input className="mt-1 w-20" inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} aria-label="Dias para considerar ativo" /></label>
      <label>Risco até<Input className="mt-1 w-20" inputMode="numeric" value={r} onChange={(e) => setR(e.target.value)} aria-label="Dias para considerar em risco" /></label>
      <span className="pb-2">dias</span>
      <Button type="submit" variant="ghost" size="sm">Aplicar</Button>
    </form>
  );
}

function MarcarModal({ ids, onClose, onFeito }: { ids: string[]; onClose: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [tag, setTag] = useState('reativacao');
  const [busy, setBusy] = useState(false);
  const marcar = async () => {
    setBusy(true);
    try {
      const r = await carteiraApi.marcar(ids, tag.trim());
      toast.success(`${r.marcados} cliente(s) marcado(s) com "${tag.trim()}"`, r.jaTinham ? { description: `${r.jaTinham} já tinha(m) a tag.` } : undefined);
      onFeito();
    } catch (e) { toast.error('Não foi possível marcar', { description: msg(e) }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Marcar ${ids.length} cliente(s)`}
      description="A tag nova dispara as automações com o gatilho &quot;Tag adicionada&quot; desta tag. Revise o fluxo antes: as mensagens saem de verdade."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={marcar} loading={busy} disabled={!tag.trim()}>Aplicar tag</Button></>}>
      <label className="block text-sm font-medium text-fg">Tag<Input className="mt-1" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} autoFocus /></label>
      <p className="mt-3 text-xs text-muted">Sem automação ligada a esta tag, ela só organiza a lista. <Link href="/automacoes" className="font-semibold text-brand">Ver automações</Link></p>
    </Modal>
  );
}
