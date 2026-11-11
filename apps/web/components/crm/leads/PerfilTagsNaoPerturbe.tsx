'use client';

import { useEffect, useState } from 'react';
import { Switch, useToast } from '@/components/kit';
import { crm } from '@/lib/crm';
import { TagsEditor, useCatalogoTags } from './TagsEditor';

/**
 * Perfil do contato (Q2.2): tags múltiplas (`tags[]`) e "não perturbe".
 * Salva na hora (sem botão): cada mudança é um PATCH com toast.
 */
export function PerfilTagsNaoPerturbe({ id, tags, optedOutAt, onMudou }: { id: string; tags: string[]; optedOutAt: string | null; onMudou: () => void | Promise<void> }) {
  const catalogo = useCatalogoTags();
  const toast = useToast();
  const [lista, setLista] = useState(tags);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setLista(tags), [tags]);

  const salvarTags = async (novas: string[]) => {
    const antes = lista;
    setLista(novas);
    setSalvando(true);
    try {
      await crm.updateContact(id, { tags: novas });
      await onMudou();
    } catch {
      setLista(antes);
      toast.error('Não foi possível salvar as tags.');
    } finally {
      setSalvando(false);
    }
  };

  const alternarNaoPerturbe = async (ativo: boolean) => {
    setSalvando(true);
    try {
      await crm.updateContact(id, { naoPerturbe: ativo });
      await onMudou();
      toast.success(ativo ? 'Não perturbe ativado.' : 'Não perturbe desativado.', {
        description: ativo ? 'Automações e agentes de IA deixam de enviar mensagens para este contato.' : undefined,
      });
    } catch {
      toast.error('Não foi possível alterar o não perturbe.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Tags</p>
        <TagsEditor value={lista} onChange={salvarTags} catalogo={catalogo} disabled={salvando} ariaLabel="Tags do contato" />
      </div>
      <div className="sm:pt-6">
        <Switch
          checked={!!optedOutAt}
          onChange={alternarNaoPerturbe}
          disabled={salvando}
          label="Não perturbe"
          description={optedOutAt ? `Desde ${new Date(optedOutAt).toLocaleDateString('pt-BR')}` : 'Recebe mensagens normalmente'}
        />
      </div>
    </div>
  );
}
