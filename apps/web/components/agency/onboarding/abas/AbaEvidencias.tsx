'use client';

import { useMemo } from 'react';
import { Section } from '@/components/revenue/Page';
import { evidenciasAgregadas } from '@/lib/onboarding';
import { VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/**
 * Arquivos e evidências: agregação somente-leitura do que foi registrado nas
 * verificações e nas tarefas vinculadas, com origem e referência.
 */
export function AbaEvidencias({ ob }: TabProps) {
  const evidencias = useMemo(() => evidenciasAgregadas(ob), [ob]);

  return (
    <Section title="Evidências registradas" info="Tudo que foi anexado ao verificar itens do checklist ou concluir tarefas">
      {evidencias.length === 0 ? (
        <VazioLocal
          icone="paperclip"
          titulo="Nenhuma evidência ainda"
          texto="Ao marcar uma verificação como verificada, a evidência (ou a confirmação explícita sem evidência) aparece aqui."
        />
      ) : (
        <ul className="divide-y divide-line">
          {evidencias.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="rounded-md bg-surface3 px-1.5 py-px text-[11px] font-medium text-muted">
                {e.origem === 'verificacao' ? 'Verificação' : 'Tarefa'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-fg">{e.evidencia.referencia || e.evidencia.tipo || 'Evidência'}</span>
                <span className="block text-[11.5px] text-faint">
                  {e.origemRotulo}
                  {e.secao ? ` · ${e.secao.replace(/_/g, ' ')}` : ''}
                  {e.evidencia.observacao ? ` · ${e.evidencia.observacao}` : ''}
                </span>
              </span>
              {e.evidencia.referencia?.startsWith('http') && (
                <a href={e.evidencia.referencia} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-brand hover:underline">
                  Abrir
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
