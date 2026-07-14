'use client';

export function Sparkline({ data, color = 'var(--brand)', width = 90, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${pts.join(' ')} ${width},${height}`;
  const id = `sp-${data.join('-').slice(0, 12)}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({ data, height = 160 }: { data: { mes: string; v: number }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.v)) || 1;
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d, i) => (
        <div key={d.mes} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t-lg transition-all"
              style={{
                height: `${(d.v / max) * 100}%`,
                background: i === data.length - 1 ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 35%, transparent)',
              }}
              title={`${d.mes}: R$ ${d.v}k`}
            />
          </div>
          <span className="text-[11px] text-muted">{d.mes}</span>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ data }: { data: { nome: string; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total)) || 1;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.nome} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs text-muted">{d.nome}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-lg bg-surface3">
            <div
              className="flex h-full items-center justify-end rounded-lg px-2 text-[11px] font-semibold text-white"
              style={{ width: `${Math.max((d.total / max) * 100, 12)}%`, background: 'linear-gradient(90deg, var(--brand-deep), var(--brand))' }}
            >
              {d.total}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
