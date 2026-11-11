'use client';

import { useState } from 'react';
import { Button, Confirm, Modal, Textarea, useToast } from '@/components/kit';
import { EmptyState } from '@/components/revenue/States';
import { ApiError } from '@/lib/api-error';
import { inbox, type RespostaRapida } from '@/lib/inbox';

const VARIAVEIS = ['contato.nome', 'contato.primeiro_nome', 'contato.telefone', 'contato.email', 'contato.empresa', 'atendente.nome', 'negocio.titulo'];

type Rascunho = { id?: string; atalho: string; titulo: string; corpo: string };
const VAZIO: Rascunho = { atalho: '', titulo: '', corpo: '' };

/** Cadastro das respostas rápidas (Q2.5): lista, criar, editar e excluir com confirmação. */
export function RespostasRapidasModal({ open, onClose, respostas, onMudou }: { open: boolean; onClose: () => void; respostas: RespostaRapida[]; onMudou: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [excluir, setExcluir] = useState<RespostaRapida | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const salvar = async () => {
    if (!edit) return;
    setSalvando(true);
    setErro('');
    try {
      const d = { atalho: edit.atalho, titulo: edit.titulo, corpo: edit.corpo };
      if (edit.id) await inbox.atualizarResposta(edit.id, d);
      else await inbox.criarResposta(d);
      toast.success(edit.id ? 'Resposta rápida atualizada' : 'Resposta rápida criada');
      setEdit(null);
      onMudou();
    } catch (e) {
      setErro(e instanceof ApiError && e.message ? e.message : 'Não consegui salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await inbox.removerResposta(excluir.id);
      toast.success('Resposta rápida excluída');
      setExcluir(null);
      onMudou();
    } catch (e) {
      toast.error('Não consegui excluir', { description: e instanceof ApiError ? e.message : undefined });
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <>
      <Modal
        open={open && !excluir}
        onClose={() => { setEdit(null); setErro(''); onClose(); }}
        title={edit ? (edit.id ? 'Editar resposta rápida' : 'Nova resposta rápida') : 'Respostas rápidas'}
        description={edit ? undefined : 'Digite / no campo de mensagem para usar. As variáveis são preenchidas com os dados da conversa.'}
        size="lg"
        footer={
          edit ? (
            <>
              <Button variant="ghost" onClick={() => { setEdit(null); setErro(''); }}>Voltar</Button>
              <Button variant="primary" onClick={() => void salvar()} loading={salvando} disabled={!edit.atalho.trim() || !edit.titulo.trim() || !edit.corpo.trim()}>Salvar</Button>
            </>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setEdit({ ...VAZIO })}>Nova resposta</Button>
          )
        }
      >
        {edit ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-fg">Atalho</span>
                <span className="flex items-center rounded-xl border border-line bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand/30">
                  <span className="text-muted">/</span>
                  <input className="w-full bg-transparent px-1 py-2 text-sm text-fg outline-none" value={edit.atalho} maxLength={32} onChange={(e) => setEdit({ ...edit, atalho: e.target.value })} placeholder="boas-vindas" />
                </span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-fg">Título</span>
                <input className="input w-full" value={edit.titulo} maxLength={80} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} placeholder="Boas-vindas ao lead" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-fg">Texto</span>
              <Textarea rows={5} maxLength={4000} showCount value={edit.corpo} onChange={(e) => setEdit({ ...edit, corpo: e.target.value })} placeholder="Oi {{contato.primeiro_nome}}, aqui é {{atendente.nome}}." />
            </label>
            <div>
              <p className="mb-1.5 text-xs text-muted">Inserir variável</p>
              <div className="flex flex-wrap gap-1.5">
                {VARIAVEIS.map((v) => (
                  <button key={v} type="button" className="pill hover:bg-[var(--fill-4)]" onClick={() => setEdit({ ...edit, corpo: `${edit.corpo}{{${v}}}` })}>
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
            {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
          </div>
        ) : respostas.length === 0 ? (
          <EmptyState icon="zap" title="Nenhuma resposta rápida" description="Crie mensagens prontas para responder em segundos." />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {respostas.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-brand">/{r.atalho}</span>
                    <span className="truncate text-sm font-medium text-fg">{r.titulo}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-muted">{r.corpo}</p>
                </div>
                <Button size="sm" variant="ghost" icon="edit" iconOnly aria-label={`Editar /${r.atalho}`} onClick={() => setEdit({ id: r.id, atalho: r.atalho, titulo: r.titulo, corpo: r.corpo })} />
                <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label={`Excluir /${r.atalho}`} onClick={() => setExcluir(r)} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={() => void confirmarExclusao()}
        loading={excluindo}
        title={`Excluir /${excluir?.atalho ?? ''}?`}
        description="A resposta some para toda a equipe. Mensagens já enviadas não mudam."
      />
    </>
  );
}
