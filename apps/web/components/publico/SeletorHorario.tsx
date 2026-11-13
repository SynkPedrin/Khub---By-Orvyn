'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { chamarPublico, type ErroChamada } from '@/lib/publico/tipos';

export interface Horario {
  inicio: string;
  fim: string;
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function somarDias(data: string, n: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function diaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}
function mesDe(data: string): string {
  return data.slice(0, 7);
}
function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const nomeMes = (mes: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T12:00:00Z`));
const dataLonga = (data: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${data}T12:00:00Z`));

/** "14:30" no fuso da página (não no do visitante). */
export function horaNoFuso(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso }).format(new Date(iso));
}
/** "sexta-feira, 20 de novembro às 14:30" no fuso da página. */
export function quandoNoFuso(iso: string, fuso: string): string {
  const d = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuso }).format(new Date(iso));
  return `${d} às ${horaNoFuso(iso, fuso)}`;
}
/** Nome amigável do fuso ("horário de Brasília" para São Paulo). */
export function nomeFuso(fuso: string): string {
  if (fuso === 'America/Sao_Paulo') return 'horário de Brasília';
  return fuso.replace(/_/g, ' ');
}

/**
 * Calendário mensal + horários do dia, ambos da API pública (horários reais,
 * já sem o que está ocupado). Teclado: setas movem entre os dias do mês,
 * Enter/Espaço escolhe. Dias sem horário ficam desabilitados.
 */
export function SeletorHorario({
  slug,
  dias,
  janela,
  fuso,
  selecionado,
  onEscolher,
  recarregar = 0,
}: {
  slug: string;
  dias: { data: string; horarios: number }[];
  janela: { primeiro: string; ultimo: string };
  fuso: string;
  selecionado: Horario | null;
  onEscolher: (h: Horario) => void;
  /** Mudar este número força buscar os horários do dia de novo (ex.: depois de um 409). */
  recarregar?: number;
}) {
  const disponiveis = useMemo(() => new Map(dias.map((d) => [d.data, d.horarios])), [dias]);
  const [mes, setMes] = useState(() => mesDe(dias[0]?.data ?? janela.primeiro));
  const [dia, setDia] = useState<string | null>(dias[0]?.data ?? null);
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const grade = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dia) return;
    let vivo = true;
    setHorarios(null);
    setErro(null);
    chamarPublico<{ horarios: Horario[] }>(`booking/${slug}/slots?data=${dia}`)
      .then((r) => vivo && setHorarios(r.horarios))
      .catch((e: ErroChamada) => vivo && setErro(e.status === 429 ? 'Muitas consultas seguidas. Aguarde um instante.' : 'Não foi possível carregar os horários.'));
    return () => {
      vivo = false;
    };
  }, [slug, dia, recarregar]);

  const celulas = useMemo(() => {
    const primeiro = `${mes}-01`;
    const vazio = diaSemana(primeiro);
    const lista: (string | null)[] = Array.from({ length: vazio }, () => null);
    for (let d = primeiro; mesDe(d) === mes; d = somarDias(d, 1)) lista.push(d);
    return lista;
  }, [mes]);

  const podeVoltar = mes > mesDe(janela.primeiro);
  const podeAvancar = mes < mesDe(janela.ultimo);

  const mover = (e: KeyboardEvent<HTMLButtonElement>, data: string) => {
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!passo) return;
    e.preventDefault();
    const alvo = somarDias(data, passo);
    if (mesDe(alvo) !== mes) {
      if ((passo > 0 && !podeAvancar) || (passo < 0 && !podeVoltar)) return;
      setMes(mesDe(alvo));
    }
    requestAnimationFrame(() => grade.current?.querySelector<HTMLButtonElement>(`[data-dia="${alvo}"]`)?.focus());
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_220px]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-md font-semibold capitalize text-fg" aria-live="polite">{nomeMes(mes)}</p>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Mês anterior" disabled={!podeVoltar} onClick={() => setMes(somarMes(mes, -1))}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Próximo mês" disabled={!podeAvancar} onClick={() => setMes(somarMes(mes, 1))}>
              <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" aria-hidden>
          {SEMANA.map((s) => (
            <span key={s} className="py-1 text-2xs font-semibold uppercase tracking-wide text-faint">
              {s}
            </span>
          ))}
        </div>
        <div ref={grade} className="grid grid-cols-7 gap-1" role="group" aria-label={`Dias de ${nomeMes(mes)}`}>
          {celulas.map((d, i) => {
            if (!d) return <span key={`v${i}`} />;
            const n = disponiveis.get(d) ?? 0;
            const ativo = d === dia;
            return (
              <button
                key={d}
                type="button"
                data-dia={d}
                disabled={!n}
                aria-pressed={ativo}
                aria-label={`${dataLonga(d)}${n ? `, ${n} ${n === 1 ? 'horário' : 'horários'}` : ', sem horários'}`}
                onKeyDown={(e) => mover(e, d)}
                onClick={() => setDia(d)}
                className={cx(
                  'tabular relative flex aspect-square items-center justify-center rounded-md text-sm transition-colors',
                  !n && 'cursor-not-allowed text-faint opacity-50',
                  n > 0 && !ativo && 'bg-brand-softer font-semibold text-fg hover:bg-brand-soft',
                  ativo && 'bg-brand font-semibold',
                )}
                style={ativo ? { color: 'var(--brand-on, var(--base-0))' } : undefined}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-faint">Horários em {nomeFuso(fuso)}.</p>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold capitalize text-fg">{dia ? dataLonga(dia) : 'Escolha um dia'}</p>
        {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
        {dia && !erro && horarios === null && (
          <div className="grid gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton h-10 rounded-md" />
            ))}
          </div>
        )}
        {horarios && horarios.length === 0 && <p className="text-sm text-muted">Os horários deste dia acabaram de ser preenchidos. Escolha outro dia.</p>}
        {horarios && horarios.length > 0 && (
          <ul className="grid max-h-[340px] gap-2 overflow-y-auto pr-1" aria-label="Horários disponíveis">
            {horarios.map((h) => {
              const marcado = selecionado?.inicio === h.inicio;
              return (
                <li key={h.inicio}>
                  <button
                    type="button"
                    aria-pressed={marcado}
                    onClick={() => onEscolher(h)}
                    className={cx('tabular h-10 w-full rounded-md border text-sm font-semibold transition-colors', marcado ? 'border-brand bg-brand' : 'border-line text-fg hover:border-brand')}
                    style={marcado ? { color: 'var(--brand-on, var(--base-0))' } : undefined}
                  >
                    {horaNoFuso(h.inicio, fuso)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
