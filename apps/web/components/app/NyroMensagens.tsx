'use client';

import { Icon } from '../icons';
import { Markdown } from '../Markdown';
import { ConfigRequired } from './ConfigRequired';
import { AGENTE_NOME, type Aprovacao, type PassoNyro, type StatusNyro } from '@/lib/nyro';
import { capacidadeHumana } from '../nico/Nico';
import type { Bolha } from '@/lib/use-nyro-chat';
import type { PlanoNyro } from '@/lib/nyro';

interface Props {
  status: StatusNyro | null;
  bolhas: Bolha[];
  passos: PassoNyro[];
  pensando: boolean;
  erro: string;
  sugestoes: string[];
  onSugestao: (s: string) => void;
  onDecidir: (a: Aprovacao, aprovar: boolean) => void;
  /** Texto chegando em tempo real (streaming). */
  aoVivo?: string;
  plano?: PlanoNyro | null;
}

/** Plano de trabalho da NICO: o usuário vê cada etapa andando. */
export function PlanoCard({ plano, concluido = false }: { plano: PlanoNyro; concluido?: boolean }) {
  const feitos = plano.passos.filter((p) => p.status === 'feito').length;
  return (
    <div className="mb-2 rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="flex items-center justify-between gap-2 text-[12px] font-semibold text-fg">
        <span className="truncate">{plano.objetivo}</span>
        <span className="shrink-0 font-normal text-muted">{concluido ? 'concluído' : `${feitos}/${plano.passos.length}`}</span>
      </p>
      <ul className="mt-1.5 space-y-1">
        {plano.passos.map((p, i) => (
          <li key={i} className={`flex items-start gap-1.5 text-[12px] leading-snug ${p.status === 'feito' ? 'text-muted' : 'text-fg'}`}>
            {p.status === 'feito' ? <Icon name="check" size={12} className="mt-0.5 shrink-0 text-lime-ink" /> : p.status === 'fazendo' ? <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand" /> : <span className="mt-1 h-2 w-2 shrink-0 rounded-full border border-line" />}
            <span className={p.status === 'feito' ? 'line-through decoration-muted/50' : ''}>{p.texto}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Corpo do chat da NICO — o mesmo no dock e na página cheia. */
export function NyroMensagens({ status, bolhas, passos, pensando, erro, sugestoes, onSugestao, onDecidir, aoVivo = '', plano = null }: Props) {
  // Gating: sem a chave, dizemos o que falta E o que ela faria — nunca resposta simulada.
  if (status && !status.configurada) {
    return (
      <>
        <ConfigRequired provider="anthropic" missing={status.missing} />
        <p className="pt-1 text-xs font-semibold text-fg">O que a NICO faz quando conectada:</p>
        <ul className="space-y-1">
          {status.capacidades.slice(0, 8).map((c) => {
            const h = capacidadeHumana(c);
            return (
              <li key={c.nome} className="flex items-start gap-1.5 text-[12px] leading-snug text-muted">
                <Icon name="check" size={12} className="mt-0.5 shrink-0 text-lime-ink" />
                <span>
                  <span className="font-medium text-fg">{h.nome}</span>: {h.descricao}
                  {c.precisaAprovacao && <span className="text-warning"> (pede sua confirmação)</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <>
      {bolhas.length === 0 && (
        <div>
          <p className="text-sm text-fg">O que você deseja que a NICO faça?</p>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {sugestoes.map((s) => (
              <button key={s} onClick={() => onSugestao(s)} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-left text-[13px] text-fg transition-colors hover:border-brand/50 hover:bg-brand/5">
                <Icon name="chevronRight" size={15} className="shrink-0 text-brand" />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {bolhas.map((b, i) => (
        <div key={i}>
          {b.papel === 'user' ? (
            <div className="ml-auto w-fit max-w-[85%]">
              {!!b.anexos?.length && (
                <p className="mb-1 flex flex-wrap justify-end gap-1">
                  {b.anexos.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 text-2xs text-muted">
                      <Icon name="paperclip" size={11} /> {n}
                    </span>
                  ))}
                </p>
              )}
              <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm font-medium text-[#0b0b0b]">{b.texto}</p>
            </div>
          ) : (
            <div className="max-w-[96%]">
              {b.agente && b.agente !== 'nico' && <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-brand">{AGENTE_NOME[b.agente] ?? b.agente}</p>}
              {b.plano && <PlanoCard plano={b.plano} concluido />}
              <div className="w-fit max-w-full overflow-x-auto rounded-2xl rounded-bl-md bg-surface2 px-4 py-3 text-[14.5px] leading-relaxed text-fg">
                <Markdown>{b.texto}</Markdown>
              </div>
              {b.guardrail && <p className="mt-1 text-2xs text-amber-600 dark:text-amber-400">⚠ resposta ajustada por compliance: {b.guardrail}</p>}
              {!!b.fontes?.length && <p className="mt-1 text-2xs text-muted">fontes: {[...new Set(b.fontes.map((f) => f.titulo))].join(' · ')}</p>}
              {b.aprovacoes?.map((a) => (
                <div key={a.id} className="mt-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-2.5">
                  <p className="text-[11px] font-semibold leading-snug text-amber-700 dark:text-amber-300">A NICO quer {a.resumo}</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => onDecidir(a, true)} className="btn btn-primary flex-1 !rounded-lg !px-2 !py-1 !text-[11px]">Aprovar</button>
                    <button onClick={() => onDecidir(a, false)} className="btn btn-ghost flex-1 !rounded-lg !px-2 !py-1 !text-[11px] text-muted">Agora não</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {pensando && (
        <div className="max-w-[96%]">
          {plano && <PlanoCard plano={plano} />}
          {aoVivo ? (
            <div className="w-fit max-w-full overflow-x-auto rounded-2xl rounded-bl-md bg-surface2 px-4 py-3 text-[14.5px] leading-relaxed text-fg">
              <Markdown>{aoVivo}</Markdown>
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-brand align-middle" aria-hidden />
            </div>
          ) : (
            <div className="rounded-2xl bg-surface2 px-3.5 py-2.5">
              <p className="text-xs font-semibold text-fg">NICO está trabalhando…</p>
              <div className="mt-1.5 space-y-1" aria-live="polite">
                {passos.map((p, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-[11px] text-muted">
                    <Icon name="check" size={11} className="mt-0.5 shrink-0 text-brand" /> {p.rotulo}
                  </p>
                ))}
                <p className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> pensando
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{erro}</p>}
    </>
  );
}
