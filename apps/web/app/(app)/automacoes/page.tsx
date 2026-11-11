'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Confirm, Menu, Select, SkeletonCards, useToast, type MenuEntry } from '@/components/kit';
import { MoverParaPasta } from '@/components/automations/editor/MoverParaPasta';
import { ACENTO, ICONE } from '@/components/automations/NoCanvas';
import { SeloNo } from '@/components/automations/marcas';
import { automations, type ItemDlq, type MetricasLista, type WorkflowResumo } from '@/lib/automations';

const STATUS: Record<string, { rotulo: string; tom: 'green' | 'amber' | 'neutral' }> = {
  ativo: { rotulo: 'Publicado', tom: 'green' },
  pausado: { rotulo: 'Pausado', tom: 'amber' },
  rascunho: { rotulo: 'Rascunho', tom: 'neutral' },
};
const SEM_PASTA = '__sem_pasta__';

export default function AutomacoesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkflowResumo[] | null>(null);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [dlq, setDlq] = useState<ItemDlq[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nome: '', descricao: '' });
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState<'todos' | 'ativo' | 'pausado' | 'rascunho'>('todos');
  const [fTag, setFTag] = useState<string | null>(null);
  const [fPasta, setFPasta] = useState<string>('');
  const [metricas, setMetricas] = useState<MetricasLista | null>(null);
  const [excluindo, setExcluindo] = useState<WorkflowResumo | null>(null);
  const [movendo, setMovendo] = useState<WorkflowResumo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const toast = useToast();
  const [ajuda, setAjuda] = useState(true);
  useEffect(() => { setAjuda(localStorage.getItem('khub:auto-ajuda') !== 'off'); }, []);
  const fecharAjuda = () => { setAjuda(false); localStorage.setItem('khub:auto-ajuda', 'off'); };

  const load = useCallback(() => {
    setErroCarregar(false);
    automations.listar().then(setRows).catch(() => { setRows([]); setErroCarregar(true); });
    automations.dlq().then(setDlq).catch(() => setDlq([]));
    automations.metricas(30).then(setMetricas).catch(() => setMetricas(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSalvando(true);
    try {
      const r = await automations.criar(form.nome, form.descricao || undefined);
      router.push(`/automacoes/${r.id}`);
    } finally {
      setSalvando(false);
    }
  };

  /** Modo simples: abre um fluxo novo direto na conversa com a NICO. */
  const criarComNico = async () => {
    setSalvando(true);
    try {
      const r = await automations.criar('Nova automação');
      router.push(`/automacoes/${r.id}?modo=simples`);
    } catch {
      toast.error('Não consegui criar o fluxo agora.');
      setSalvando(false);
    }
  };

  const reprocessar = async (id: string) => {
    try {
      await automations.reprocessar(id);
      toast.success('Execução reenviada para o fluxo.');
      load();
    } catch {
      toast.error('Não consegui reprocessar essa execução.');
    }
  };

  const duplicar = async (w: WorkflowResumo) => {
    try {
      const r = await automations.duplicar(w.id);
      toast.success(`Cópia criada: ${r.nome}.`, { description: 'Ela nasce em rascunho, sem a URL de webhook do original.' });
      load();
    } catch {
      toast.error('Não consegui duplicar o fluxo.');
    }
  };

  const excluir = async () => {
    if (!excluindo) return;
    setOcupado(true);
    try {
      await automations.remover(excluindo.id);
      toast.success(`"${excluindo.nome}" excluído.`);
      setRows((rs) => (rs ?? []).filter((r) => r.id !== excluindo.id));
      setExcluindo(null);
    } catch {
      toast.error('Não consegui excluir o fluxo.');
    } finally {
      setOcupado(false);
    }
  };

  const mover = async (pasta: string | null) => {
    if (!movendo) return;
    try {
      await automations.renomear(movendo.id, { pasta });
      setRows((rs) => (rs ?? []).map((r) => (r.id === movendo.id ? { ...r, pasta } : r)));
      toast.success(pasta ? `Movido para "${pasta}".` : 'Fluxo fora de pasta.');
    } catch {
      toast.error('Não consegui mover o fluxo.');
      throw new Error('mover');
    }
  };

  const menuDo = (w: WorkflowResumo): MenuEntry[] => [
    { id: 'abrir', label: 'Abrir no editor', icon: 'edit', onSelect: () => router.push(`/automacoes/${w.id}`) },
    { id: 'exec', label: 'Ver execuções', icon: 'trend', onSelect: () => router.push(`/automacoes/${w.id}/execucoes`) },
    { id: 'dup', label: 'Duplicar', icon: 'copy', onSelect: () => void duplicar(w) },
    { id: 'pasta', label: 'Mover para pasta', icon: 'folder', onSelect: () => setMovendo(w) },
    { type: 'separator', id: 's' },
    { id: 'excluir', label: 'Excluir', icon: 'trash', danger: true, onSelect: () => setExcluindo(w) },
  ];
  const pastas = Array.from(new Set((rows ?? []).map((r) => r.pasta).filter((p): p is string => !!p))).sort((a, b) => a.localeCompare(b));

  const todasTags = Array.from(new Set((rows ?? []).flatMap((r) => r.tags))).sort((a, b) => a.localeCompare(b));
  const q = busca.trim().toLowerCase();
  const filtradas = (rows ?? []).filter((w) => {
    if (fStatus !== 'todos' && w.status !== fStatus) return false;
    if (fTag && !w.tags.includes(fTag)) return false;
    if (fPasta === SEM_PASTA ? !!w.pasta : fPasta && w.pasta !== fPasta) return false;
    if (q && !(`${w.nome} ${w.descricao ?? ''} ${w.pasta ?? ''} ${w.tags.join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const temFiltro = fStatus !== 'todos' || fTag !== null || fPasta !== '' || q.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Automações</h1>
          <p className="text-sm text-muted">Fluxos que trabalham sozinhos, com log de cada passo.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/marketing" className="btn btn-ghost text-sm">Prontas da Biblioteca</Link>
          <Button variant="ghost" onClick={() => setModal(true)}><Icon name="grid" size={16} /> Montar no canvas</Button>
          <Button onClick={() => void criarComNico()} disabled={salvando}><Icon name="sparkles" size={16} /> Criar com a NICO</Button>
        </div>
      </div>

      {/* Duas formas de criar (fecha e não volta: preferência deste navegador) */}
      {ajuda && (
        <div className="relative grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => void criarComNico()} className="group flex items-start gap-3 rounded-3xl border border-line bg-surface p-4 text-left transition hover:border-brand-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nico-avatar.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
            <span className="min-w-0">
              <span className="block font-semibold text-fg">Simples: converse com a NICO</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">Diga o que fazer e quando. Ela monta, testa com dados reais no número de teste e você só publica.</span>
            </span>
          </button>
          <button type="button" onClick={() => setModal(true)} className="group flex items-start gap-3 rounded-3xl border border-line bg-surface p-4 text-left transition hover:border-brand-border">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon name="grid" size={18} /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-fg">Avançado: monte no canvas</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">Gatilho, condições e ações nó a nó, com ramos, esperas e testes A/B.</span>
            </span>
          </button>
          <button onClick={fecharAjuda} className="absolute -right-1 -top-1 rounded-full border border-line bg-surface p-1 text-muted hover:text-fg" aria-label="Fechar"><Icon name="close" size={12} /></button>
        </div>
      )}

      {dlq.length > 0 && (
        <Card className="border-warning-border bg-warning-soft p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-warning">
              {dlq.length} execução(ões) travada(s) por erro
            </p>
            <span className="text-[11px] text-muted">esgotaram as tentativas</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {dlq.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-fg">{d.tipo}</span>
                  <span className="block truncate text-[11px] text-muted">{d.erro}</span>
                </span>
                <button onClick={() => reprocessar(d.id)} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                  Tentar de novo
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Barra de filtros do workspace */}
      {rows && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar automação, pasta ou tag…" aria-label="Buscar automação" className="input pl-9" />
          </div>
          {pastas.length > 0 && (
            <Select
              value={fPasta}
              onChange={setFPasta}
              aria-label="Filtrar por pasta"
              className="w-auto min-w-[160px]"
              placeholder="Todas as pastas"
              options={[{ value: SEM_PASTA, label: 'Sem pasta' }, ...pastas.map((p) => ({ value: p, label: p }))]}
            />
          )}
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface2 p-1">
            {(['todos', 'ativo', 'pausado', 'rascunho'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={fStatus === s} onClick={() => setFStatus(s)} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${fStatus === s ? 'bg-brand text-white' : 'text-muted hover:text-fg'}`}>{s === 'todos' ? 'Todos' : STATUS[s].rotulo}</button>
            ))}
          </div>
          {temFiltro && <button onClick={() => { setBusca(''); setFStatus('todos'); setFTag(null); setFPasta(''); }} className="text-xs font-semibold text-brand hover:underline">Limpar</button>}
        </div>
      )}
      {rows && todasTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {todasTags.map((t) => (
            <button key={t} onClick={() => setFTag(fTag === t ? null : t)} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${fTag === t ? 'border-brand bg-brand/12 text-brand' : 'border-line text-muted hover:bg-surface2'}`}>#{t}</button>
          ))}
        </div>
      )}

      {!rows && <SkeletonCards count={4} className="grid-cols-1" cardClassName="h-16" label="Carregando automações" />}
      {rows && erroCarregar && (
        <Card className="border-danger/40 bg-danger/5 p-10 text-center">
          <div className="text-3xl">⚠️</div>
          <p className="mt-2 font-bold text-fg">Não consegui carregar as automações</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            A conta atual pode não ter permissão, ou o servidor não respondeu. Isto não é a mesma coisa que &ldquo;nenhuma automação ainda&rdquo;, tente de novo antes de assumir que a conta está vazia.
          </p>
          <Button className="mt-4" variant="ghost" onClick={load}><Icon name="refresh" size={16} /> Tentar de novo</Button>
        </Card>
      )}
      {rows && !erroCarregar && rows.length === 0 && (
        <Card className="border-dashed p-10 text-center">
          <div className="text-3xl">⚡</div>
          <p className="mt-2 font-bold text-fg">Nenhuma automação ainda</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Crie um fluxo que responde sozinho: lead novo → mensagem → espera → e, dependendo da resposta, cria a oportunidade no funil.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => void criarComNico()}><Icon name="sparkles" size={16} /> Criar com a NICO</Button>
            <Button variant="ghost" onClick={() => setModal(true)}><Icon name="grid" size={16} /> Montar no canvas</Button>
          </div>
        </Card>
      )}

      {rows && rows.length > 0 && filtradas.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">Nenhuma automação bate com o filtro.</p>
      )}

      {filtradas.length > 0 && (
        <div className="overflow-hidden rounded-3xl border border-line bg-surface">
          <ul className="divide-y divide-[var(--border)]">
            {filtradas.map((w) => {
              const m = metricas?.porFluxo[w.id];
              const st = STATUS[w.status] ?? STATUS.rascunho;
              const tipos = w.tipos ?? [];
              const visiveis = tipos.slice(0, 5);
              return (
                <li key={w.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/automacoes/${w.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/automacoes/${w.id}`); }}
                    className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-[var(--fill-4)] lg:flex-nowrap"
                  >
                    {/* O que o fluxo faz, em logos: gatilho → passos */}
                    <div className="flex shrink-0 items-center" aria-label={`${tipos.length} passos`}>
                      {visiveis.length ? visiveis.map((t, i) => (
                        <span key={t} className="flex items-center">
                          {i > 0 && <Icon name="chevronRight" size={12} className="mx-0.5 text-faint" />}
                          <SeloNo tipo={t} icone={ICONE[t] ?? 'sparkles'} acento={ACENTO[t.split('.')[0]] ?? 'var(--brand)'} tamanho={26} />
                        </span>
                      )) : <span className="text-2xs text-faint">vazio</span>}
                      {tipos.length > visiveis.length && <span className="ml-1 text-2xs text-faint">+{tipos.length - visiveis.length}</span>}
                    </div>

                    <div className="min-w-0 flex-1 basis-56">
                      <p className="flex items-center gap-2 truncate font-semibold text-fg">
                        <span className="truncate">{w.nome}</span>
                        {w.pasta && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setFPasta(w.pasta!); }} className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-faint hover:text-fg">
                            <Icon name="folder" size={11} /> {w.pasta}
                          </button>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {w.descricao || (w.versaoAtiva ? `v${w.versaoAtiva} no ar` : 'nunca publicado')}
                        {w.tags.map((t) => (
                          <button key={t} type="button" onClick={(e) => { e.stopPropagation(); setFTag(t); }} className="ml-1.5 text-brand hover:underline">#{t}</button>
                        ))}
                      </p>
                    </div>

                    <dl className="flex shrink-0 items-center gap-4 text-xs tabular">
                      <div title="Contatos passando pelo fluxo agora"><dt className="sr-only">Ativos agora</dt><dd className="text-fg">{m ? m.ativos : '-'} <span className="text-faint">ativos</span></dd></div>
                      <div title="Concluídos nos últimos 30 dias"><dt className="sr-only">Concluídos 30d</dt><dd className="text-success">{m ? m.concluidos : '-'} <span className="text-faint">ok</span></dd></div>
                      <div title="Com erro nos últimos 30 dias"><dt className="sr-only">Com erro 30d</dt><dd className={m?.erros ? 'text-danger' : 'text-fg'}>{m ? m.erros : '-'} <span className="text-faint">erros</span></dd></div>
                    </dl>

                    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Badge tone={st.tom}>{st.rotulo}</Badge>
                      <Menu label={`Opções de ${w.nome}`} trigger={<Icon name="dots" size={16} />} items={menuDo(w)} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Confirm
        open={excluindo !== null}
        onClose={() => setExcluindo(null)}
        onConfirm={excluir}
        loading={ocupado}
        title={`Excluir "${excluindo?.nome ?? ''}"?`}
        description="O fluxo, todas as versões e o histórico de execuções somem. Quem está no meio dele para na hora. Não dá para desfazer."
        confirmLabel="Excluir fluxo"
        requireText="EXCLUIR"
      />
      <MoverParaPasta open={movendo !== null} onClose={() => setMovendo(null)} atual={movendo?.pasta ?? null} existentes={pastas} onMover={mover} />

      {modal && (
        <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setModal(false)}>
          <Card className="lg-sheet w-full max-w-md animate-scale-in p-6">
            <form onClick={(e) => e.stopPropagation()} onSubmit={criar} className="space-y-4">
              <h2 className="text-lg font-bold text-fg">Nova automação</h2>
              <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Follow-up de lead novo" autoFocus /></Field>
              <Field label="Descrição (opcional)"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="O que este fluxo faz" /></Field>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={salvando}>{salvando ? 'Criando…' : 'Criar e abrir editor'}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
