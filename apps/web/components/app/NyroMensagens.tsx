'use client';

import { Icon } from '../icons';
import { ConfigRequired } from './ConfigRequired';
import { AGENTE_NOME, type Aprovacao, type PassoNyro, type StatusNyro } from '@/lib/nyro';
import { capacidadeHumana } from '../nico/Nico';
import type { Bolha } from '@/lib/use-nyro-chat';

interface Props {
  status: StatusNyro | null;
  bolhas: Bolha[];
  passos: PassoNyro[];
  pensando: boolean;
  erro: string;
  sugestoes: string[];
  onSugestao: (s: string) => void;
  onDecidir: (a: Aprovacao, aprovar: boolean) => void;
}

/** Corpo do chat da NICO — o mesmo no dock e na página cheia. */
export function NyroMensagens({ status, bolhas, passos, pensando, erro, sugestoes, onSugestao, onDecidir }: Props) {
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
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-white">{b.texto}</p>
          ) : (
            <div className="max-w-[92%]">
              {b.agente && <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-brand">{AGENTE_NOME[b.agente] ?? b.agente}</p>}
              <p className="w-fit whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface2 px-3.5 py-2 text-sm text-fg">{b.texto}</p>
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
        <div className="rounded-2xl bg-surface2 px-3.5 py-2.5">
          <p className="text-xs font-semibold text-fg">NICO está trabalhando…</p>
          <div className="mt-1.5 space-y-1">
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
      {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{erro}</p>}
    </>
  );
}
