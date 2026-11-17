'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { Compromisso, ProfissionalAgenda, StatusAgenda } from '@/lib/agenda';
import { hora } from '@/lib/format';
import { STATUS_LABEL, chaveDia } from './agenda-utils';
import { mesmoDia, posicionarDia, type Bloco } from './calendario-layout';
import { rotuloMinutos } from './resumo-dia';
import { MARCA_STATUS, paletaEquipe, procedimento, type CorEquipe } from './cores-equipe';

/** Grade de 10 em 10 minutos (como o Avec): cada faixa tem altura para uma linha de texto. */
const SLOT_MIN = 10;
const SLOT_PX = 22;
const PX_HORA = (60 / SLOT_MIN) * SLOT_PX;
const COL_HORAS = 60;
const LARGURA_MIN = 132;
const SEM_PROFISSIONAL = '__sem__';
/** Faixa padrão do dia; estica se houver atendimento fora dela. */
const INICIO_PADRAO = 7 * 60;
const FIM_PADRAO = 21 * 60;

export const COLUNAS_OPCOES = [3, 5, 8, 10, 12] as const;

export const nomeCliente = (c: Compromisso, nomes: Record<string, string | null>) =>
  c.contatoNome ?? (c.contactId ? nomes[c.contactId] ?? null : null);
export const nomeServico = (c: Compromisso) => c.servicoNome ?? c.titulo;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Agenda do dia por profissional (salão, clínica), no molde do Avec: uma coluna
 * fixa por profissional selecionada no painel (mesmo sem atendimento, para a
 * recepção ver quem está livre), régua de 10 em 10 minutos e linha do agora.
 * `colunas` diz quantas profissionais cabem na tela; o resto rola para o lado.
 */
