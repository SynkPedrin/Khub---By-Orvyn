'use client';

import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';
import { Icon } from '@/components/icons';
import { useEditor } from './contexto';

/**
 * Aresta do fluxo com o botão "+" no meio (Q3.3): clicar abre o "Adicionar"
 * e o passo escolhido entra ENTRE os dois nós, com as pontas religadas
 * (inclusive dentro de um ramo). Some no modo leitura (versão antiga).
 */
export const ArestaInserir = memo(function ArestaInserir({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected,
}: EdgeProps) {
  const { somenteLeitura, inserirNaAresta } = useEditor();
  const [caminho, x, y] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14 });

  return (
    <>
      <BaseEdge
        id={id}
        path={caminho}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 2.6 : 2, stroke: selected ? 'var(--brand)' : undefined }}
      />
      {/* Fluxo animado por cima da linha: tracejado correndo + pulso de luz
          viajando da saída para a entrada (globals.css › Editor de automações). */}
      <path d={caminho} className="aresta-fluxo" fill="none" aria-hidden />
      <circle r={3.2} className="aresta-pulso" style={{ offsetPath: `path('${caminho}')` }} aria-hidden />
      {!somenteLeitura && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, pointerEvents: 'all' }}
          >
            <button
              type="button"
              aria-label="Inserir passo aqui"
              title="Inserir passo aqui"
              onClick={(e) => {
                e.stopPropagation();
                inserirNaAresta(id);
              }}
              className="grid h-6 w-6 place-items-center rounded-full border border-brand-border bg-surface text-brand shadow-sm transition-transform duration-fast hover:scale-110 hover:bg-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
