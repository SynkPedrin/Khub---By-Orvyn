'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { automations, type ItemDlq, type WorkflowResumo } from '@/lib/automations';

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
  const [ajuda, setAjuda] = useState(true);
  useEffect(() => { setAjuda(localStorage.getItem('khub:auto-ajuda') !== 'off'); }, []);
  const fecharAjuda = () => { setAjuda(false); localStorage.setItem('khub:auto-ajuda', 'off'); };

  const load = useCallback(() => {
    setErroCarregar(false);
    automations.listar().then(setRows).catch(() => { setRows([]); setErroCarregar(true); });
    automations.dlq().then(setDlq).catch(() => setDlq([]));
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

  const reprocessar = async (id: string) => { await automations.reprocessar(id); load(); };

  const todasTags = Array.from(new Set((rows ?? []).flatMap((r) => r.tags))).sort((a, b) => a.localeCompare(b));
  const q = busca.trim().toLowerCase();
  const filtradas = (rows ?? []).filter((w) => {
    if (fStatus !== 'todos' && w.status !== fStatus) return false;
    if (fTag && !w.tags.includes(fTag)) return false;
    if (q && !(`${w.nome} ${w.descricao ?? ''} ${w.tags.join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const temFiltro = fStatus !== 'todos' || fTag !== null || q.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Automações</h1>
          <p className="text-sm text-muted">Gatilhos, condições e ações, executando de verdade, com log de cada passo.</p>
        </div>
        <Button onClick={() => setModal(true)}><Icon name="plus" size={16} /> Nova automação</Button>
      </div>

      {/* Introdução + tutorial de uso */}
      {ajuda && (
        <Card className="relative overflow-hidden p-5">
          <button onClick={fecharAjuda} className="absolute right-3 top-3 rounded-lg p-1 text-muted hover:bg-surface2 hover:text-fg" aria-label="Fechar ajuda"><Icon name="close" size={15} /></button>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="sparkles" size={17} /></span>
            <h2 className="font-bold text-fg">Como funciona uma automação</h2>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">Um fluxo que trabalha sozinho, 24/7: um <b className="text-fg">gatilho</b> inicia, o <b className="text-fg">controle</b> decide o caminho e as <b className="text-fg">ações</b> acontecem, cada passo com log.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { n: '1', t: 'Gatilho', d: 'O que dá a largada: lead novo, mensagem recebida, tag, negócio ganho/perdido, webhook…', i: 'plus' as const },
              { n: '2', t: 'Controle', d: 'O caminho: esperar, esperar resposta, if/else, teste A/B, liberar em lotes.', i: 'filter' as const },
              { n: '3', t: 'Ação', d: 'O que acontece: enviar WhatsApp/e-mail, criar oportunidade/tarefa, marcar tag, IA analisar…', i: 'check' as const },
            ].map((p) => (
              <div key={p.n} className="rounded-2xl border border-line bg-surface2 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-[11px] font-bold text-white">{p.n}</span>
                  <span className="font-semibold text-fg">{p.t}</span>
                </div>
                <p className="mt-1.5 text-xs leading-snug text-muted">{p.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setModal(true)}><Icon name="plus" size={15} /> Criar do zero</Button>
            <Link href="/marketing" className="btn btn-ghost text-sm"><Icon name="sparkles" size={15} /> Instalar uma pronta (Biblioteca)</Link>
          </div>
        </Card>
      )}

      {dlq.length > 0 && (
        <Card className="border-amber-400/40 bg-amber-400/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
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
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar automação ou tag…" className="input pl-9" />
          </div>
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface2 p-1">
            {(['todos', 'ativo', 'pausado', 'rascunho'] as const).map((s) => (
              <button key={s} onClick={() => setFStatus(s)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${fStatus === s ? 'bg-brand text-white' : 'text-muted hover:text-fg'}`}>{s}</button>
            ))}
          </div>
          {temFiltro && <button onClick={() => { setBusca(''); setFStatus('todos'); setFTag(null); }} className="text-xs font-semibold text-brand hover:underline">Limpar</button>}
        </div>
      )}
      {rows && todasTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {todasTags.map((t) => (
            <button key={t} onClick={() => setFTag(fTag === t ? null : t)} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${fTag === t ? 'border-brand bg-brand/12 text-brand' : 'border-line text-muted hover:bg-surface2'}`}>#{t}</button>
          ))}
        </div>
      )}

      {!rows && <p className="py-10 text-center text-sm text-muted">Carregando…</p>}
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
          <Button className="mt-4" onClick={() => setModal(true)}><Icon name="plus" size={16} /> Criar a primeira</Button>
        </Card>
      )}

      {rows && rows.length > 0 && filtradas.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">Nenhuma automação bate com o filtro.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {filtradas.map((w) => (
          <Card key={w.id} onClick={() => router.push(`/automacoes/${w.id}`)} className="cursor-pointer p-4 transition hover:border-brand/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-fg">{w.nome}</p>
                <p className="truncate text-xs text-muted">{w.descricao || 'sem descrição'}</p>
              </div>
              <Badge tone={w.status === 'ativo' ? 'green' : w.status === 'pausado' ? 'amber' : 'neutral'}>{w.status}</Badge>
            </div>
            {w.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {w.tags.map((t) => (
                  <button key={t} onClick={(e) => { e.stopPropagation(); setFTag(t); }} className="rounded-full bg-brand/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand hover:bg-brand/20">#{t}</button>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[11px] text-muted">
              <span>{w.versaoAtiva ? `v${w.versaoAtiva} no ar` : 'nunca publicado'}</span>
              <span>· {w.execucoes} execução(ões)</span>
              {w.falhas > 0 && <span className="font-bold text-red-500">· {w.falhas} falha(s)</span>}
            </div>
          </Card>
        ))}
      </div>

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
