'use client';

import { useId, useMemo, useState } from 'react';
import { cx } from '../ui';
import { moeda, moedaCurta, numero } from '@/lib/format';

/**
 * GRÁFICOS DO KHUB
 * ======================
 *
 * SVG inline, sem biblioteca: os formatos aqui são poucos e fixos, e uma
 * dependência de charting custaria mais bytes do que estes arquivos inteiros.
 *
 * PALETA — validada com o verificador de contraste/daltonismo, nos dois modos.
 * Não trocar estes valores "no olho": a paleta anterior (pastéis) reprovava na
 * banda de luminosidade e no contraste mínimo de 3:1.
 *
 *   light: #6c2bff · #b45309 · #0284c7 · #047857   (todos os checks PASS)
 *   dark:  #8b5cf6 · #d97706 · #0284c7 · #0fa97b   (todos os checks PASS)
 *
 * Regras seguidas: um eixo só (nunca dois `y`); cor segue a entidade, não a
 * posição; séries ≥ 2 sempre com legenda + rótulo direto; grade recessiva;
 * texto em tokens de tinta, nunca na cor da série.
 */

/** Ordem categórica fixa. Nunca cicla: a 5ª série vira "Outros" ou facet. */
export const SERIE_CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'] as const;

/* ------------------------------------------------------------------ */
/* Área — evolução de receita                                          */
/* ------------------------------------------------------------------ */

