'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Modal, Select, SkeletonCards, useToast } from '@/components/kit';
import { funisApi, type EtapaConfig, type FunilConfig } from '@/lib/comercial';

const CORES = ['#9B4DE0', '#7B2FBE', '#5B1E9E', '#2563EB', '#0E9F6E', '#B7791F', '#EA580C', '#DB2777'];
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

/** Para onde vão os negócios ao apagar etapa/funil com negócios. */
type Remocao = { tipo: 'etapa'; funil: FunilConfig; etapa: EtapaConfig } | { tipo: 'funil'; funil: FunilConfig };

export default function FunisPage() {
  const toast = useToast();
  const [funis, setFunis] = useState<FunilConfig[] | null>(null);
  const [novoFunil, setNovoFunil] = useState(false);
  const [remocao, setRemocao] = useState<Remocao | null>(null);

  const carregar = () => funisApi.listar().then(setFunis).catch((e) => { toast.error('Não foi possível carregar os funis', { description: msg(e) }); setFunis([]); });
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const acao = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); await carregar(); return true; } catch (e) { toast.error('Não foi possível salvar', { description: msg(e) }); return false; }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/pipeline" className="text-xs font-semibold text-muted hover:text-brand">Funil de vendas</Link>
          <h1 className="t-display">Funis e etapas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Monte o caminho do seu cliente. Renomeie, mude a cor e a ordem das etapas. Para apagar uma etapa com negócios, você escolhe para onde eles vão: nenhum negócio se perde.</p>
        </div>
        <Button onClick={() => setNovoFunil(true)}><Icon name="plus" size={16} /> Novo funil</Button>
      </div>

      {!funis && <SkeletonCards count={2} className="sm:grid-cols-1 xl:grid-cols-1" cardClassName="h-48" label="Carregando funis" />}
      {funis?.map((f) => (
        <FunilCard key={f.id} funil={f} podeApagar={funis.length > 1} acao={acao} onApagarEtapa={(etapa) => (etapa.total > 0 ? setRemocao({ tipo: 'etapa', funil: f, etapa }) : acao(() => funisApi.apagarEtapa(etapa.id), `Etapa "${etapa.nome}" apagada`))} onApagarFunil={() => setRemocao({ tipo: 'funil', funil: f })} />
      ))}

      <NovoFunilModal open={novoFunil} onClose={() => setNovoFunil(false)} onCriado={() => { setNovoFunil(false); carregar(); }} />
      {remocao && <RemocaoModal r={remocao} funis={funis ?? []} onClose={() => setRemocao(null)} onFeito={() => { setRemocao(null); carregar(); }} />}
    </div>
  );
}

function FunilCard({ funil, podeApagar, acao, onApagarEtapa, onApagarFunil }: {
  funil: FunilConfig;
  podeApagar: boolean;
  acao: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
  onApagarEtapa: (e: EtapaConfig) => void;
  onApagarFunil: () => void;
}) {
  const [nome, setNome] = useState(funil.nome);
  const [novaEtapa, setNovaEtapa] = useState('');
  useEffect(() => setNome(funil.nome), [funil.nome]);

  const mover = (i: number, d: -1 | 1) => {
    const ids = funil.etapas.map((e) => e.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void acao(() => funisApi.reordenar(funil.id, ids));
  };
  const salvarNome = () => { if (nome.trim() && nome.trim() !== funil.nome) void acao(() => funisApi.renomear(funil.id, nome.trim()), 'Funil renomeado'); else setNome(funil.nome); };
  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaEtapa.trim()) return;
    if (await acao(() => funisApi.criarEtapa(funil.id, { nome: novaEtapa.trim() }))) setNovaEtapa('');
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <Icon name="funnel" size={18} className="text-brand" />
        <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salvarNome} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={80} aria-label="Nome do funil"
          className="min-w-[180px] flex-1 rounded-lg bg-transparent px-2 py-1 text-base font-bold text-fg outline-none hover:bg-surface2 focus:bg-surface2" />
        <span className="text-xs text-muted">{funil.etapas.length} etapa(s) · {funil.negocios} negócio(s)</span>
        {podeApagar && <Button variant="ghost" size="sm" onClick={onApagarFunil}><Icon name="trash" size={14} /> Apagar funil</Button>}
      </div>
      <ol className="divide-y divide-line">
        {funil.etapas.map((e, i) => (
          <EtapaLinha key={e.id} etapa={e} primeira={i === 0} ultima={i === funil.etapas.length - 1} unica={funil.etapas.length === 1}
            onSubir={() => mover(i, -1)} onDescer={() => mover(i, 1)}
            onSalvar={(d) => acao(() => funisApi.atualizarEtapa(e.id, d))}
            onApagar={() => onApagarEtapa(e)} />
        ))}
      </ol>
      <form onSubmit={adicionar} className="flex items-center gap-2 border-t border-line bg-surface2/40 px-5 py-3">
        <Input value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} placeholder="Nova etapa (ex.: Proposta enviada)" maxLength={60} aria-label="Nome da nova etapa" />
        <Button type="submit" variant="secondary" disabled={!novaEtapa.trim()}><Icon name="plus" size={15} /> Adicionar</Button>
      </form>
    </Card>
  );
}

