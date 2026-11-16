'use client';

import { memo } from 'react';
import { Icon } from '@/components/icons';
import { useEditor } from './contexto';

/** Tipo do nó de interface (não é passo do fluxo: nunca entra no grafo salvo). */
export const TIPO_ADICIONAR_GATILHO = 'adicionarGatilho';

/**
 * "+ Adicionar gatilho" no fim da coluna de gatilhos, como no construtor
 * avançado do GHL: uma automação pode começar por várias coisas (tag
 * adicionada, contato novo, data e hora…), e cada gatilho leva ao mesmo
 * primeiro passo.
 */
export const NoAdicionarGatilho = memo(function NoAdicionarGatilho() {
  const { somenteLeitura, adicionarGatilho } = useEditor();
  if (somenteLeitura) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        adicionarGatilho();
      }}
      className="nodrag flex w-60 items-center justify-center gap-2 rounded-[18px] border border-dashed border-brand-border bg-surface px-3 py-3 text-sm font-medium text-brand transition hover:bg-brand-softer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Icon name="plus" size={15} /> Adicionar gatilho
    </button>
  );
});