export function AreaReceita({
  dados,
  altura = 200,
  formatar = moedaCurta,
}: {
  dados: { rotulo: string; valor: number }[];
  altura?: number;
  formatar?: (n: number) => string;
}) {
  const id = useId();
  const [ativo, setAtivo] = useState<number | null>(null);

  const { pontos, area, max, ticks } = useMemo(() => {
    if (!dados.length) return { pontos: '', area: '', max: 0, ticks: [] as number[] };
    const maxValor = Math.max(...dados.map((d) => d.valor));
    // Teto "redondo" proporcional ao maior valor (1, 2, 2,5, 5 ou 10 × 10^n).
    // Antes arredondava sempre para múltiplos de R$ 100 mil: com vendas de
    // poucos mil reais a curva ficava rente ao chão.
    const teto = (() => {
      if (maxValor <= 0) return 1;
      const base = 10 ** Math.floor(Math.log10(maxValor));
      const passo = [1, 2, 2.5, 5, 10].find((m) => m * base >= maxValor * 1.08) ?? 10;
      return passo * base;
    })();
    const passoX = 100 / Math.max(1, dados.length - 1);
    const coords = dados.map((d, i) => [i * passoX, 100 - (d.valor / teto) * 100] as const);
    return {
      pontos: coords.map(([x, y]) => `${x},${y}`).join(' '),
      area: `0,100 ${coords.map(([x, y]) => `${x},${y}`).join(' ')} 100,100`,
      max: teto,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => teto * f),
    };
  }, [dados]);

  if (!dados.length) return <SemDados altura={altura} />;

  const idx = Math.min(ativo ?? dados.length - 1, dados.length - 1);
  const ponto = dados[idx];
  const xPct = (idx / Math.max(1, dados.length - 1)) * 100;

  return (
    <figure className="m-0">
      <div className="flex gap-3">
        {/* Eixo Y — recessivo, tabular para alinhar os dígitos */}
        <div
          className="flex shrink-0 flex-col-reverse justify-between py-0.5 text-2xs tabular text-faint"
          style={{ height: altura }}
          aria-hidden
        >
          {ticks.map((t, i) => (
            <span key={i}>{t === 0 ? '0' : formatar(t)}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ height: altura }}
            className="w-full overflow-visible"
            role="img"
            aria-label={`Evolução de receita: ${dados.length} pontos, de ${formatar(dados[0].valor)} a ${formatar(dados[dados.length - 1].valor)}`}
          >
            <defs>
              <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.26" />
                <stop offset="55%" stopColor="var(--brand-2)" stopOpacity="0.09" />
                <stop offset="100%" stopColor="var(--brand-2)" stopOpacity="0" />
              </linearGradient>
              <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="var(--brand)" floodOpacity="0.4" />
              </filter>
            </defs>

            {/* Grade: fina e apagada — referência, não protagonista */}
            {[0, 25, 50, 75, 100].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="var(--border)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
            ))}

            <polygon points={area} fill={`url(#g-${id})`} />
            <polyline
              points={pontos}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              filter={`url(#glow-${id})`}
            />

            {/* Crosshair do ponto em foco. Linha vertical sobrevive ao
                `preserveAspectRatio="none"`; um <circle> aqui NÃO — viraria
                elipse esticada. O marcador vai no overlay HTML abaixo. */}
            <line
              x1={xPct}
              y1="0"
              x2={xPct}
              y2="100"
              stroke="var(--brand)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.35"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Marcador do ponto: div em overlay, imune à distorção do viewBox. */}
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-[var(--base-0)] shadow-sm"
            style={{ left: `${xPct}%`, top: `${(1 - ponto.valor / max) * altura}px` }}
            aria-hidden
          />

          {/* Camada de hover: alvos maiores que as marcas */}
          <div className="absolute inset-0 flex" onMouseLeave={() => setAtivo(null)}>
            {dados.map((d, i) => (
              <button
                key={i}
                type="button"
                className="h-full flex-1 cursor-default"
                onMouseEnter={() => setAtivo(i)}
                onFocus={() => setAtivo(i)}
                onClick={() => setAtivo(i)}
                aria-label={`${d.rotulo}: ${formatar(d.valor)}`}
              />
            ))}
          </div>

          {/* Tooltip */}
          <div
            className="pointer-events-none absolute -top-1 z-sticky -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-md"
            style={{ left: `${Math.min(92, Math.max(8, xPct))}%` }}
          >
            <p className="text-[13px] font-semibold tabular text-fg">{formatar(ponto.valor)}</p>
            <p className="text-[11px] text-muted">{ponto.rotulo}</p>
          </div>

          {/* Eixo X: só extremos e marcos — nunca um rótulo por ponto */}
          <div className="mt-2 flex justify-between text-2xs text-faint" aria-hidden>
            {[0, Math.floor(dados.length / 4), Math.floor(dados.length / 2), Math.floor((dados.length * 3) / 4), dados.length - 1].map(
              (i) => (
                <span key={i}>{dados[i]?.rotulo}</span>
              ),
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Barras verticais — receita por canal (sequencial, um hue)           */
/* ------------------------------------------------------------------ */

export function BarrasVerticais({
  dados,
  altura = 190,
  formatar = moeda,
}: {
  dados: { rotulo: string; valor: number }[];
  altura?: number;
  formatar?: (n: number) => string;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  if (!dados.length) return <SemDados altura={altura} />;

  const max = Math.max(...dados.map((d) => d.valor));

  return (
    <figure className="m-0">
      <div className="flex items-end gap-2" style={{ height: altura }}>
        {dados.map((d, i) => {
          const pct = max ? (d.valor / max) * 100 : 0;
          return (
            <div
              key={d.rotulo}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setAtivo(i)}
              onMouseLeave={() => setAtivo(null)}
            >
              {/* Rótulo direto: o valor em cima da barra dispensa ler o eixo */}
              <p className="mb-1.5 truncate text-center text-[11px] font-semibold tabular text-fg">{formatar(d.valor)}</p>
              <div
                className={cx('w-full rounded-t-md transition-[opacity,box-shadow] duration-200', ativo !== null && ativo !== i && 'opacity-60')}
                style={{
                  height: `${pct}%`,
                  minHeight: 3,
                  // Sequencial: um hue, intensidade acompanha a magnitude; o
                  // degradê vertical (mais claro no topo) só dá volume.
                  background: `linear-gradient(180deg, color-mix(in srgb, var(--brand-2) ${Math.round(38 + (pct / 100) * 62)}%, var(--brand-soft)), color-mix(in srgb, var(--brand) ${Math.round(38 + (pct / 100) * 62)}%, var(--brand-soft)))`,
                }}
                role="img"
                aria-label={`${d.rotulo}: ${formatar(d.valor)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2">
        {dados.map((d) => (
          <p key={d.rotulo} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
            {d.rotulo}
          </p>
        ))}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Barras horizontais — tempo de resposta por equipe                   */
/* ------------------------------------------------------------------ */

export function BarrasHorizontais({
  dados,
  formatar = (n: number) => `${n} min`,
  /** Valor baixo é bom (tempo de resposta) — inverte a intensidade da cor. */
  menorEhMelhor = false,
}: {
  dados: { rotulo: string; valor: number; extra?: React.ReactNode }[];
  formatar?: (n: number) => string;
  menorEhMelhor?: boolean;
}) {
  if (!dados.length) return <SemDados altura={140} />;
  const max = Math.max(...dados.map((d) => d.valor));

  return (
    <ul className="space-y-3">
      {dados.map((d) => {
        const pct = max ? (d.valor / max) * 100 : 0;
        const intensidade = menorEhMelhor ? 100 - pct : pct;
        return (
          <li key={d.rotulo} className="flex items-center gap-3">
            <div className="flex w-24 shrink-0 items-center gap-2 sm:w-36">
              {d.extra}
              <span className="truncate text-[13px] text-fg">{d.rotulo}</span>
            </div>
            <div className="h-5 min-w-0 flex-1">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct > 0 ? Math.max(1, pct) : 0}%`,
                  background: `linear-gradient(90deg, color-mix(in srgb, var(--brand) ${Math.round(30 + (intensidade / 100) * 55)}%, var(--brand-soft)), color-mix(in srgb, var(--brand-2) ${Math.round(30 + (intensidade / 100) * 55)}%, var(--brand-soft)))`,
                }}
                role="img"
                aria-label={`${d.rotulo}: ${formatar(d.valor)}`}
              />
            </div>
            <span className="min-w-12 max-w-[40%] shrink-0 break-words text-right text-[12px] font-medium tabular text-muted">{formatar(d.valor)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Funil de conversão                                                  */
/* ------------------------------------------------------------------ */

export function Funil({ etapas }: { etapas: { rotulo: string; valor: number; pct: number }[] }) {
  if (!etapas.length) return <SemDados altura={200} />;

  return (
    <div className="flex items-start gap-5">
      <div className="flex min-w-0 flex-1 flex-col items-center gap-[2px]">
        {etapas.map((e, i) => {
          // Largura proporcional ao percentual, com piso para a última faixa
          // continuar legível (um funil que termina em 2px não comunica nada).
          const largura = Math.max(26, e.pct);
          return (
            <div
              key={e.rotulo}
              className="h-9 rounded-md transition-opacity duration-200 hover:opacity-85"
              style={{
                width: `${largura}%`,
                background: `linear-gradient(90deg, color-mix(in srgb, var(--brand-2) ${Math.round(30 + (i / Math.max(1, etapas.length - 1)) * 60)}%, var(--brand-soft)), color-mix(in srgb, var(--brand) ${Math.round(30 + (i / Math.max(1, etapas.length - 1)) * 60)}%, var(--brand-soft)), color-mix(in srgb, var(--brand-2) ${Math.round(30 + (i / Math.max(1, etapas.length - 1)) * 60)}%, var(--brand-soft)))`,
              }}
              role="img"
              aria-label={`${e.rotulo}: ${numero(e.valor)} (${e.pct}%)`}
            />
          );
        })}
      </div>

      {/* Rótulos diretos ao lado: identidade nunca depende só da cor */}
      <ul className="w-[58%] shrink-0 space-y-[2px]">
        {etapas.map((e) => (
          <li key={e.rotulo} className="flex h-9 items-center gap-2.5 text-[13px]">
            <span className="w-10 shrink-0 text-right font-semibold tabular text-fg">{numero(e.valor)}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{e.rotulo}</span>
            <span className="shrink-0 font-medium tabular text-muted">{e.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rosca — leads por status (categórico, ≤ 4 séries)                   */
/* ------------------------------------------------------------------ */

export function Rosca({
  dados,
  total,
  rotuloTotal,
}: {
  dados: { rotulo: string; valor: number; pct: number }[];
  total: number;
  rotuloTotal: string;
}) {
  if (!dados.length) return <SemDados altura={180} />;

  const R = 42;
  const CIRC = 2 * Math.PI * R;
  let acumulado = 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative shrink-0">
        <svg width="150" height="150" viewBox="0 0 110 110" role="img" aria-label={`${rotuloTotal}: ${numero(total)}`}>
          <g transform="rotate(-90 55 55)">
            {dados.map((d, i) => {
              const fracao = d.pct / 100;
              // Vão de 2px entre fatias: separa as cores sem depender de borda.
              const traco = Math.max(0, CIRC * fracao - 2);
              const offset = -CIRC * acumulado;
              acumulado += fracao;
              return (
                <circle
                  key={d.rotulo}
                  cx="55"
                  cy="55"
                  r={R}
                  fill="none"
                  stroke={SERIE_CAT[i] ?? 'var(--text-3)'}
                  strokeWidth="15"
                  strokeDasharray={`${traco} ${CIRC - traco}`}
                  strokeDashoffset={offset}
                />
              );
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-bold tabular leading-none text-fg">{numero(total)}</span>
          <span className="mt-0.5 text-[11px] text-muted">{rotuloTotal}</span>
        </div>
      </div>

      {/* Legenda obrigatória para ≥ 2 séries, com valor e percentual */}
      <ul className="min-w-[170px] flex-1 space-y-2">
        {dados.map((d, i) => (
          <li key={d.rotulo} className="flex items-center gap-2.5 text-[13px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: SERIE_CAT[i] ?? 'var(--text-3)' }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-fg">{d.rotulo}</span>
            <span className="shrink-0 font-semibold tabular text-fg">{numero(d.valor)}</span>
            <span className="w-9 shrink-0 text-right tabular text-muted">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barras agrupadas — meta vs. realizado (2 séries, MESMA unidade)     */
/* ------------------------------------------------------------------ */

export function BarrasAgrupadas({
  dados,
  altura = 180,
}: {
  dados: { rotulo: string; meta: number; realizado: number }[];
  altura?: number;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  if (!dados.length) return <SemDados altura={altura} />;

  // Um eixo só: meta e realizado são ambos em R$. Duas escalas seriam mentira.
  const max = Math.max(...dados.flatMap((d) => [d.meta, d.realizado]));

  return (
    <figure className="m-0">
      <div className="mb-3 flex items-center gap-4">
        <Legenda cor="var(--brand-soft)" borda="var(--brand-border)">Meta</Legenda>
        <Legenda cor="var(--brand)">Realizado</Legenda>
      </div>

      <div className="flex items-end gap-4" style={{ height: altura }}>
        {dados.map((d, i) => (
          <div
            key={d.rotulo}
            className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-1.5"
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
          >
            {ativo === i && (
              <div className="absolute -top-1 z-sticky -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-md">
                <p className="text-[11px] text-muted">
                  Meta <span className="font-semibold tabular text-fg">{moedaCurta(d.meta)}</span>
                </p>
                <p className="text-[11px] text-muted">
                  Realizado <span className="font-semibold tabular text-fg">{moedaCurta(d.realizado)}</span>
                </p>
              </div>
            )}
            <div
              className="w-1/3 rounded-t-sm border border-brand-border bg-brand-soft"
              style={{ height: `${(d.meta / max) * 100}%` }}
              role="img"
              aria-label={`${d.rotulo}, meta: ${moeda(d.meta)}`}
            />
            <div
              className="w-1/3 rounded-t-sm bg-brand"
              style={{ height: `${(d.realizado / max) * 100}%` }}
              role="img"
              aria-label={`${d.rotulo}, realizado: ${moeda(d.realizado)}`}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-4 border-t border-line pt-2">
        {dados.map((d) => (
          <p key={d.rotulo} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
            {d.rotulo}
          </p>
        ))}
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Barra de progresso do funil resumido (Dashboard)                    */
/* ------------------------------------------------------------------ */

export function FaixasFunil({ etapas }: { etapas: { rotulo: string; valor: number }[] }) {
  if (!etapas.length) return null;
  const total = etapas.reduce((s, e) => s + e.valor, 0) || 1;

  return (
    <div>
      <div className="flex gap-1.5">
        {etapas.map((e, i) => (
          <div
            key={e.rotulo}
            className="h-7 rounded-sm"
            style={{
              flex: Math.max(0.5, e.valor / total),
              background: `color-mix(in srgb, var(--brand) ${Math.round(28 + (i / Math.max(1, etapas.length - 1)) * 58)}%, var(--brand-soft))`,
            }}
            role="img"
            aria-label={`${e.rotulo}: ${numero(e.valor)}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {etapas.map((e, i) => (
          <div key={e.rotulo} style={{ flex: Math.max(0.5, e.valor / total) }} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold tabular text-fg">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: `color-mix(in srgb, var(--brand) ${Math.round(28 + (i / Math.max(1, etapas.length - 1)) * 58)}%, var(--brand-soft))`,
                }}
                aria-hidden
              />
              {numero(e.valor)}
            </p>
            <p className="truncate text-[11px] text-muted">{e.rotulo}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Legenda({ cor, borda, children }: { cor: string; borda?: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: cor, border: borda ? `1px solid ${borda}` : undefined }}
        aria-hidden
      />
      {children}
    </span>
  );
}

function SemDados({ altura }: { altura: number }) {
  return (
    <div className="flex items-center justify-center rounded-md bg-surface2 text-[13px] text-muted" style={{ height: altura }}>
      Sem dados no período
    </div>
  );
}
