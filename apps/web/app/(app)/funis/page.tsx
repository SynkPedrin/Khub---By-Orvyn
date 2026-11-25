'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Modal, Select, SkeletonCards, useToast } from '@/components/kit';
import { funisApi, type EtapaConfig, type FunilConfig } from '@/lib/comercial';

const CORES = ['#9B4DE0', '#7B2FBE', '#5B1E9E', '#2563EB', '#0E9F6E', '#B7791F', '#EA580C', '#DB2777'];
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

/** Para onde vão os negócios ao apagar etapa/funil com negócios. */
type Remocao = { tipo: 'etapa'; funil: FunilConfig; etapa: EtapaConfig } | { tipo: 'funil'; funil: FunilConfig };

/** Rascunho de nomes ainda não salvos: `f:<id>` (funil) e `e:<id>` (etapa). */
type Rascunhos = Record<string, string>;

export default function FunisPage() {
  const toast = useToast();
  const router = useRouter();
  const [funis, setFunis] = useState<FunilConfig[] | null>(null);
  const [novoFunil, setNovoFunil] = useState(false);
  const [remocao, setRemocao] = useState<Remocao | null>(null);
  const [rascunhos, setRascunhos] = useState<Rascunhos>({});
  const [salvando, setSalvando] = useState(false);
  const [sairSemSalvar, setSairSemSalvar] = useState(false);

  const carregar = () => funisApi.listar().then(setFunis).catch((e) => { toast.error('Não foi possível carregar os funis', { description: msg(e) }); setFunis([]); });
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nome original de cada campo editável, para saber o que mudou de verdade.
  const originais = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of funis ?? []) {
      m[`f:${f.id}`] = f.nome;
      for (const e of f.etapas) m[`e:${e.id}`] = e.nome;
    }
    return m;
  }, [funis]);
  const pendentes = Object.entries(rascunhos).filter(([k, v]) => k in originais && v.trim() !== originais[k]);
  const invalidos = pendentes.filter(([, v]) => !v.trim());
  const sujo = pendentes.length > 0;

  // Fechar a aba / recarregar com alteração pendente: o navegador pergunta antes.
  useEffect(() => {
    if (!sujo) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [sujo]);

  const editar = (chave: string, valor: string) => setRascunhos((r) => ({ ...r, [chave]: valor }));
  const descartar = () => setRascunhos({});

  const salvar = async () => {
    if (!sujo || salvando) return;
    if (invalidos.length) { toast.error('Há nome em branco', { description: 'Dê um nome a todo funil e etapa antes de salvar.' }); return; }
    setSalvando(true);
    let feitos = 0;
    try {
      for (const [chave, valor] of pendentes) {
        const id = chave.slice(2);
        if (chave.startsWith('f:')) await funisApi.renomear(id, valor.trim());
        else await funisApi.atualizarEtapa(id, { nome: valor.trim() });
        feitos++;
        setRascunhos((r) => { const { [chave]: _, ...resto } = r; return resto; });
      }
      toast.success(feitos === 1 ? 'Alteração salva' : `${feitos} alterações salvas`);
    } catch (e) {
      toast.error('Não foi possível salvar', { description: `${feitos ? `${feitos} salva(s). ` : ''}${msg(e)}` });
    } finally {
      setSalvando(false);
      await carregar();
    }
  };

  const voltar = () => (sujo ? setSairSemSalvar(true) : router.push('/pipeline'));

  const acao = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); await carregar(); return true; } catch (e) { toast.error('Não foi possível salvar', { description: msg(e) }); return false; }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-6 pb-28 lg:px-8 lg:py-8 lg:pb-28">
      <Button variant="secondary" size="sm" icon="arrowLeft" onClick={voltar}>Voltar ao funil de vendas</Button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display">Funis e etapas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Clique no nome de um funil ou etapa para editar e depois em <strong className="font-semibold text-fg">Salvar alterações</strong>. Cor, ordem, etapa nova e exclusão são salvas na hora. Para apagar uma etapa com negócios, você escolhe para onde eles vão: nenhum negócio se perde.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon="plus" onClick={() => setNovoFunil(true)}>Novo funil</Button>
          <Button variant="primary" icon="check" onClick={() => void salvar()} loading={salvando} disabled={!sujo}>
            {sujo ? 'Salvar alterações' : 'Tudo salvo'}
          </Button>
        </div>
      </div>

      {!funis && <SkeletonCards count={2} className="sm:grid-cols-1 xl:grid-cols-1" cardClassName="h-48" label="Carregando funis" />}
      {funis?.map((f) => (
        <FunilCard key={f.id} funil={f} podeApagar={funis.length > 1} acao={acao} rascunhos={rascunhos} onEditar={editar} onEnter={() => void salvar()}
          onApagarEtapa={(etapa) => (etapa.total > 0 ? setRemocao({ tipo: 'etapa', funil: f, etapa }) : acao(() => funisApi.apagarEtapa(etapa.id), `Etapa "${etapa.nome}" apagada`))}
          onApagarFunil={() => setRemocao({ tipo: 'funil', funil: f })} />
      ))}

      {sujo && (
        <div role="region" aria-label="Alterações não salvas" className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex w-full max-w-[720px] flex-wrap items-center gap-3 rounded-2xl border-2 border-line-strong bg-surface px-4 py-3 shadow-xl">
            <Icon name="alert" size={18} className="shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
              {pendentes.length === 1 ? '1 alteração não salva' : `${pendentes.length} alterações não salvas`}
              {invalidos.length > 0 && <span className="block text-xs font-medium text-danger">Há nome em branco.</span>}
            </p>
            <Button variant="ghost" icon="undo" onClick={descartar} disabled={salvando}>Descartar</Button>
            <Button variant="primary" icon="check" onClick={() => void salvar()} loading={salvando}>Salvar alterações</Button>
          </div>
        </div>
      )}

      <NovoFunilModal open={novoFunil} onClose={() => setNovoFunil(false)} onCriado={() => { setNovoFunil(false); carregar(); }} />
      {remocao && <RemocaoModal r={remocao} funis={funis ?? []} onClose={() => setRemocao(null)} onFeito={() => { setRemocao(null); carregar(); }} />}
      <Confirm open={sairSemSalvar} onClose={() => setSairSemSalvar(false)} onConfirm={() => { setSairSemSalvar(false); router.push('/pipeline'); }}
        title="Sair sem salvar?" description={`Você tem ${pendentes.length} alteração(ões) de nome que ainda não foram salvas. Elas serão perdidas.`}
        confirmLabel="Sair sem salvar" cancelLabel="Continuar editando" />
    </div>
  );
}

