'use client';

import { useEffect, useState } from 'react';
import { Modal, SkeletonRows, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { AvatarContato } from './AvatarContato';
import { crm, type Contato } from '@/lib/crm';
import { inbox } from '@/lib/inbox';
import { ApiError } from '@/lib/api-error';

/**
 * Iniciar conversa (Q2.5): escolhe um contato COM telefone e abre a conversa
 * de WhatsApp com ele. Se já existe, a API devolve a mesma (nunca duplica).
 */
export function NovaConversaModal({ open, onClose, onAberta }: { open: boolean; onClose: () => void; onAberta: (conversationId: string) => void }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Contato[] | null>(null);
  const [erro, setErro] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setErro(false);
    const t = setTimeout(() => {
      crm
        .contacts({ q: busca.trim() || undefined, limit: 30 })
        .then((p) => vivo && setLista(p.items))
        .catch(() => vivo && setErro(true));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [open, busca, tentativa]);

  const iniciar = async (c: Contato) => {
    setAbrindo(c.id);
    try {
      const r = await inbox.iniciarConversa(c.id);
      toast.success(r.criada ? `Conversa com ${c.nome} criada` : `Abrindo a conversa com ${c.nome}`);
      onAberta(r.id);
      onClose();
    } catch (e) {
      toast.error('Não consegui iniciar a conversa', { description: e instanceof ApiError ? e.message : undefined });
    } finally {
      setAbrindo(null);
    }
  };

  const comTelefone = (lista ?? []).filter((c) => c.telefone?.replace(/\D/g, ''));

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa" description="Escolha um contato com telefone para conversar pelo WhatsApp.">
      <div className="relative mb-3">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input type="search" autoFocus className="input w-full pl-9" placeholder="Buscar por nome, telefone ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar contato" />
      </div>
      {erro ? (
        <ErrorState title="Não consegui buscar os contatos" description="Tente de novo em instantes." onRetry={() => setTentativa((n) => n + 1)} />
      ) : !lista ? (
        <SkeletonRows rows={5} />
      ) : comTelefone.length === 0 ? (
        <EmptyState icon="contacts" title="Nenhum contato com telefone" description={busca ? 'Tente outro nome ou número.' : 'Cadastre o telefone no perfil do contato para iniciar pelo WhatsApp.'} />
      ) : (
        <ul className="max-h-80 overflow-y-auto scrollbar-thin" aria-label="Contatos">
          {comTelefone.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!!abrindo}
                onClick={() => void iniciar(c)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--fill-4)] disabled:opacity-60"
              >
                <AvatarContato nome={c.nome} contatoId={c.id} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{c.nome}</span>
                  <span className="block truncate text-xs text-muted tabular">{c.telefone}</span>
                </span>
                {abrindo === c.id ? <span className="text-xs text-muted">Abrindo…</span> : <Icon name="whatsapp" size={16} className="text-[var(--ch-whatsapp)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
