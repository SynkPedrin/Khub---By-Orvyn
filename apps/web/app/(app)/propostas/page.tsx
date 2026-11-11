'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Drawer, Modal, SkeletonRows, Switch, Tabs, useToast } from '@/components/kit';
import { BuscaVinculo, type Vinculo } from '@/components/crm/BuscaVinculo';
import { moeda } from '@/lib/format';
import { propostasApi, totalProposta, type AcaoProposta, type ItemProposta, type PropostaResumo, type ResumoPropostas, type StatusProposta } from '@/lib/comercial';

const STATUS: Record<StatusProposta, { rotulo: string; tom: 'brand' | 'green' | 'amber' | 'neutral' }> = {
  rascunho: { rotulo: 'Rascunho', tom: 'neutral' },
  enviada: { rotulo: 'Enviada', tom: 'brand' },
  aceita: { rotulo: 'Aceita', tom: 'green' },
  recusada: { rotulo: 'Recusada', tom: 'amber' },
  expirada: { rotulo: 'Expirada', tom: 'amber' },
  cancelada: { rotulo: 'Cancelada', tom: 'neutral' },
};
const FILTROS = [
  { value: 'todas', label: 'Todas' }, { value: 'rascunho', label: 'Rascunhos' }, { value: 'enviada', label: 'Enviadas' },
  { value: 'aceita', label: 'Aceitas' }, { value: 'recusada', label: 'Recusadas' }, { value: 'expirada', label: 'Expiradas' },
];
const dataBR = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '');
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

