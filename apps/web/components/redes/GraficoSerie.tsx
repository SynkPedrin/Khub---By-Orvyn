'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { PontoSerie } from '@/lib/redes';

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
const dataCurta = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Linha diária de UMA série (o título nomeia a série; sem legenda). Um eixo,
 * grade recessiva, linha de 2 px, crosshair com tooltip no hover/toque e
 * tabela acessível escondida para leitor de tela.
 */
export function GraficoSerie({ titulo, serie, altura = 180 }: { titulo: string; serie: PontoSerie[]; altura?: number }) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const [foco, setFoco] = useState<number | null>(null);
  const L = 640;
  const pad = { t: 12, r: 12, b: 24, l: 52 };
  const w = L - pad.l - pad.r;
  const h = altura - pad.t - pad.b;

  const g = useMemo(() => {
    const vals = serie.map((p) => p.valor);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const x = (i: number) => pad.l + (serie.length === 1 ? w / 2 : (i / (serie.length - 1)) * w);
    const y = (v: number) => pad.t + h - ((v - min) / (max - min)) * h;
    const pts = serie.map((p, i) => ({ x: x(i), y: y(p.valor), p }));
    const ticks = [min, (min + max) / 2, max];
    return { pts, ticks, y };
  }, [serie, w, h, pad.l, pad.t]);

  if (serie.length < 2) return null;

  const linha = g.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${g.pts[0].x},${pad.t + h} ${linha} ${g.pts[g.pts.length - 1].x},${pad.t + h}`;

  const mover = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const xs = ((clientX - r.left) / r.width) * L;
    let melhor = 0;
    g.pts.forEach((p, i) => {
      if (Math.abs(p.x - xs) < Math.abs(g.pts[melhor].x - xs)) melhor = i;
    });
    setFoco(melhor);
  };
  const atual = foco != null ? g.pts[foco] : null;

  return (
    <figure className="relative">
      <figcaption className="sr-only">{titulo}</figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${L} ${altura}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${titulo}: de ${fmt(serie[0].valor)} em ${dataCurta(serie[0].dia)} a ${fmt(serie[serie.length - 1].valor)} em ${dataCurta(serie[serie.length - 1].dia)}`}
        onMouseMove={(e) => mover(e.clientX)}
        onMouseLeave={() => setFoco(null)}
        onTouchStart={(e) => mover(e.touches[0].clientX)}
        onTouchMove={(e) => mover(e.touches[0].clientX)}
      >
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={L - pad.r} y1={g.y(t)} y2={g.y(t)} stroke="currentColor" className="text-line" strokeWidth="1" />
            <text x={pad.l - 8} y={g.y(t) + 4} textAnchor="end" className="fill-current text-muted" fontSize="11">{fmt(t)}</text>
          </g>
        ))}
        <text x={pad.l} y={altura - 6} className="fill-current text-muted" fontSize="11">{dataCurta(serie[0].dia)}</text>
        <text x={L - pad.r} y={altura - 6} textAnchor="end" className="fill-current text-muted" fontSize="11">{dataCurta(serie[serie.length - 1].dia)}</text>
        <polygon points={area} fill={`url(#area-${uid})`} />
        <polyline points={linha} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {atual && (
          <g>
            <line x1={atual.x} x2={atual.x} y1={pad.t} y2={pad.t + h} stroke="currentColor" className="text-muted" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={atual.x} cy={atual.y} r="5" fill="var(--brand)" stroke="var(--surface, #fff)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {atual && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${(atual.x / L) * 100}% - 60px), calc(100% - 120px))` }}
        >
          <p className="text-muted">{dataCurta(atual.p.dia)}</p>
          <p className="font-semibold text-fg">{fmt(atual.p.valor)}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead><tr><th>Dia</th><th>Valor</th></tr></thead>
        <tbody>{serie.map((p) => <tr key={p.dia}><td>{dataCurta(p.dia)}</td><td>{fmt(p.valor)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
