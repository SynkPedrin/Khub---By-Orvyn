'use client';

import { useId } from 'react';

/** Linha com área, glow e ponto final destacado — mesmo material dos botões. */
export function Sparkline({ data, color = 'var(--brand)', width = 90, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const uid = useId().replace(/:/g, '');
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });
  const linha = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `0,${height} ${linha} ${width},${height}`;
  const fim = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor={color} floodOpacity="0.35" />
        </filter>
      </defs>
      <polygon points={area} fill={`url(#fill-${uid})`} />
      <polyline points={linha} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter={`url(#glow-${uid})`} />
      <circle cx={fim.x} cy={fim.y} r="2.6" fill={color} />
      <circle cx={fim.x} cy={fim.y} r="5" fill={color} opacity="0.18" />
    </svg>
  );
}

/** Barras em metal líquido: gradiente vertical, gloss no topo, glow na última. */
export function BarChart({ data, height = 160 }: { data: { mes: string; v: number }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.v)) || 1;
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d, i) => {
        const ultima = i === data.length - 1;
        return (
          <div key={d.mes} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-[10px] transition-[height] duration-500"
                style={{
                  height: `${(d.v / max) * 100}%`,
                  background: ultima
                    ? 'linear-gradient(180deg, var(--brand-bright), var(--brand) 55%, var(--brand-deep))'
                    : 'linear-gradient(180deg, color-mix(in srgb, var(--brand-bright) 42%, transparent), color-mix(in srgb, var(--brand) 28%, transparent))',
                  boxShadow: ultima
                    ? 'inset 0 1px 0 rgba(255,255,255,0.4), 0 8px 20px -10px var(--glow)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.25)',
                }}
                title={`${d.mes}: R$ ${d.v}k`}
              />
            </div>
            <span className="text-[11px] text-muted">{d.mes}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Funil: barras horizontais em metal líquido, gloss e glow; trilho de vidro. */
export function Funnel({ data }: { data: { nome: string; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total)) || 1;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.nome} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-muted">{d.nome}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-lg border border-line bg-surface3">
            <div
              className="flex h-full items-center justify-end rounded-lg px-2 text-[11px] font-semibold text-white transition-[width] duration-500"
              style={{
                width: `${Math.max((d.total / max) * 100, 12)}%`,
                background: 'linear-gradient(90deg, var(--brand-deep), var(--brand) 60%, var(--brand-bright))',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(0,0,0,0.1), 0 6px 16px -8px var(--glow)',
              }}
            >
              {d.total}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