/** Nome editável: parece texto, mas mostra borda ao passar o mouse e marca quando foi alterado. */
function CampoNome({ valor, alterado, invalido, onChange, onEnter, ariaLabel, maxLength, className }: {
  valor: string; alterado: boolean; invalido: boolean; onChange: (v: string) => void; onEnter: () => void; ariaLabel: string; maxLength: number; className?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <input value={valor} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        maxLength={maxLength} aria-label={ariaLabel} aria-invalid={invalido || undefined} title="Clique para editar"
        className={cx('w-full rounded-lg border bg-transparent px-2 py-1 text-fg outline-none transition-colors hover:border-line hover:bg-surface2 focus:border-brand focus:bg-surface2',
          invalido ? 'border-danger' : alterado ? 'border-warning' : 'border-transparent', className)} />
      {alterado && !invalido && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">não salvo</span>}
    </div>
  );
}

function FunilCard({ funil, podeApagar, acao, rascunhos, onEditar, onEnter, onApagarEtapa, onApagarFunil }: {
  funil: FunilConfig;
  podeApagar: boolean;
  acao: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
  rascunhos: Rascunhos;
  onEditar: (chave: string, valor: string) => void;
  onEnter: () => void;
  onApagarEtapa: (e: EtapaConfig) => void;
  onApagarFunil: () => void;
}) {
  const [novaEtapa, setNovaEtapa] = useState('');
  const campoNova = useRef<HTMLInputElement>(null);
  const chave = `f:${funil.id}`;
  const nome = rascunhos[chave] ?? funil.nome;

  const mover = (i: number, d: -1 | 1) => {
    const ids = funil.etapas.map((e) => e.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void acao(() => funisApi.reordenar(funil.id, ids), 'Ordem das etapas salva');
  };
  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaEtapa.trim()) { campoNova.current?.focus(); return; }
    if (await acao(() => funisApi.criarEtapa(funil.id, { nome: novaEtapa.trim() }), `Etapa "${novaEtapa.trim()}" adicionada`)) setNovaEtapa('');
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <Icon name="funnel" size={18} className="text-brand" />
        <CampoNome valor={nome} alterado={nome.trim() !== funil.nome} invalido={!nome.trim()} onChange={(v) => onEditar(chave, v)} onEnter={onEnter}
          ariaLabel="Nome do funil" maxLength={80} className="min-w-[180px] text-base font-bold" />
        <span className="text-xs font-medium text-muted">{funil.etapas.length} etapa(s) · {funil.negocios} negócio(s)</span>
        {podeApagar && <Button variant="danger" size="sm" icon="trash" onClick={onApagarFunil}>Apagar funil</Button>}
      </div>
      <ol className="divide-y divide-line">
        {funil.etapas.map((e, i) => (
          <EtapaLinha key={e.id} etapa={e} nome={rascunhos[`e:${e.id}`] ?? e.nome} primeira={i === 0} ultima={i === funil.etapas.length - 1} unica={funil.etapas.length === 1}
            onNome={(v) => onEditar(`e:${e.id}`, v)} onEnter={onEnter}
            onSubir={() => mover(i, -1)} onDescer={() => mover(i, 1)}
            onCor={(cor) => acao(() => funisApi.atualizarEtapa(e.id, { cor }), 'Cor da etapa salva')}
            onApagar={() => onApagarEtapa(e)} />
        ))}
      </ol>
      <form onSubmit={adicionar} className="flex items-center gap-2 border-t border-line bg-surface2/40 px-5 py-3">
        <input ref={campoNova} className="input" value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} placeholder="Nova etapa (ex.: Proposta enviada)" maxLength={60} aria-label="Nome da nova etapa" />
        <Button type="submit" variant="soft" icon="plus">Adicionar etapa</Button>
      </form>
    </Card>
  );
}

