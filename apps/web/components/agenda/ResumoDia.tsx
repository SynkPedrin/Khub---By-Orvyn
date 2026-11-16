'use client';

import { useMemo } from 'react';
import { cx } from '@/components/ui';
import type { Compromisso, ProfissionalAgenda, StatusAgenda } from '@/lib/agenda';
import { STATUS_LABEL } from './agenda-utils';
import { resumoDoDia, rotuloHoraMin, rotuloMinutos, trilhasDoDia, TRILHA_FIM_MIN, TRILHA_INICIO_MIN } from './resumo-dia';

/** Cor do bloco por status (mesma leitura da grade da Equipe). */
const BARRA: Record<StatusAgenda, string> = {
  agendado: 'bg-sky-500',
  confirmado: 'bg-emerald-500',
  concluido: 'bg-zinc-400',
  faltou: 'bg-amber-500',
  cancelado: 'bg-red-400',
};

const JANELA = TRILHA_FIM_MIN - TRILHA_INICIO_MIN;
const pct = (min: number) => ((min - TRILHA_INICIO_MIN) / JANELA) * 100;

/**
 * Mapa do dia para a recepção: uma linha por profissional com os atendimentos
 * como blocos na régua de 06h às 22h. Em 2 segundos dá para ver quem está
 * cheio, quem tem buraco e como o dia anda — mesmo com dezenas de horários.
 */
export function ResumoDia({ eventos, profissionais, agora, ehHoje }: { eventos: Compromisso[]; profissionais: ProfissionalAgenda[]; agora: Date; ehHoje: boolean }) {
  const resumo = useMemo(() => resumoDoDia(eventos), [eventos]);
  const trilhas = useMemo(() => trilhasDoDia(eventos, profissionais), [eventos, profissionais]);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const mostrarAgora = ehHoje && agoraMin >= TRILHA_INICIO_MIN && agoraMin <= TRILHA_FIM_MIN;

  if (!eventos.length) return null;

  return (
    <section className="card space-y-3 p-4" aria-label="Resumo do dia">
      {/* KPIs do dia */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <p className="text-sm font-bold text-fg">
          {resumo.total === 1 ? '1 atendimento' : `${resumo.total} atendimentos`}
          <span className="font-normal text-muted"> · {resumo.profissionaisAtivas === 1 ? '1 profissional' : `${resumo.profissionaisAtivas} profissionais`}</span>
        </p>
        {resumo.primeiraHoraMin !== null && (
          <p className="text-sm text-muted">
            das <span className="font-semibold tabular text-fg">{rotuloHoraMin(resumo.primeiraHoraMin)}</span> às{' '}
            <span className="font-semibold tabular text-fg">{rotuloHoraMin(resumo.ultimaHoraMin ?? resumo.primeiraHoraMin)}</span>
          </p>
        )}
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg">{rotuloMinutos(resumo.minutosOcupados)}</span> de atendimento
        </p>
        <div className="ml-auto flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(BARRA) as StatusAgenda[])
            .filter((s) => resumo.porStatus[s])
            .map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-2xs text-muted">
                <span className={cx('h-2.5 w-2.5 rounded-full', BARRA[s])} aria-hidden />
                {STATUS_LABEL[s]} {resumo.porStatus[s]}
              </span>
            ))}
        </div>
      </div>

      {/* Trilhas por profissional */}
      <div className="space-y-1">
        {trilhas.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <p className="w-28 shrink-0 truncate text-xs font-semibold text-fg" title={t.nome}>
              {t.nome}
            </p>
            <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-md bg-surface2" role="img" aria-label={`${t.nome}: ${t.total} atendimentos, ${rotuloMinutos(t.minutosOcupados)} ocupados`}>
              {t.blocos.map((b) => (
                <span
                  key={b.id}
                  title={`${rotuloHoraMin(b.inicioMin)}–${rotuloHoraMin(b.fimMin)} · ${b.titulo} · ${STATUS_LABEL[b.status]}`}
                  className={cx('absolute top-0.5 h-4 rounded-sm', BARRA[b.status])}
                  style={{ left: `${pct(b.inicioMin)}%`, width: `max(${pct(b.fimMin) - pct(b.inicioMin)}%, 3px)` }}
                />
              ))}
              {mostrarAgora && <span className="absolute top-0 h-full w-0.5 bg-red-500" style={{ left: `${pct(agoraMin)}%` }} aria-hidden />}
            </div>
            <p className="w-20 shrink-0 text-right text-2xs tabular text-muted">
              {t.total} · {rotuloMinutos(t.minutosOcupados)}
            </p>
          </div>
        ))}
        {/* régua de horas */}
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0" />
          <div className="relative h-3 min-w-0 flex-1 text-2xs tabular text-faint">
            {[6, 9, 12, 15, 18, 21].map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${pct(h * 60)}%` }}>
                {h}h
              </span>
            ))}
          </div>
          <span className="w-20 shrink-0" />
        </div>
      </div>
    </section>
  );
}
