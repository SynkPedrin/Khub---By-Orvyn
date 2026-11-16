'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Confirm, SkeletonRows } from '@/components/kit';
import { financeiro, type Categoria } from '@/lib/financeiro';
import { falhaDeCarga, mensagemFin, type FalhaCarga } from './fin-utils';
import { FinAviso, FinFalha } from './FinEstado';

/** Categorias de entrada e saída do fluxo de caixa (criar, renomear e excluir). */
export function FinCategorias() {
  const [lista, setLista] = useState<Categoria[] | null>(null);
  const [falha, setFalha] = useState<FalhaCarga | null>(null);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [renomear, setRenomear] = useState<{ id: string; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<Categoria | null>(null);

  const load = () => {
    setFalha(null);
    financeiro.categorias().then(setLista).catch((e) => setFalha(falhaDeCarga(e, 'as categorias')));
  };
  useEffect(load, []);

  const criar = async () => {
    if (!nome.trim()) { setMsg('Informe o nome da categoria.'); return; }
    setBusy('criar'); setMsg(null);
    try {
      await financeiro.criarCategoria({ nome: nome.trim(), tipo });
      setNome('');
      load();
    } catch (e) { setMsg(mensagemFin(e, 'criar a categoria')); } finally { setBusy(null); }
  };

  const salvarNome = async () => {
    if (!renomear) return;
    if (!renomear.nome.trim()) { setMsg('Informe o nome da categoria.'); return; }
    setBusy(renomear.id); setMsg(null);
    try {
      await financeiro.atualizarCategoria(renomear.id, { nome: renomear.nome.trim() });
      setRenomear(null);
      load();
    } catch (e) { setMsg(mensagemFin(e, 'renomear a categoria')); } finally { setBusy(null); }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setBusy('excluir'); setMsg(null);
    try {
      await financeiro.removerCategoria(excluir.id);
      setExcluir(null);
      load();
    } catch (e) {
      setExcluir(null);
      setMsg(mensagemFin(e, 'excluir a categoria'));
    } finally { setBusy(null); }
  };

  const grupos: { tipo: 'entrada' | 'saida'; titulo: string }[] = [
    { tipo: 'entrada', titulo: 'Categorias de entrada' },
    { tipo: 'saida', titulo: 'Categorias de saída' },
  ];

  if (falha) return <Card><FinFalha falha={falha} onTentar={load} /></Card>;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="mb-3 font-bold text-fg">Nova categoria</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            {(['entrada', 'saida'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tipo === t ? 'border-brand/50 bg-brand/10 text-brand' : 'border-line text-muted hover:text-fg'}`}>
                {t === 'entrada' ? 'Entrada' : 'Saída'}
              </button>
            ))}
          </div>
          <div className="min-w-56 flex-1">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Produtos de beleza" maxLength={60} aria-label="Nome da categoria" onKeyDown={(e) => e.key === 'Enter' && criar()} />
          </div>
          <Button onClick={criar} disabled={busy === 'criar'}><Icon name="plus" size={16} /> {busy === 'criar' ? 'Criando…' : 'Criar'}</Button>
        </div>
        {msg && <div className="mt-3"><FinAviso texto={msg} /></div>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <Card key={g.tipo} className="overflow-hidden p-0">
            <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">{g.titulo}</h2></div>
            <div className="divide-y divide-line">
              {lista?.filter((c) => c.tipo === g.tipo).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  {renomear?.id === c.id ? (
                    <>
                      <Input
                        value={renomear.nome}
                        onChange={(e) => setRenomear({ id: c.id, nome: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') void salvarNome(); if (e.key === 'Escape') setRenomear(null); }}
                        maxLength={60}
                        aria-label={`Novo nome de ${c.nome}`}
                        autoFocus
                      />
                      <Button onClick={salvarNome} disabled={busy === c.id}>{busy === c.id ? 'Salvando…' : 'Salvar'}</Button>
                      <Button variant="ghost" onClick={() => setRenomear(null)}>Cancelar</Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-fg">{c.nome}</p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setRenomear({ id: c.id, nome: c.nome })} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label={`Renomear ${c.nome}`}><Icon name="edit" size={14} /></button>
                        <button onClick={() => setExcluir(c)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label={`Excluir ${c.nome}`}><Icon name="trash" size={14} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {lista && lista.filter((c) => c.tipo === g.tipo).length === 0 && <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma categoria.</p>}
              {!lista && <SkeletonRows rows={3} label="Carregando categorias" />}
            </div>
          </Card>
        ))}
      </div>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={busy === 'excluir'}
        title={`Excluir a categoria ${excluir?.nome ?? ''}?`}
        description="Os lançamentos que usavam esta categoria continuam no caixa, só que sem categoria."
      />
    </div>
  );
}
