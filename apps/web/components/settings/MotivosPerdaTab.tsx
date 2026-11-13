'use client';

import { useEffect, useState } from 'react';
import { Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, SkeletonRows, Switch, useToast } from '@/components/kit';
import { pipelineApi, mensagemDeErro, type MotivoPerda } from '@/lib/pipeline';

/**
 * Configurações › Motivos de perda (Q2.1). Motivo ativo aparece no modal de
 * "Marcar como perdido" e passa a ser obrigatório; desativar tira da lista sem
 * apagar o histórico. Apagar só vale para motivo que nenhum negócio usa.
 */
export function MotivosPerdaTab() {
  const toast = useToast();
  const [motivos, setMotivos] = useState<MotivoPerda[] | null>(null);
  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [apagar, setApagar] = useState<MotivoPerda | null>(null);
  const [apagando, setApagando] = useState(false);

  const carregar = () =>
    pipelineApi.motivos().then(setMotivos).catch((e) => {
      toast.error('Não foi possível carregar os motivos', { description: mensagemDeErro(e) });
      setMotivos([]);
    });
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const acao = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await carregar();
      return true;
    } catch (e) {
      toast.error('Não foi possível salvar', { description: mensagemDeErro(e) });
      return false;
    }
  };

  const criar = async () => {
    if (!nome.trim()) return;
    setCriando(true);
    if (await acao(() => pipelineApi.criarMotivo(nome.trim()), 'Motivo criado.')) setNome('');
    setCriando(false);
  };

  const mover = (i: number, delta: -1 | 1) => {
    if (!motivos) return;
    const j = i + delta;
    if (j < 0 || j >= motivos.length) return;
    const ids = motivos.map((m) => m.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setMotivos(ids.map((id) => motivos.find((m) => m.id === id)!));
    void acao(() => pipelineApi.reordenarMotivos(ids));
  };

  const ativos = motivos?.filter((m) => m.ativo).length ?? 0;

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-semibold text-fg">Novo motivo de perda</h2>
        <p className="mt-0.5 text-sm text-muted">Com pelo menos um motivo ativo, marcar um negócio como perdido exige escolher o motivo.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
          <div className="min-w-[220px] flex-1">
            <Field label="Nome"><Input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Prazo de entrega" /></Field>
          </div>
          <Button type="submit" variant="primary" icon="plus" loading={criando} disabled={!nome.trim()}>Adicionar</Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-semibold text-fg">Motivos</h2>
          {motivos && <span className="text-xs text-muted tabular">{ativos} de {motivos.length} ativos</span>}
        </div>
        {!motivos ? (
          <div className="p-5"><SkeletonRows rows={4} /></div>
        ) : motivos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhum motivo cadastrado.</p>
        ) : (
          <ul className="divide-y divide-line">
            {motivos.map((m, i) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex flex-col">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm h-6 w-6" aria-label={`Subir ${m.nome}`} disabled={i === 0} onClick={() => mover(i, -1)}><Icon name="arrowUp" size={13} /></button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm h-6 w-6" aria-label={`Descer ${m.nome}`} disabled={i === motivos.length - 1} onClick={() => mover(i, 1)}><Icon name="arrowDown" size={13} /></button>
                </div>
                {editando?.id === m.id ? (
                  <form
                    className="flex min-w-[200px] flex-1 items-center gap-2"
                    onSubmit={async (e) => { e.preventDefault(); if (await acao(() => pipelineApi.atualizarMotivo(m.id, { nome: editando.nome }), 'Motivo renomeado.')) setEditando(null); }}
                  >
                    <Input autoFocus aria-label="Novo nome do motivo" value={editando.nome} maxLength={60} onChange={(e) => setEditando({ id: m.id, nome: e.target.value })} />
                    <Button type="submit" size="sm" variant="primary" disabled={!editando.nome.trim()}>Salvar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                  </form>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className={cx('truncate text-sm font-medium', m.ativo ? 'text-fg' : 'text-muted line-through')}>{m.nome}</p>
                    <p className="text-xs text-muted tabular">{m.usos === 0 ? 'Nenhum negócio' : `${m.usos} ${m.usos === 1 ? 'negócio' : 'negócios'}`}</p>
                  </div>
                )}
                <Switch label={m.ativo ? 'Ativo' : 'Inativo'} checked={m.ativo} onChange={(v) => void acao(() => pipelineApi.atualizarMotivo(m.id, { ativo: v }), v ? 'Motivo ativado.' : 'Motivo desativado.')} />
                <Button size="sm" variant="ghost" icon="edit" iconOnly aria-label={`Renomear ${m.nome}`} onClick={() => setEditando({ id: m.id, nome: m.nome })} />
                <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label={`Apagar ${m.nome}`} disabled={m.usos > 0} title={m.usos > 0 ? 'Em uso: desative em vez de apagar' : undefined} onClick={() => setApagar(m)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Confirm
        open={!!apagar}
        onClose={() => setApagar(null)}
        loading={apagando}
        title={`Apagar o motivo "${apagar?.nome ?? ''}"?`}
        description="Ele some da lista de motivos. Nenhum negócio usa este motivo hoje."
        confirmLabel="Apagar motivo"
        onConfirm={async () => {
          if (!apagar) return;
          setApagando(true);
          await acao(() => pipelineApi.removerMotivo(apagar.id), 'Motivo apagado.');
          setApagando(false);
          setApagar(null);
        }}
      />
    </div>
  );
}
