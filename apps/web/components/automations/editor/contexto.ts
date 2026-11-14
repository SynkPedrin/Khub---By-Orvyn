'use client';

import { createContext, useContext } from 'react';
import type { NotaGrafo } from '@/lib/automations';

/**
 * Ações do editor que nós e arestas customizados do React Flow precisam
 * chamar ("+" na aresta, editar nota). Contexto em vez de `data`: o callback
 * não entra no snapshot do desfazer nem no autosave.
 */
export interface EditorCtx {
  somenteLeitura: boolean;
  inserirNaAresta: (arestaId: string) => void;
  mudarNota: (id: string, patch: Partial<Pick<NotaGrafo, 'texto' | 'tom'>>) => void;
  /** "+ Adicionar gatilho" da coluna de gatilhos (abre a paleta só com gatilhos). */
  adicionarGatilho: () => void;
}

const Ctx = createContext<EditorCtx>({
  somenteLeitura: true,
  inserirNaAresta: () => undefined,
  mudarNota: () => undefined,
  adicionarGatilho: () => undefined,
});

export const EditorProvider = Ctx.Provider;
export const useEditor = () => useContext(Ctx);
