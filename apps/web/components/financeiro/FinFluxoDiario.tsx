'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui';
import { money } from './fin-utils';

interface DiaFluxo {
  dia: string; // YYYY-MM-DD
  entrada: number;
  saida: number;
  acumulado: number;
}

const W = 800;
const H = 230;
const PAD_X = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const AREA_H = H - PAD_TOP - PAD_BOTTOM;

/**
 * Fluxo de caixa dia a dia: barras de entradas e saídas pagas e a linha do
 * saldo acumulado no período. É onde se vê a semana forte, o dia apertado e
 * a tendência do mês — sem abrir nenhum relatório.
 */
export function FinFluxoDiario({ porDia, de, ate }: { porDia: { dia: string; tipo: string; total: number }[]; de: string; ate: string }) {
  const dias = useMemo<DiaFluxo[]>(() => {
    const mapa = new Map<string, { entrada: number; saida: number }>();
    for (const r of porDia) {
      const d = mapa.get(r.dia) ?? { entrada: 0, saida: 0 };
      if (r.tipo === 'entrada') d.entrada += r.total;
      else d.saida += r.total;
      mapa.set(r.dia, d);
    }
    const lista: DiaFluxo[] = [];
    let acumulado = 0;
    const ini = new Date(`${de}T12:00:00`);
    const fim = new Date(`${ate}T12:00:00`);
    for (let d = new Date(ini); d <= fim && lista.length < 62; d.setDate(d.getDate() + 1)) {
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const v = mapa.get(chave) ?? { entrada: 0, saida: 0 };
      acumulado += v.entrada - v.saida;
      lista.push({ dia: chave, entrada: v.entrada, saida: v.saida, acumulado });
    }
    return lista;
  }, [porDia, de, ate]);

  if (!dias.length) return null;
  const temMovimento = dias.some((d) => d.entrada || d.saida);

  const maxBarra = Math.max(1, ...dias.map((d) => Math.max(d.entrada, d.saida)));
  const maxLinha = Math.max(0, ...dias.map((d) => d.acumulado));
  const minLinha = Math.min(0, ...dias.map((d) => d.acumulado));
  const faixaLinha = Math.max(1, maxLinha - minLinha);

  const slot = (W - PAD_X * 2) / dias.length;
  const barra = Math.min(slot * 0.34, 14);
  const yBarra = (v: number) => PAD_TOP + AREA_H - (v / maxBarra) * AREA_H;
  const yLinha = (v: number) => PAD_TOP + AREA_H - ((v - minLinha) / faixaLinha) * AREA_H;
  const x = (i: number) => PAD_X + i * slot + slot / 2;

  const pontosLinha = dias.map((d, i) => `${x(i)},${yLinha(d.acumulado)}`).join(' ');
  const passoRotulo = Math.max(1, Math.ceil(dias.length / 15));

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-bold text-fg">O mês dia a dia</h2>
          <p className="mt-0.5 text-xs text-muted">Entradas e saídas pagas por dia; a linha é o saldo acumulado do período.</p>
        </div>
        <div className="flex items-center gap-4 text-2xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Entradas</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />Saídas</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand" />Saldo acumulado</span>
        </div>
      </div>

      {!temMovimento ? (
        <p className="mt-4 text-sm text-muted">Nenhum lançamento pago no período.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Fluxo de caixa diário: barras de entradas e saídas e linha de saldo acumulado">
          {/* linha do zero do saldo */}
          <line x1={PAD_X} x2={W - PAD_X} y1={yLinha(0)} y2={yLinha(0)} stroke="currentColor" className="text-line" strokeDasharray="3 4" strokeWidth="1" />
          {dias.map((d, i) => (
            <g key={d.dia}>
              {d.entrada > 0 && (
                <rect x={x(i) - barra - 0.5} y={yBarra(d.entrada)} width={barra} height={Math.max(2, PAD_TOP + AREA_H - yBarra(d.entrada))} rx="1.5" className="fill-emerald-400/85">
                  <title>{`${Number(d.dia.slice(8))}/${d.dia.slice(5, 7)} · entradas ${money(d.entrada)}`}</title>
                </rect>
              )}
              {d.saida > 0 && (
                <rect x={x(i) + 0.5} y={yBarra(d.saida)} width={barra} height={Math.max(2, PAD_TOP + AREA_H - yBarra(d.saida))} rx="1.5" className="fill-red-400/85">
                  <title>{`${Number(d.dia.slice(8))}/${d.dia.slice(5, 7)} · saídas ${money(d.saida)}`}</title>
                </rect>
              )}
              {i % passoRotulo === 0 && (
                <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-current text-[10px] text-faint">
                  {Number(d.dia.slice(8))}
                </text>
              )}
            </g>
          ))}
          <polyline points={pontosLinha} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-brand" />
          {/* ponto final com o saldo do período */}
          <circle cx={x(dias.length - 1)} cy={yLinha(dias[dias.length - 1].acumulado)} r="3.5" className="fill-brand">
            <title>{`Saldo acumulado: ${money(dias[dias.length - 1].acumulado)}`}</title>
          </circle>
        </svg>
      )}
    </Card>
  );
}