function EtapaLinha({ etapa, primeira, ultima, unica, onSubir, onDescer, onSalvar, onApagar }: {
  etapa: EtapaConfig; primeira: boolean; ultima: boolean; unica: boolean;
  onSubir: () => void; onDescer: () => void; onSalvar: (d: { nome?: string; cor?: string }) => Promise<boolean>; onApagar: () => void;
}) {
  const [nome, setNome] = useState(etapa.nome);
  const [paleta, setPaleta] = useState(false);
  useEffect(() => setNome(etapa.nome), [etapa.nome]);
  const salvar = () => { if (nome.trim() && nome.trim() !== etapa.nome) void onSalvar({ nome: nome.trim() }); else setNome(etapa.nome); };

  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <div className="flex flex-col">
        <button onClick={onSubir} disabled={primeira} className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-25" aria-label={`Subir ${etapa.nome}`}><Icon name="arrowUp" size={13} /></button>
        <button onClick={onDescer} disabled={ultima} className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-25" aria-label={`Descer ${etapa.nome}`}><Icon name="arrowDown" size={13} /></button>
      </div>
      <div className="relative">
        <button onClick={() => setPaleta((v) => !v)} className="h-5 w-5 rounded-full ring-2 ring-white/60" style={{ background: etapa.cor }} aria-label="Mudar cor" aria-expanded={paleta} />
        {paleta && (
          <div className="absolute left-0 top-7 z-20 flex gap-1.5 rounded-xl border border-line bg-surface p-2 shadow-lg">
            {CORES.map((c) => (
              <button key={c} onClick={() => { setPaleta(false); void onSalvar({ cor: c }); }} className={cx('h-6 w-6 rounded-full', c === etapa.cor && 'ring-2 ring-brand ring-offset-2')} style={{ background: c }} aria-label={`Cor ${c}`} />
            ))}
          </div>
        )}
      </div>
      <input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={salvar} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={60} aria-label="Nome da etapa"
        className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-sm font-semibold text-fg outline-none hover:bg-surface2 focus:bg-surface2" />
      <span className="hidden text-xs tabular-nums text-muted sm:inline">{etapa.abertos} aberto(s){etapa.total > etapa.abertos ? ` · ${etapa.total - etapa.abertos} fechado(s)` : ''}</span>
      <button onClick={onApagar} disabled={unica} title={unica ? 'O funil precisa de pelo menos uma etapa' : 'Apagar etapa'} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500 disabled:opacity-30" aria-label={`Apagar ${etapa.nome}`}>
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}

function NovoFunilModal({ open, onClose, onCriado }: { open: boolean; onClose: () => void; onCriado: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [etapas, setEtapas] = useState('Novo\nEm contato\nProposta\nFechado');
  const [busy, setBusy] = useState(false);
  const criar = async () => {
    const lista = etapas.split('\n').map((e) => e.trim()).filter(Boolean);
    if (!nome.trim() || !lista.length) return;
    setBusy(true);
    try {
      await funisApi.criar({ nome: nome.trim(), etapas: lista });
      toast.success(`Funil "${nome.trim()}" criado`);
      setNome('');
      onCriado();
    } catch (e) { toast.error('Não foi possível criar o funil', { description: msg(e) }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Novo funil" description="Uma etapa por linha. Você pode ajustar tudo depois."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={criar} loading={busy} disabled={!nome.trim()}>Criar funil</Button></>}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-fg">Nome<Input className="mt-1" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Pós-venda, Reativação" maxLength={80} autoFocus /></label>
        <label className="block text-sm font-medium text-fg">Etapas
          <textarea className="input mt-1 min-h-[140px] w-full" value={etapas} onChange={(e) => setEtapas(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

function RemocaoModal({ r, funis, onClose, onFeito }: { r: Remocao; funis: FunilConfig[]; onClose: () => void; onFeito: () => void }) {
  const toast = useToast();
  const destinos = r.tipo === 'etapa'
    ? r.funil.etapas.filter((e) => e.id !== r.etapa.id).map((e) => ({ value: e.id, label: e.nome }))
    : funis.filter((f) => f.id !== r.funil.id).flatMap((f) => f.etapas.map((e) => ({ value: e.id, label: `${f.nome} › ${e.nome}` })));
  const [destino, setDestino] = useState(destinos[0]?.value ?? '');
  const [busy, setBusy] = useState(false);
  const total = r.tipo === 'etapa' ? r.etapa.total : r.funil.negocios;
  const nome = r.tipo === 'etapa' ? r.etapa.nome : r.funil.nome;

  const confirmar = async () => {
    setBusy(true);
    try {
      const res = r.tipo === 'etapa' ? await funisApi.apagarEtapa(r.etapa.id, total ? destino : undefined) : await funisApi.apagar(r.funil.id, total ? destino : undefined);
      toast.success(`${r.tipo === 'etapa' ? 'Etapa' : 'Funil'} "${nome}" apagado`, res.movidos ? { description: `${res.movidos} negócio(s) movido(s).` } : undefined);
      onFeito();
    } catch (e) { toast.error('Não foi possível apagar', { description: msg(e) }); } finally { setBusy(false); }
  };

  if (!total) {
    return <Confirm open onClose={onClose} onConfirm={confirmar} loading={busy} title={`Apagar o funil "${nome}"?`} description="O funil não tem negócios. As etapas dele também serão apagadas." confirmLabel="Apagar funil" />;
  }
  return (
    <Modal open onClose={onClose} title={`Apagar ${r.tipo === 'etapa' ? 'a etapa' : 'o funil'} "${nome}"`}
      description={`Há ${total} negócio(s) aqui. Escolha para onde eles vão antes de apagar.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" onClick={confirmar} loading={busy} disabled={!destino}>Mover e apagar</Button></>}>
      {destinos.length ? (
        <label className="block text-sm font-medium text-fg">Mover os negócios para
          <Select className="mt-1" value={destino} onChange={setDestino} options={destinos} />
        </label>
      ) : (
        <p className="text-sm text-muted">Não há outra etapa para receber os negócios. Crie uma etapa (ou outro funil) primeiro.</p>
      )}
    </Modal>
  );
}
