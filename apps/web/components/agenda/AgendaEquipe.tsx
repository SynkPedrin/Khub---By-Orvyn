'use client';

import { useMemo } from 'react';
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { Compromisso, ProfissionalAgenda, StatusAgenda } from '@/lib/agenda';
import { hora } from '@/lib/format';
import { STATUS_LABEL } from './agenda-utils';
import { mesmoDia, posicionarDia, type Bloco } from './calendario-layout';
import { rotuloMinutos } from './resumo-dia';
import { MARCA_STATUS, paletaEquipe, procedimento, type CorEquipe } from './cores-equipe';

/** Altura de 1 hora nesta visão: maior que a da semana para o nome do cliente caber. */
const PX_HORA = 72;
const SEM_PROFISSIONAL = '__sem__';
const LARGURA_MIN = 200;
const LARGURA_POR_ATENDIMENTO = 130;

const idsProfissionais = (evs: Compromisso[]) => evs.map((e) => e.profissionalId);

export const nomeCliente = (c: Compromisso, nomes: Record<string, string | null>) =>
  c.contatoNome ?? (c.contactId ? nomes[c.contactId] ?? null : null);
export const nomeServico = (c: Compromisso) => c.servicoNome ?? c.titulo;

/**
 * Agenda do dia por profissional (salão, clínica): uma coluna por quem atende,
 * horários na lateral. Pensada para a recepção bater o olho e ver QUEM, QUE
 * HORAS, O QUÊ e COM QUEM. Só aparecem as colunas de quem tem atendimento no
 * dia (mais "Sem profissional", se houver).
 */