function EtapaLinha({ etapa, nome, primeira, ultima, unica, onNome, onEnter, onSubir, onDescer, onCor, onApagar }: {
  etapa: EtapaConfig; nome: string; primeira: boolean; ultima: boolean; unica: boolean;
  onNome: (v: string) => void; onEnter: () => void;
  onSubir: () => void; onDescer: () => void; onCor: (cor: string) => Promise<boolean>; onApagar: () => void;
}) {
  const [paleta, setPaleta] = useState(false);
  const seta = 'flex h-6 w-6 items-center justify-center rounded-md border border-line text-fg hover:border-line-strong hover:bg-surface2 disabled:border-transparent disabled:text-muted disabled:opacity-40';

  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <div className="flex flex-col gap-1">
        <button type="button" onClick={onSubir} disabled={primeira} className={seta} title="Subir etapa" aria-label={`Subir ${etapa.nome}`}><Icon name="arrowUp" size={14} /></button>
        <button type="button" onClick={onDescer} disabled={ultima} className={seta} title="Descer etapa" aria-label={`Descer ${etapa.nome}`}><Icon name="arrowDown" size={14} /></button>
      </div>
      <div className="relative">
        <button type="button" onClick={() => setPaleta((v) => !v)} className="h-6 w-6 rounded-full border-2 border-line shadow-sm hover:border-line-strong" style={{ background: etapa.cor }} title="Mudar cor" aria-label="Mudar cor" aria-expanded={paleta} />
        {paleta && (
          <div className="absolute left-0 top-8 z-20 flex gap-1.5 rounded-xl border border-line bg-surface p-2 shadow-lg">
            {CORES.map((c) => (
              <button type="button" key={c} onClick={() => { setPaleta(false); void onCor(c); }} className={cx('h-6 w-6 rounded-full', c === etapa.cor && 'ring-2 ring-brand ring-offset-2')} style={{ background: c }} aria-label={`Cor ${c}`} />
            ))}
          </div>
        )}
      </div>
      <CampoNome valor={nome} alterado={nome.trim() !== etapa.nome} invalido={!nome.trim()} onChange={onNome} onEnter={onEnter}
        ariaLabel={`Nome da etapa ${etapa.nome}`} maxLength={60} className="text-sm font-semibold" />
      <span className="hidden text-xs font-medium tabular-nums text-muted sm:inline">{etapa.abertos} aberto(s){etapa.total > etapa.abertos ? ` · ${etapa.total - etapa.abertos} fechado(s)` : ''}</span>
      <button type="button" onClick={onApagar} disabled={unica} title={unica ? 'O funil precisa de pelo menos uma etapa' : 'Apagar etapa'}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:border-danger hover:bg-danger-soft hover:text-danger disabled:opacity-30" aria-label={`Apagar ${etapa.nome}`}>
        <Icon name="trash" size={15} />
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