export default function PropostasPage() {
  const toast = useToast();
  const [filtro, setFiltro] = useState('todas');
  const [q, setQ] = useState('');
  const [dados, setDados] = useState<{ itens: PropostaResumo[]; resumo: ResumoPropostas } | null>(null);
  const [editando, setEditando] = useState<string | 'nova' | null>(null);
  const [recusando, setRecusando] = useState<PropostaResumo | null>(null);

  const carregar = () => propostasApi.listar({ status: filtro === 'todas' ? undefined : filtro, q: q.trim() || undefined }).then(setDados).catch((e) => { toast.error('Não foi possível carregar as propostas', { description: msg(e) }); setDados({ itens: [], resumo: { rascunho: 0, enviadas: 0, paradas: 0, aceitas: 0, valorEmNegociacao: 0, valorAceito: 0, taxaAceite: null } }); });
  useEffect(() => { const t = setTimeout(carregar, q ? 250 : 0); return () => clearTimeout(t); }, [filtro, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (p: PropostaResumo, acao: AcaoProposta) => {
    if (acao === 'recusar') { setRecusando(p); return; }
    try {
      const r = await propostasApi.acao(p.id, acao);
      toast.success({ enviar: 'Proposta marcada como enviada', aceitar: 'Proposta aceita', cancelar: 'Proposta cancelada', reabrir: 'Proposta reaberta como rascunho', recusar: '' }[acao], r.negocioAtualizado === 'ganho' ? { description: 'O negócio ligado foi marcado como ganho.' } : undefined);
      carregar();
    } catch (e) { toast.error('Não foi possível atualizar', { description: msg(e) }); }
  };

  const r = dados?.resumo;
  const kpis = [
    { l: 'Em negociação', v: r ? moeda(r.valorEmNegociacao) : '-', d: r ? `${r.enviadas} enviada(s)` : '' },
    { l: 'Aceito', v: r ? moeda(r.valorAceito) : '-', d: r ? `${r.aceitas} proposta(s)` : '' },
    { l: 'Taxa de aceite', v: r?.taxaAceite == null ? 'Poucos dados' : `${r.taxaAceite}%`, d: 'aceitas ÷ decididas' },
    { l: 'Paradas', v: r ? String(r.paradas) : '-', d: 'enviadas há 3+ dias sem resposta', alerta: !!r?.paradas },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display">Propostas</h1>
          <p className="mt-1 text-sm text-muted">Monte, envie e acompanhe propostas. Ao registrar o aceite, o negócio ligado vira ganho e entra na carteira de clientes.</p>
        </div>
        <Button onClick={() => setEditando('nova')}><Icon name="plus" size={16} /> Nova proposta</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.l} className={cx('p-4', k.alerta && 'ring-1 ring-amber-400/50')}>
            <p className="text-xs font-medium text-muted">{k.l}</p>
            <p className={cx('mt-2 text-2xl font-semibold tabular-nums', k.alerta ? 'text-amber-600 dark:text-amber-400' : 'text-fg')}>{k.v}</p>
            <p className="mt-0.5 text-[11px] text-muted">{k.d}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={FILTROS} value={filtro} onChange={setFiltro} label="Filtrar propostas por status" variant="segmented" idBase="propostas" />
        <div className="w-full max-w-xs"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo título" aria-label="Buscar proposta" /></div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-line">
          {!dados && <SkeletonRows rows={5} label="Carregando propostas" />}
          {dados?.itens.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="font-semibold text-fg">Nenhuma proposta {filtro !== 'todas' ? 'neste filtro' : 'ainda'}.</p>
              <p className="mt-1 text-sm text-muted">Crie a primeira e ligue a um negócio do funil.</p>
            </div>
          )}
          {dados?.itens.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <button onClick={() => setEditando(p.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate font-semibold text-fg">{p.titulo}</p>
                <p className="truncate text-[11px] text-muted">
                  {p.contato?.nome ?? 'Sem contato'}{p.negocio ? ` · ${p.negocio.titulo}` : ''}
                  {p.validade ? ` · válida até ${dataBR(p.validade)}` : ''}
                  {p.enviadaEm ? ` · enviada ${dataBR(p.enviadaEm)}` : ''}
                  {p.motivoRecusa ? ` · motivo: ${p.motivoRecusa}` : ''}
                </p>
              </button>
              <span className="text-sm font-semibold tabular-nums text-fg">{moeda(p.valor)}</span>
              {p.parada && <Badge tone="amber">Parada há {p.diasSemResposta} dias</Badge>}
              <Badge tone={STATUS[p.status].tom}>{STATUS[p.status].rotulo}</Badge>
              <AcoesProposta p={p} onAcao={(a) => agir(p, a)} />
            </div>
          ))}
        </div>
      </Card>

      {editando && <EditorProposta id={editando === 'nova' ? null : editando} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
      {recusando && <RecusaModal p={recusando} onClose={() => setRecusando(null)} onFeito={() => { setRecusando(null); carregar(); }} />}
    </div>
  );
}

function AcoesProposta({ p, onAcao }: { p: PropostaResumo; onAcao: (a: AcaoProposta) => void }) {
  const b = (a: AcaoProposta, rotulo: string, cls = 'text-muted hover:text-fg') => <button key={a} onClick={() => onAcao(a)} className={cx('rounded-lg px-2 py-1 text-[11px] font-semibold', cls)}>{rotulo}</button>;
  const verde = 'border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400';
  const marca = 'border border-brand/40 text-brand hover:bg-brand/10';
  return (
    <div className="flex items-center gap-1">
      {p.status === 'rascunho' && [b('enviar', 'Marcar enviada', marca), b('cancelar', 'Cancelar')]}
      {(p.status === 'enviada' || p.status === 'expirada') && [b('aceitar', 'Aceita', verde), b('recusar', 'Recusada', 'text-amber-600 hover:text-amber-700 dark:text-amber-400'), b('cancelar', 'Cancelar')]}
      {(p.status === 'recusada' || p.status === 'expirada' || p.status === 'cancelada') && b('reabrir', 'Reabrir')}
    </div>
  );
}

function RecusaModal({ p, onClose, onFeito }: { p: PropostaResumo; onClose: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [perdido, setPerdido] = useState(false);
  const [busy, setBusy] = useState(false);
  const enviar = async () => {
    setBusy(true);
    try { await propostasApi.acao(p.id, 'recusar', { motivo: motivo.trim(), marcarNegocioPerdido: perdido }); toast.success('Recusa registrada'); onFeito(); }
    catch (e) { toast.error('Não foi possível registrar', { description: msg(e) }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Registrar recusa" description="O motivo alimenta a análise de perdas."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={enviar} loading={busy} disabled={!motivo.trim()}>Registrar recusa</Button></>}>
      <div className="space-y-4">
        <label className="block text-sm font-medium text-fg">Motivo
          <Input className="mt-1" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: achou caro, fechou com concorrente" maxLength={500} autoFocus />
        </label>
        {p.negocio?.status === 'aberto' && <Switch checked={perdido} onChange={setPerdido} label="Marcar o negócio como perdido" description={`"${p.negocio.titulo}" sai do funil.`} />}
      </div>
    </Modal>
  );
}

const ITEM_VAZIO: ItemProposta = { descricao: '', quantidade: 1, valorUnitario: 0 };

function EditorProposta({ id, onClose, onSalvo }: { id: string | null; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [carregado, setCarregado] = useState(!id);
  const [status, setStatus] = useState<StatusProposta>('rascunho');
  const [titulo, setTitulo] = useState('');
  const [vinculo, setVinculo] = useState<Vinculo | null>(null);
  const [itens, setItens] = useState<ItemProposta[]>([{ ...ITEM_VAZIO }]);
  const [desconto, setDesconto] = useState('0');
  const [validade, setValidade] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    propostasApi.obter(id).then((p) => {
      setStatus(p.status); setTitulo(p.titulo); setItens(p.itens.length ? p.itens : [{ ...ITEM_VAZIO }]);
      setDesconto(String(p.desconto)); setValidade(p.validade ?? ''); setObservacoes(p.observacoes ?? '');
      setVinculo(p.negocio ? { tipo: 'negocio', id: p.negocio.id, titulo: p.negocio.titulo, subtitulo: p.contato?.nome } : p.contato ? { tipo: 'contato', id: p.contato.id, titulo: p.contato.nome } : null);
      setCarregado(true);
    }).catch((e) => { toast.error('Não foi possível abrir a proposta', { description: msg(e) }); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const editavel = status === 'rascunho' || status === 'enviada';
  const num = (s: string) => Number(String(s).replace(',', '.')) || 0;
  const total = useMemo(() => totalProposta(itens, num(desconto)), [itens, desconto]);
  const setItem = (i: number, d: Partial<ItemProposta>) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, ...d } : x)));

  const salvar = async () => {
    const limpos = itens.filter((i) => i.descricao.trim());
    if (!titulo.trim()) { toast.error('Dê um título à proposta'); return; }
    setBusy(true);
    const dados = {
      titulo: titulo.trim(), itens: limpos.map((i) => ({ ...i, descricao: i.descricao.trim() })), desconto: num(desconto),
      validade: validade || null, observacoes: observacoes.trim() || null,
      contactId: vinculo?.tipo === 'contato' ? vinculo.id : null, dealId: vinculo?.tipo === 'negocio' ? vinculo.id : null,
    };
    try {
      if (id) await propostasApi.atualizar(id, dados); else await propostasApi.criar(dados);
      toast.success(id ? 'Proposta salva' : 'Proposta criada');
      onSalvo();
    } catch (e) { toast.error('Não foi possível salvar', { description: msg(e) }); } finally { setBusy(false); }
  };
  const apagar = async () => {
    if (!id) return;
    try { await propostasApi.apagar(id); toast.success('Proposta apagada'); onSalvo(); } catch (e) { toast.error('Não foi possível apagar', { description: msg(e) }); }
  };

  return (
    <Drawer open onClose={onClose} title={id ? 'Proposta' : 'Nova proposta'} width="sm:max-w-2xl"
      description={id ? <Badge tone={STATUS[status].tom}>{STATUS[status].rotulo}</Badge> : 'Ligue a um negócio para que o aceite marque o negócio como ganho.'}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span>{id && (status === 'rascunho' || status === 'cancelada') && <Button variant="ghost" onClick={apagar}><Icon name="trash" size={14} /> Apagar</Button>}</span>
          <span className="flex gap-2"><Button variant="ghost" onClick={onClose}>Fechar</Button>{editavel && <Button onClick={salvar} loading={busy}>Salvar</Button>}</span>
        </div>
      }>
      {!carregado ? <SkeletonRows rows={4} label="Carregando proposta" /> : (
        <fieldset disabled={!editavel} className="space-y-5">
          {!editavel && <p className="rounded-lg bg-surface2 px-3 py-2 text-xs text-muted">Proposta {STATUS[status].rotulo.toLowerCase()} não pode ser editada. Reabra-a na lista para alterar.</p>}
          <label className="block text-sm font-medium text-fg">Título<Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Pacote progressiva + hidratação" maxLength={160} autoFocus /></label>
          <div className="text-sm font-medium text-fg">Para quem<div className="mt-1"><BuscaVinculo valor={vinculo} onChange={setVinculo} /></div></div>

          <div>
            <p className="text-sm font-medium text-fg">Itens</p>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-[1fr_72px_112px_28px] gap-2 text-[11px] font-medium text-muted"><span>Descrição</span><span>Qtd.</span><span>Valor unit. (R$)</span><span /></div>
              {itens.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px_112px_28px] items-center gap-2">
                  <Input value={it.descricao} onChange={(e) => setItem(i, { descricao: e.target.value })} placeholder="Serviço ou produto" maxLength={200} aria-label={`Descrição do item ${i + 1}`} />
                  <Input type="number" min={0} step="any" value={it.quantidade} onChange={(e) => setItem(i, { quantidade: Number(e.target.value) })} aria-label={`Quantidade do item ${i + 1}`} />
                  <Input inputMode="decimal" value={String(it.valorUnitario)} onChange={(e) => setItem(i, { valorUnitario: num(e.target.value) })} aria-label={`Valor do item ${i + 1}`} />
                  <button type="button" onClick={() => setItens((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [{ ...ITEM_VAZIO }]))} className="rounded p-1 text-muted hover:text-red-500" aria-label={`Remover item ${i + 1}`}><Icon name="close" size={13} /></button>
                </div>
              ))}
              {itens.length < 50 && <button type="button" onClick={() => setItens((xs) => [...xs, { ...ITEM_VAZIO }])} className="text-xs font-semibold text-brand hover:underline">+ Adicionar item</button>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-fg">Desconto (R$)<Input className="mt-1" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} /></label>
            <label className="block text-sm font-medium text-fg">Válida até<Input className="mt-1" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></label>
            <div className="rounded-xl bg-brand/10 px-3 py-2"><p className="text-[11px] font-medium text-muted">Total</p><p className="text-xl font-semibold tabular-nums text-fg">{moeda(total)}</p></div>
          </div>
          <label className="block text-sm font-medium text-fg">Observações e condições
            <textarea className="input mt-1 min-h-[90px] w-full" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={4000} placeholder="Forma de pagamento, prazo de execução, o que está incluído" />
          </label>
          {vinculo?.tipo === 'negocio' && <p className="text-[11px] text-muted">Ao registrar o aceite, o negócio <Link href="/pipeline" className="font-semibold text-brand">{vinculo.titulo}</Link> vira ganho.</p>}
        </fieldset>
      )}
    </Drawer>
  );
}
