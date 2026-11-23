'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { cx } from '@/components/ui';
import type { Relatorio } from '@/lib/onboarding';
import { VazioLocal, nomeMembro } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

const FONTE: Record<Relatorio['fonte'], string> = { genna: 'Genna', manual: 'Manual', web: 'Web' };

/**
 * Inteligência e estratégia: relatórios salvos (Genna/manual/web). Achados e
 * recomendações separados; o bruto do Genna é dado não confiável, exibido só
 * para leitura humana (nunca executado).
 */
export function AbaInteligencia({ ob, membros, irParaAba }: TabProps) {
  return (
    <Section title="Relatórios de análise" info="Análises salvas no onboarding, da mais recente para a mais antiga">
      {ob.reports.length === 0 ? (
        <VazioLocal
          icone="sparkles"
          titulo="Nenhum relatório ainda"
          texto="Rode uma análise do Instagram do cliente com o Genna — o resultado vira um relatório salvo aqui."
          acao={
            <button type="button" className="btn btn-sm" onClick={() => irParaAba('genna')}>
              <Icon name="sparkles" size={14} /> Ir para o Genna
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {ob.reports.map((r) => (
            <RelatorioCard key={r.id} r={r} membros={membros} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RelatorioCard({ r, membros }: { r: Relatorio; membros: TabProps['membros'] }) {
  const [aberto, setAberto] = useState(false);
  const metricas = Object.entries(r.metricas ?? {});
  const links = r.bruto?.links ?? [];

  return (
    <li className="rounded-xl border border-line">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-left transition hover:bg-surface2">
        <span className="rounded-md bg-surface3 px-1.5 py-px text-[11px] font-medium text-muted">{FONTE[r.fonte] ?? r.fonte}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{r.perfilAnalisado ?? 'Análise'}</span>
          <span className="block text-[11.5px] text-faint">
            {r.ferramenta ? `${r.ferramenta} · ` : ''}
            <Quando data={r.createdAt} />
            {r.criadoPor ? ` · ${nomeMembro(membros, r.criadoPor)}` : ''}
          </span>
        </span>
        <Icon name="chevronDown" size={14} className={cx('shrink-0 text-faint transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          {r.achados.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Achados</p>
              <ul className="list-inside list-disc space-y-0.5 text-[13px] text-fg">
                {r.achados.map((a, i) => (
                  <li key={i}>{typeof a === 'string' ? a : JSON.stringify(a)}</li>
                ))}
              </ul>
            </div>
          )}
          {r.recomendacoes.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Recomendações</p>
              <ul className="list-inside list-disc space-y-0.5 text-[13px] text-fg">
                {r.recomendacoes.map((a, i) => (
                  <li key={i}>{typeof a === 'string' ? a : JSON.stringify(a)}</li>
                ))}
              </ul>
            </div>
          )}
          {r.limitacoes && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
              <strong>Limitações dos dados:</strong> {r.limitacoes}
            </p>
          )}
          {metricas.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Métricas</p>
              <dl className="grid gap-1.5 sm:grid-cols-2">
                {metricas.slice(0, 12).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 rounded-lg bg-surface2 px-2.5 py-1.5">
                    <dt className="truncate text-[11.5px] text-muted">{k}</dt>
                    <dd className="shrink-0 text-[12.5px] font-semibold tabular text-fg">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {r.bruto?.texto && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Resultado do Genna</p>
              <p className="whitespace-pre-wrap rounded-lg bg-surface2 px-3 py-2.5 text-[13px] text-fg">{r.bruto.texto}</p>
            </div>
          )}
          {links.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Links</p>
              <ul className="space-y-1">
                {links.map((l, i) => (
                  <li key={i}>
                    <a href={l} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-[12.5px] text-brand hover:underline">
                      <Icon name="external" size={12} /> {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!r.achados.length && !r.recomendacoes.length && !r.bruto?.texto && metricas.length === 0 && (
            <p className="text-[13px] text-faint">O relatório não trouxe conteúdo legível — só os metadados acima.</p>
          )}
        </div>
      )}
    </li>
  );
}
