'use client';

import { useId } from 'react';
import { Button, useToast } from '@/components/kit';

/** Bloco "copiar" de link/código (aba Compartilhar do formulário e da página de agendamento). */
export function CampoCodigo({ titulo, descricao, valor }: { titulo: string; descricao?: string; valor: string }) {
  const toast = useToast();
  const id = useId();
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(`${titulo}: copiado`);
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  }
  return (
    <section className="card p-4" aria-labelledby={`${id}-t`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-t`} className="text-sm font-semibold text-fg">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-xs text-muted">{descricao}</p>}
        </div>
        <Button size="sm" icon="link" onClick={() => void copiar()}>Copiar</Button>
      </div>
      <textarea readOnly aria-labelledby={`${id}-t`} value={valor} rows={valor.length > 90 ? 3 : 1} onFocus={(e) => e.currentTarget.select()} className="textarea resize-none py-2 font-mono text-xs" />
    </section>
  );
}