export function AgendaEquipe({
  corDe: corExterna,
  dia,
  eventos,
  profissionais,
  nomes,
  agora,
  colunas: porTela,
  onAbrir,
  onCriar,
}: {
  /** Tabela de cores compartilhada com o resumo e as outras visões. */
  corDe?: ((id: string | null | undefined) => CorEquipe) | null;
  dia: Date;
  eventos: Compromisso[];
  /** Profissionais selecionadas no painel, na ordem do catálogo. */
  profissionais: ProfissionalAgenda[];
  nomes: Record<string, string | null>;
  agora: Date;
  colunas: number;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
  onCriar: (inicio: Date, profissionalId: string | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colunas = useMemo(() => {
    const porId = new Map<string, Compromisso[]>();
    for (const e of eventos) {
      const k = e.profissionalId ?? SEM_PROFISSIONAL;
      porId.set(k, [...(porId.get(k) ?? []), e]);
    }
    const corDe = corExterna ?? paletaEquipe(profissionais, eventos.map((e) => e.profissionalId));
    const monta = (id: string, nome: string) => {
      const evs = porId.get(id) ?? [];
      const ocupados = evs.reduce((t, e) => t + Math.max(0, (new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 60_000), 0);
      return { id, nome, cor: corDe(id === SEM_PROFISSIONAL ? null : id), blocos: posicionarDia(evs, dia), total: evs.length, ocupados: Math.round(ocupados) };
    };
    const lista = profissionais.map((p) => monta(p.id, p.nome));
    if (porId.has(SEM_PROFISSIONAL)) lista.push(monta(SEM_PROFISSIONAL, 'Sem profissional'));
    return lista;
  }, [eventos, profissionais, dia, corExterna]);

  const [ini, fim] = useMemo(() => {
    let a = INICIO_PADRAO;
    let b = FIM_PADRAO;
    for (const c of colunas) for (const bl of c.blocos) {
      a = Math.min(a, bl.topoMin);
      b = Math.max(b, bl.topoMin + bl.alturaMin);
    }
    return [Math.floor(a / 60) * 60, Math.min(24 * 60, Math.ceil(b / 60) * 60)];
  }, [colunas]);

  const slots = Array.from({ length: (fim - ini) / SLOT_MIN }, (_, i) => ini + i * SLOT_MIN);
  const altura = slots.length * SLOT_PX;
  const px = (min: number) => ((min - ini) / SLOT_MIN) * SLOT_PX;
  const ehHoje = mesmoDia(dia, agora);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const mostrarAgora = ehHoje && agoraMin >= ini && agoraMin <= fim;
  const larguraCol = Math.max(LARGURA_MIN, Math.floor((largura - COL_HORAS) / Math.max(1, Math.min(porTela, colunas.length || 1))));

  // Abre rolado perto de agora (hoje) ou do começo do expediente.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const alvo = ehHoje ? Math.max(ini, agoraMin - 120) : Math.max(ini, 8 * 60);
    el.scrollTop = px(alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDia(dia), ini]);

  // Linhas: 10 min fracas, hora cheia forte, e faixas alternadas por hora (leitura do Avec).
  const fundoGrade = {
    backgroundImage: [
      `linear-gradient(to bottom, var(--border-strong) 1px, transparent 1px)`,
      `linear-gradient(to bottom, var(--border) 1px, transparent 1px)`,
      `linear-gradient(to bottom, transparent 50%, var(--fill-4) 50%)`,
    ].join(','),
    backgroundSize: `100% ${PX_HORA}px, 100% ${SLOT_PX}px, 100% ${PX_HORA * 2}px`,
  };

  if (!colunas.length) {
    return (
      <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
        <Icon name="users" size={28} className="text-muted" />
        <p className="font-semibold text-fg">Nenhuma profissional selecionada</p>
        <p className="text-sm text-muted">Marque quem você quer ver no painel de profissionais.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div ref={scroller} className="max-h-[calc(100dvh-220px)] min-h-[420px] overflow-auto scrollbar-thin">
        <div style={{ width: COL_HORAS + larguraCol * colunas.length }}>
          {/* Cabeçalho: profissionais (fixo no topo ao rolar). */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: COL_HORAS }} />
            {colunas.map((c) => (
              <div key={c.id} className="relative flex shrink-0 flex-col items-center gap-1 border-l border-line px-2 pb-2 pt-2.5 text-center" style={{ width: larguraCol }}>
                <span className={cx('absolute inset-x-0 top-0 h-[3px]', c.cor.faixa)} aria-hidden />
                <span className={cx('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white', c.cor.faixa)} aria-hidden>
                  {c.id === SEM_PROFISSIONAL ? <Icon name="user" size={15} /> : c.nome.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('')}
                </span>
                <p className={cx('w-full truncate text-[13px] font-bold', c.cor.texto)} title={c.nome}>
                  {c.nome}
                </p>
                <p className="w-full truncate text-2xs text-muted">
                  {c.total ? `${c.total === 1 ? '1 atend.' : `${c.total} atend.`} · ${rotuloMinutos(c.ocupados)}` : 'Livre'}
                </p>
              </div>
            ))}
          </div>

          {/* Grade */}
          <div className="relative flex" style={{ height: altura }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface" style={{ width: COL_HORAS }} aria-hidden>
              {slots.map((m) => (
                <div key={m} className={cx('flex items-start justify-end pr-2 pt-0.5 tabular-nums', m % 60 === 0 ? 'text-xs font-bold text-fg' : 'text-2xs text-muted')} style={{ height: SLOT_PX }}>
                  {hhmm(m)}
                </div>
              ))}
              {mostrarAgora && (
                <span className="absolute right-1 z-[6] -translate-y-1/2 rounded bg-red-500 px-1 text-2xs font-bold tabular-nums text-white" style={{ top: px(agoraMin) }}>
                  {hhmm(agoraMin)}
                </span>
              )}
            </div>
            {colunas.map((c) => (
              <div
                key={c.id}
                className="relative shrink-0 cursor-cell border-l border-line"
                style={{ width: larguraCol, ...fundoGrade }}
                title={c.id === SEM_PROFISSIONAL ? 'Clique num horário vazio para marcar' : `Clique num horário vazio para marcar com ${c.nome}`}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const min = ini + Math.floor(y / SLOT_PX) * SLOT_MIN;
                  const d = new Date(dia);
                  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
                  onCriar(d, c.id === SEM_PROFISSIONAL ? null : c.id);
                }}
              >
                {c.blocos.map((b) => (
                  <BlocoAtendimento key={b.evento.id} b={b} cor={c.cor} cliente={nomeCliente(b.evento, nomes)} topo={px(b.topoMin) + 1} onAbrir={onAbrir} />
                ))}
              </div>
            ))}
            {mostrarAgora && (
              <div className="pointer-events-none absolute right-0 z-[5] flex items-center" style={{ top: px(agoraMin), left: COL_HORAS }} aria-hidden>
                <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                <span className="h-0.5 flex-1 bg-red-500" />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-2xs text-muted">
        <span className="font-semibold text-fg">Cor = profissional</span>
        {(['confirmado', 'concluido', 'faltou', 'cancelado'] as StatusAgenda[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <Icon name={MARCA_STATUS[s].icone ?? 'check'} size={11} className={MARCA_STATUS[s].iconeCor} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="ml-auto">Clique num horário vazio da coluna para marcar com a profissional.</span>
      </div>
    </div>
  );
}

/**
 * Bloco do atendimento: hora e cliente na primeira linha (como o Avec), o
 * PROCEDIMENTO em negrito embaixo. Cor = profissional; status = ícone no
 * canto e opacidade (concluído esmaece, falta fica tracejada).
 */
function BlocoAtendimento({
  b,
  cor,
  cliente,
  topo,
  onAbrir,
}: {
  b: Bloco<Compromisso>;
  cor: CorEquipe;
  cliente: string | null;
  topo: number;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
}) {
  const e = b.evento;
  const marca = MARCA_STATUS[e.status];
  const alto = (b.alturaMin / SLOT_MIN) * SLOT_PX;
  const largura = 100 / b.colunas;
  const proc = procedimento(e);
  return (
    <button
      type="button"
      onClick={(ev) => onAbrir(e.id, ev.currentTarget.getBoundingClientRect())}
      title={`${hora(e.inicio)}–${hora(e.fim)} · ${cliente ?? 'Sem cliente'} · ${proc} · ${STATUS_LABEL[e.status]}`}
      aria-label={`${hora(e.inicio)} às ${hora(e.fim)}, ${cliente ?? 'sem cliente'}, ${proc}, ${STATUS_LABEL[e.status]}`}
      className={cx('group absolute z-[1] flex isolate overflow-hidden rounded-md text-left shadow-sm ring-1 ring-black/5', marca.bloco)}
      style={{ top: topo, height: Math.max(alto - 2, SLOT_PX - 2), left: `calc(${b.coluna * largura}% + 2px)`, width: `calc(${largura}% - 4px)` }}
    >
      {/* Base opaca: a cor translúcida da profissional não deixa a régua vazar pelo bloco. */}
      <span className="absolute inset-0 -z-10 bg-surface" aria-hidden />
      <span className={cx('absolute inset-0 -z-10 transition-colors', cor.fundo)} aria-hidden />
      <span className={cx('w-1 shrink-0', cor.faixa)} aria-hidden />
      <span className="relative min-w-0 flex-1 px-1.5 py-0.5 leading-tight text-fg">
        {marca.icone && <Icon name={marca.icone} size={11} className={cx('absolute right-1 top-1', marca.iconeCor)} aria-hidden />}
        <span className="flex items-baseline gap-1 pr-3">
          <span className="shrink-0 text-2xs font-bold tabular-nums">{hora(e.inicio)}</span>
          <span className="truncate text-xs">{cliente ?? 'Sem cliente'}</span>
        </span>
        {alto >= 34 && <span className="block truncate text-xs font-bold">{proc}</span>}
      </span>
    </button>
  );
}