export function AgendaEquipe({
  corDe: corExterna,
  dia,
  eventos,
  profissionais,
  nomes,
  agora,
  onAbrir,
  onCriar,
}: {
  /** Tabela de cores compartilhada com o resumo e as outras visões. */
  corDe?: ((id: string | null | undefined) => CorEquipe) | null;
  dia: Date;
  eventos: Compromisso[];
  profissionais: ProfissionalAgenda[];
  nomes: Record<string, string | null>;
  agora: Date;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
  onCriar: (inicio: Date) => void;
}) {
  const colunas = useMemo(() => {
    const porId = new Map<string, Compromisso[]>();
    for (const e of eventos) {
      const k = e.profissionalId ?? SEM_PROFISSIONAL;
      porId.set(k, [...(porId.get(k) ?? []), e]);
    }
    const nomePorId = new Map(profissionais.map((p) => [p.id, p.nome]));
    const corDe = corExterna ?? paletaEquipe(profissionais, idsProfissionais(eventos));
    const lista = [...porId.entries()].map(([id, evs]) => {
      const blocos = posicionarDia(evs, dia);
      // Quem atende em paralelo ganha coluna mais larga: ~130px por atendimento lado a lado.
      const paralelo = blocos.reduce((m, b) => Math.max(m, b.colunas), 1);
      const ocupados = evs.reduce((t, e) => t + Math.max(0, (new Date(e.fim).getTime() - new Date(e.inicio).getTime()) / 60_000), 0);
      return {
        id,
        nome: id === SEM_PROFISSIONAL ? 'Sem profissional' : nomePorId.get(id) ?? evs[0]?.profissionalNome ?? 'Profissional',
        cor: corDe(id === SEM_PROFISSIONAL ? null : id),
        blocos,
        total: evs.length,
        ocupados: Math.round(ocupados),
        largura: Math.max(LARGURA_MIN, paralelo * LARGURA_POR_ATENDIMENTO),
      };
    });
    return lista.sort((a, b) => (a.id === SEM_PROFISSIONAL ? 1 : b.id === SEM_PROFISSIONAL ? -1 : b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR')));
  }, [eventos, profissionais, dia, corExterna]);

  // Faixa de horas: do primeiro ao último atendimento (mínimo 08h–19h).
  const [h0, h1] = useMemo(() => {
    let ini = 8 * 60;
    let fim = 19 * 60;
    for (const c of colunas) for (const b of c.blocos) {
      ini = Math.min(ini, b.topoMin);
      fim = Math.max(fim, b.topoMin + b.alturaMin);
    }
    return [Math.floor(ini / 60), Math.min(24, Math.ceil(fim / 60))];
  }, [colunas]);
  const horas = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  const altura = (h1 - h0) * PX_HORA;
  const px = (min: number) => ((min - h0 * 60) / 60) * PX_HORA;
  const ehHoje = mesmoDia(dia, agora);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();

  if (!colunas.length) {
    return (
      <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
        <Icon name="calendar" size={28} className="text-muted" />
        <p className="font-semibold text-fg">Nenhum atendimento neste dia</p>
        <p className="text-sm text-muted">Use as setas para ir ao próximo dia ou clique em Novo para marcar.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto scrollbar-thin">
        <div className="min-w-full" style={{ width: `max(100%, ${56 + colunas.reduce((t, c) => t + c.largura, 0)}px)` }}>
          {/* cabeçalho: profissionais */}
          <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
            <div className="w-14 shrink-0" />
            {colunas.map((c) => (
              <div key={c.id} className="relative flex-1 border-l border-line px-3 pb-2.5 pt-3" style={{ minWidth: c.largura }}>
                <span className={cx('absolute inset-x-0 top-0 h-[3px]', c.cor.faixa)} aria-hidden />
                <p className={cx('flex items-center gap-1.5 truncate text-sm font-bold', c.cor.texto)}>
                  <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', c.cor.faixa)} aria-hidden />
                  <span className="truncate">{c.nome}</span>
                </p>
                <p className="text-2xs text-muted">
                  {c.total === 1 ? '1 atendimento' : `${c.total} atendimentos`} · {rotuloMinutos(c.ocupados)}
                </p>
              </div>
            ))}
          </div>

          {/* grade */}
          <div className="relative flex" style={{ height: altura }}>
            <div className="w-14 shrink-0">
              {horas.map((h) => (
                <div key={h} className="relative border-t border-line/60 text-right" style={{ height: PX_HORA }}>
                  <span className="absolute -top-2 right-2 bg-surface px-0.5 text-2xs tabular-nums text-muted">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>
            {colunas.map((c) => (
              <div key={c.id} className="relative flex-1 border-l border-line" style={{ minWidth: c.largura }}>
                {horas.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Marcar às ${h}:00${c.id === SEM_PROFISSIONAL ? '' : ` com ${c.nome}`}`}
                    onClick={() => {
                      const d = new Date(dia);
                      d.setHours(h, 0, 0, 0);
                      onCriar(d);
                    }}
                    className="block w-full border-t border-line/60 hover:bg-surface2/60"
                    style={{ height: PX_HORA }}
                  />
                ))}
                {c.blocos.map((b) => (
                  <BlocoAtendimento key={b.evento.id} b={b} cor={c.cor} cliente={nomeCliente(b.evento, nomes)} topo={px(b.topoMin) + 1} onAbrir={onAbrir} />
                ))}
              </div>
            ))}
            {ehHoje && agoraMin >= h0 * 60 && agoraMin <= h1 * 60 && (
              <div className="pointer-events-none absolute left-14 right-0 z-[5] flex items-center" style={{ top: px(agoraMin) }}>
                <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                <span className="h-px flex-1 bg-red-500" />
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
      </div>
    </div>
  );
}

/**
 * Bloco do atendimento: hora e PROCEDIMENTO em negrito na primeira linha (o
 * que a profissional vai fazer), cliente embaixo. Cor = profissional; status
 * = ícone no canto e opacidade (concluído esmaece, falta fica tracejada).
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
  const alto = (b.alturaMin / 60) * PX_HORA;
  const largura = 100 / b.colunas;
  const estreito = b.colunas > 1;
  const proc = procedimento(e);
  return (
    <button
      type="button"
      onClick={(ev) => onAbrir(e.id, ev.currentTarget.getBoundingClientRect())}
      title={`${hora(e.inicio)}–${hora(e.fim)} · ${proc} · ${cliente ?? 'Sem cliente'} · ${STATUS_LABEL[e.status]}`}
      aria-label={`${hora(e.inicio)} às ${hora(e.fim)}, ${proc}, ${cliente ?? 'sem cliente'}, ${STATUS_LABEL[e.status]}`}
      className={cx('absolute flex overflow-hidden rounded-lg text-left shadow-sm ring-1 ring-black/5 transition-colors', cor.fundo, marca.bloco)}
      style={{ top: topo, height: Math.max(alto - 2, 22), left: `calc(${b.coluna * largura}% + 3px)`, width: `calc(${largura}% - 6px)` }}
    >
      <span className={cx('w-1 shrink-0', cor.faixa)} aria-hidden />
      <span className="relative min-w-0 flex-1 px-2 py-1 leading-tight text-fg">
        {marca.icone && <Icon name={marca.icone} size={12} className={cx('absolute right-1 top-1', marca.iconeCor)} aria-hidden />}
        {estreito && alto >= 48 ? (
          // Estreito (atendimentos em paralelo): empilha hora, procedimento e cliente.
          <>
            <span className="block text-2xs font-bold tabular-nums opacity-80">{hora(e.inicio)}</span>
            <span className="block truncate pr-3 text-[13px] font-bold">{proc}</span>
            <span className="block truncate text-xs text-muted">{cliente ?? 'Sem cliente'}</span>
          </>
        ) : alto >= 38 ? (
          <>
            <span className="flex items-baseline gap-1.5 pr-3">
              <span className="shrink-0 text-xs font-bold tabular-nums">{hora(e.inicio)}</span>
              <span className="truncate text-[13px] font-bold">{proc}</span>
            </span>
            <span className="block truncate text-xs text-muted">{cliente ?? 'Sem cliente'}</span>
          </>
        ) : (
          // Curto (até ~30 min): tudo numa linha, procedimento em negrito.
          <span className="flex items-baseline gap-1.5 pr-3">
            <span className="shrink-0 text-xs font-bold tabular-nums">{hora(e.inicio)}</span>
            <span className="shrink-0 text-[13px] font-bold">{proc}</span>
            <span className="truncate text-xs text-muted">· {cliente ?? 'Sem cliente'}</span>
          </span>
        )}
      </span>
    </button>
  );
}
