'use client';

import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { rotuloEvento } from '@/lib/onboarding';
import { VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/** Resumo legível dos dados de um evento (só valores escalares, sem aninhar JSON na timeline). */
function resumoDados(dados: Record<string, unknown>): string {
  const partes: string[] = [];
  for (const [k, v] of Object.entries(dados)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') partes.push(`${k}: ${v}`);
    else if (Array.isArray(v)) partes.push(`${k}: ${v.length} item(ns)`);
  }
  return partes.slice(0, 4).join(' · ');
}

/** Histórico: a linha do tempo do onboarding (auditoria funcional visível). */
export function AbaHistorico({ ob }: TabProps) {
  return (
    <Section title="Linha do tempo" info="A API guarda os 50 eventos mais recentes">
      {ob.events.length === 0 ? (
        <VazioLocal icone="history" titulo="Nenhum evento ainda" texto="Cada ação no onboarding vira um evento aqui: quem fez, quando e o quê." />
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {ob.events.map((e) => (
            <li key={e.id} className="relative">
              <span aria-hidden className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand" />
              <p className="text-[13.5px] font-medium text-fg">{rotuloEvento(e.tipo)}</p>
              <p className="text-[11.5px] text-faint">
                <Quando data={e.createdAt} /> · {e.ator === 'usuario' ? 'Equipe' : e.ator}
              </p>
              {resumoDados(e.dados) && <p className="mt-0.5 text-xs text-muted">{resumoDados(e.dados)}</p>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
