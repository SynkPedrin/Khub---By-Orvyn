'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { NodeProps } from 'reactflow';
import { cx } from '@/components/ui';
import type { NotaGrafo } from '@/lib/automations';
import { useEditor } from './contexto';

export interface DadosNota {
  texto: string;
  tom?: NotaGrafo['tom'];
}

const TOM: Record<NonNullable<NotaGrafo['tom']>, { caixa: string; ponto: string; rotulo: string }> = {
  neutro: { caixa: 'border-line bg-surface2', ponto: 'bg-surface3', rotulo: 'Neutra' },
  marca: { caixa: 'border-brand-border bg-brand-soft', ponto: 'bg-brand', rotulo: 'Destaque' },
  aviso: { caixa: 'border-warning-border bg-warning-soft', ponto: 'bg-warning', rotulo: 'Atenção' },
};

/**
 * Nota de texto no canvas (Q3.3). Não tem entrada nem saída: o motor nunca a
 * executa (ela é salva em `grafo.notas`, fora de `nos`). Duplo clique edita.
 */
export const NoNota = memo(function NoNota({ id, data, selected }: NodeProps<DadosNota>) {
  const { somenteLeitura, mudarNota } = useEditor();
  const [editando, setEditando] = useState(!data.texto && !somenteLeitura);
  const campo = useRef<HTMLTextAreaElement>(null);
  const tom = TOM[data.tom ?? 'neutro'];

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  return (
    <div
      className={cx('w-56 rounded-xl border p-3 shadow-sm transition-shadow', tom.caixa, selected && 'ring-2 ring-brand')}
      onDoubleClick={() => !somenteLeitura && setEditando(true)}
    >
      {editando && !somenteLeitura ? (
        <textarea
          ref={campo}
          value={data.texto}
          onChange={(e) => mudarNota(id, { texto: e.target.value.slice(0, 2000) })}
          onBlur={() => setEditando(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditando(false);
          }}
          rows={4}
          placeholder="Escreva uma nota para a equipe…"
          aria-label="Texto da nota"
          className="nodrag nowheel w-full resize-none bg-transparent text-sm leading-snug text-fg outline-none placeholder:text-muted"
        />
      ) : (
        <p className={cx('whitespace-pre-wrap break-words text-sm leading-snug', data.texto ? 'text-fg' : 'text-muted')}>
          {data.texto || 'Nota vazia. Clique duas vezes para escrever.'}
        </p>
      )}
      {selected && !somenteLeitura && (
        <div className="nodrag mt-2 flex items-center gap-1.5 border-t border-line pt-2" role="group" aria-label="Cor da nota">
          {(Object.keys(TOM) as (keyof typeof TOM)[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-label={TOM[t].rotulo}
              aria-pressed={(data.tom ?? 'neutro') === t}
              title={TOM[t].rotulo}
              onClick={() => mudarNota(id, { tom: t })}
              className={cx('h-4 w-4 rounded-full border border-line', TOM[t].ponto, (data.tom ?? 'neutro') === t && 'ring-2 ring-brand ring-offset-1')}
            />
          ))}
          <span className="ml-auto text-2xs text-muted">não executa</span>
        </div>
      )}
    </div>
  );
});
