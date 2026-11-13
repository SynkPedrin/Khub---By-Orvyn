'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import type { Dimensao, ResultadoCriativo, ResultadoSimulacao } from '@/lib/ads-simulador';

const brl = (v: number, casas = 0) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const cpr = (v: number) => brl(v, v < 100 ? 2 : 0);
const compacto = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : v >= 10_000 ? `${Math.round(v / 1000).toLocaleString('pt-BR')} mil` : num(v));

/** Número que conta até o valor (suave, 700 ms). */
function useContador(alvo: number, ms = 700): number {
  const [v, setV] = useState(alvo);
  const de = useRef(alvo);
  useEffect(() => {
    const inicio = de.current;
    if (inicio === alvo) return;
    const reduzir = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduzir) { de.current = alvo; setV(alvo); return; }
    const t0 = performance.now();
    let raf = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const atual = inicio + (alvo - inicio) * e;
      de.current = atual;
      setV(atual);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo, ms]);
  return v;
}

function Kpi({ rotulo, valor, formatar, sub, destaque, i }: { rotulo: string; valor: number; formatar: (v: number) => string; sub?: string; destaque?: boolean; i: number }) {
  const v = useContador(valor);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.05, type: 'spring', stiffness: 380, damping: 30 }}
      className={`rounded-2xl border p-3.5 ${destaque ? 'border-brand/40 bg-brand/[0.06]' : 'border-line bg-surface2'}`}
    >
      <p className="text-2xs font-medium text-muted">{rotulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${destaque ? 'text-brand' : 'text-fg'}`}>{formatar(v)}</p>
      {sub && <p className="mt-0.5 text-2xs text-muted">{sub}</p>}
    </motion.div>
  );
}

/* ------------------------------ linha do tempo ------------------------------ */

function LinhaDoTempo({ r }: { r: ResultadoSimulacao }) {
  const dias = r.serie.length;
  const [dia, setDia] = useState(dias);
  const [rodando, setRodando] = useState(false);
  useEffect(() => { setDia(dias); setRodando(false); }, [r, dias]);
  useEffect(() => {
    if (!rodando) return;
    if (dia >= dias) { setRodando(false); return; }
    const t = setTimeout(() => setDia((d) => d + 1), Math.max(60, Math.min(260, 3200 / dias)));
    return () => clearTimeout(t);
  }, [rodando, dia, dias]);

  const maxRes = Math.max(...r.serie.map((d) => d.resultados), 1);
  const maxCpr = Math.max(...r.serie.map((d) => d.cpr), 1);
  const acum = r.serie.slice(0, dia).reduce((a, d) => ({ gasto: a.gasto + d.gasto, res: a.res + d.resultados, imp: a.imp + d.impressoes }), { gasto: 0, res: 0, imp: 0 });
  const W = 600;
  const H = 150;
  const larg = W / dias;
  const linha = r.serie.map((d, i) => `${i === 0 ? 'M' : 'L'}${(i + 0.5) * larg},${H - (d.cpr / maxCpr) * (H - 14) - 4}`).join(' ');
  const fimAprendizado = r.serie.findIndex((d) => !d.aprendizado);

  return (
    <div className="rounded-2xl border border-line bg-surface2/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-fg">Dia a dia</p>
          <p className="text-2xs text-muted">Barras: {r.resultadoNome} por dia · linha: custo por resultado</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-2xs text-muted tabular-nums">
            <span className="block">Dia <b className="text-fg">{dia}</b>/{dias}</span>
            <span className="block">{brl(acum.gasto)} → <b className="text-brand">{num(acum.res)}</b> {r.resultadoNome}</span>
          </div>
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => { if (rodando) setRodando(false); else { if (dia >= dias) setDia(0); setRodando(true); } }}
            className="btn btn-primary px-3 py-1.5 text-xs"
          >
            <Icon name={rodando ? 'pause' : 'play'} size={14} /> {rodando ? 'Pausar' : 'Rodar dia a dia'}
          </motion.button>
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none" role="img" aria-label={`${r.resultadoNome} por dia ao longo de ${dias} dias`}>
          {fimAprendizado !== 0 && (
            <rect x={0} y={0} width={(fimAprendizado < 0 ? dias : fimAprendizado) * larg} height={H} fill="var(--muted)" opacity={0.07} />
          )}
          {r.serie.map((d, i) => {
            const h = (d.resultados / maxRes) * (H - 14);
            return (
              <motion.rect
                key={i}
                x={i * larg + larg * 0.18}
                width={larg * 0.64}
                rx={Math.min(3, larg * 0.2)}
                initial={{ height: 0, y: H }}
                animate={{ height: h, y: H - h, opacity: i < dia ? (d.aprendizado ? 0.5 : 1) : 0.12 }}
                transition={{ delay: Math.min(i * 0.012, 0.5), type: 'spring', stiffness: 260, damping: 28 }}
                style={{ fill: 'var(--brand)' }}
              />
            );
          })}
          <motion.path d={linha} fill="none" stroke="#0081fb" strokeWidth={2} vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.2 }} />
          {dia > 0 && dia <= dias && <line x1={dia * larg} x2={dia * larg} y1={0} y2={H} style={{ stroke: 'var(--text)' }} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand opacity-50" /> Fase de aprendizado</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand" /> Otimizado</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#0081fb]" /> Custo por resultado</span>
          <span className="ml-auto">Pico de frequência: {Math.max(...r.serie.map((d) => d.frequencia)).toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ curva de verba ------------------------------ */

function CurvaVerba({ r, atual, onOrcamento }: { r: ResultadoSimulacao; atual: number; onOrcamento: (v: number) => void }) {
  const pts = r.curvaVerba.filter((p) => p.custoPorResultado > 0);
  if (pts.length < 2) return null;
  const W = 600;
  const H = 140;
  const maxC = Math.max(...pts.map((p) => p.custoPorResultado));
  const minC = Math.min(...pts.map((p) => p.custoPorResultado));
  const pad = (maxC - minC) * 0.25 || maxC * 0.1;
  const x = (i: number) => 30 + (i / (pts.length - 1)) * (W - 60);
  const y = (c: number) => H - 22 - ((c - (minC - pad)) / (maxC + pad - (minC - pad))) * (H - 40);
  const caminho = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.custoPorResultado)}`).join(' ');
  return (
    <div className="rounded-2xl border border-line bg-surface2/60 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-fg">Simulador de verba</p>
          <p className="text-2xs text-muted">Custo por resultado em cada verba diária. Clique num ponto para testar essa verba.</p>
        </div>
        {r.verbaRecomendada && (
          <button type="button" onClick={() => onOrcamento(r.verbaRecomendada!)} className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-2xs font-semibold text-brand">
            Escala eficiente até {brl(r.verbaRecomendada)}/dia
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full">
        <motion.path d={caminho} fill="none" stroke="var(--brand)" strokeWidth={2.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
        {pts.map((p, i) => {
          const eAtual = Math.abs(p.orcamentoDia - atual) < 1;
          return (
            <g
              key={p.orcamentoDia}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-label={`Testar ${brl(p.orcamentoDia)} por dia: ${cpr(p.custoPorResultado)} por resultado`}
              onClick={() => onOrcamento(p.orcamentoDia)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOrcamento(p.orcamentoDia); } }}
            >
              <circle cx={x(i)} cy={y(p.custoPorResultado)} r={16} fill="transparent" />
              <motion.circle
                cx={x(i)} cy={y(p.custoPorResultado)}
                initial={{ r: 0 }} animate={{ r: eAtual ? 7 : 4.5 }}
                transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 400, damping: 20 }}
                fill={eAtual ? 'var(--brand)' : 'var(--surface)'} stroke="var(--brand)" strokeWidth={2}
              />
              <text x={x(i)} y={y(p.custoPorResultado) - 12} textAnchor="middle" fontSize="12" style={{ fill: 'var(--text)' }} fontWeight={eAtual ? 700 : 500}>{cpr(p.custoPorResultado)}</text>
              <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>{brl(p.orcamentoDia)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------ criativos (A/B) ------------------------------ */

function Anel({ nota, size = 56 }: { nota: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const cor = nota >= 70 ? 'var(--brand)' : nota >= 50 ? '#f5b400' : '#ef4444';
  const v = useContador(nota);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={5} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={cor} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - nota / 100) }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums text-fg">{Math.round(v)}</span>
    </span>
  );
}

function BarraNota({ rotulo, d, aberta, onToggle }: { rotulo: string; d: Dimensao; aberta: boolean; onToggle: () => void }) {
  const cor = d.nota >= 70 ? 'var(--brand)' : d.nota >= 50 ? '#f5b400' : '#ef4444';
  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left" aria-expanded={aberta}>
        <span className="w-14 shrink-0 text-2xs font-semibold text-muted">{rotulo}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface3">
          <motion.span className="block h-full rounded-full" style={{ background: cor }} initial={{ width: 0 }} animate={{ width: `${d.nota}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
        </span>
        <span className="w-7 text-right text-2xs font-bold tabular-nums text-fg">{d.nota}</span>
        <Icon name="chevronDown" size={12} className={`text-muted transition-transform ${aberta ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {aberta && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-16">
            {d.motivos.map((m) => (
              <li key={m.texto} className="flex gap-1.5 py-0.5 text-2xs text-fg">
                <Icon name={m.ok ? 'check' : 'alert'} size={11} className={`mt-0.5 shrink-0 ${m.ok ? 'text-emerald-500' : 'text-amber-500'}`} />
                {m.texto}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function CartaoCriativo({ c, r, vencedor, i }: { c: ResultadoCriativo; r: ResultadoSimulacao; vencedor: boolean; i: number }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const tog = (k: string) => setAberta((a) => (a === k ? null : k));
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 320, damping: 30 }}
      className={`relative rounded-2xl border p-4 ${vencedor ? 'border-brand/50 bg-brand/[0.05]' : 'border-line bg-surface2/60'}`}
    >
      {vencedor && (
        <motion.span initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.5, type: 'spring', stiffness: 500, damping: 18 }} className="absolute -top-2.5 right-3 flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-2xs font-bold text-black shadow">
          <Icon name="trophy" size={11} /> Vencedor provável
        </motion.span>
      )}
      <div className="flex items-center gap-3">
        <Anel nota={c.nota.geral} />
        <div className="min-w-0">
          <p className="truncate font-bold text-fg">{c.nome}</p>
          <p className="text-2xs text-muted">{brl(c.orcamentoDia)}/dia · CTR {c.ctr.toFixed(2)}% · CPM {brl(c.cpm)}</p>
          {c.nota.riscoReprovacao && <p className="mt-0.5 flex items-center gap-1 text-2xs font-semibold text-red-500"><Icon name="shield" size={11} /> Risco de reprovação</p>}
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <BarraNota rotulo="Hook" d={c.nota.hook} aberta={aberta === 'hook'} onToggle={() => tog('hook')} />
        <BarraNota rotulo="Copy" d={c.nota.copy} aberta={aberta === 'copy'} onToggle={() => tog('copy')} />
        <BarraNota rotulo="CTA" d={c.nota.cta} aberta={aberta === 'cta'} onToggle={() => tog('cta')} />
        <BarraNota rotulo="Criativo" d={c.nota.criativo} aberta={aberta === 'criativo'} onToggle={() => tog('criativo')} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
        <div><p className="text-2xs text-muted capitalize">{r.resultadoNome}</p><p className="font-bold tabular-nums text-fg">{num(c.resultados.p50)}</p></div>
        <div><p className="text-2xs text-muted">Custo/resultado</p><p className="font-bold tabular-nums text-fg">{cpr(c.custoPorResultado.p50)}</p></div>
        <div><p className="text-2xs text-muted">Aprendizado</p><p className="font-bold text-fg">{c.saidaAprendizado ? `sai no dia ${Math.round(c.saidaAprendizado)}` : 'limitado'}</p></div>
      </div>
      {r.criativos.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-2xs text-muted"><span>Chance de vencer o teste</span><b className="tabular-nums text-fg">{Math.round(c.chanceMelhor * 100)}%</b></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
            <motion.div className="h-full rounded-full bg-[#0081fb]" initial={{ width: 0 }} animate={{ width: `${c.chanceMelhor * 100}%` }} transition={{ duration: 0.8, delay: 0.2 }} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------ painel ------------------------------ */

const FONTE: Record<ResultadoSimulacao['base']['fonte'], string> = {
  conta: 'calibrada com o histórico da sua conta Meta',
  mista: 'referência de mercado ajustada pelo histórico da sua conta',
  referencia: 'referência de mercado (negócio local no Brasil); conecte a Meta para calibrar com a sua conta',
  manual: 'premissas digitadas por você',
};

export function ResultadoSimulacaoPainel({ r, orcamentoDia, onOrcamento }: { r: ResultadoSimulacao; orcamentoDia: number; onOrcamento: (v: number) => void }) {
  const t = r.total;
  const geraVenda = t.receita !== null;
  const kpis = useMemo(() => [
    { rotulo: 'Investimento', valor: t.investimento, formatar: (v: number) => brl(v), sub: `${r.serie.length} dias · ${brl(orcamentoDia)}/dia` },
    { rotulo: r.resultadoNome[0].toUpperCase() + r.resultadoNome.slice(1), valor: t.resultados.p50, formatar: num, sub: `provável entre ${num(t.resultados.p10)} e ${num(t.resultados.p90)}`, destaque: true },
    { rotulo: 'Custo por resultado', valor: t.custoPorResultado.p50, formatar: cpr, sub: `entre ${cpr(t.custoPorResultado.p10)} e ${cpr(t.custoPorResultado.p90)}` },
    geraVenda
      ? { rotulo: 'Receita estimada', valor: t.receita ?? 0, formatar: (v: number) => brl(v), sub: `${num(t.vendas)} vendas · ROAS ${(t.roas ?? 0).toFixed(1)}x` }
      : { rotulo: 'Cliques no link', valor: t.cliques, formatar: num, sub: `CTR ${t.ctr.toFixed(2)}% · CPM ${brl(t.cpm)}` },
    { rotulo: 'Alcance', valor: t.alcance, formatar: compacto, sub: `frequência ${t.frequencia.toFixed(1)} · ${compacto(t.impressoes)} impressões` },
  ], [r, t, geraVenda, orcamentoDia]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((k, i) => <Kpi key={k.rotulo} {...k} i={i} />)}
      </div>

      {r.alertas.length > 0 && (
        <div className="space-y-1.5">
          {r.alertas.map((a, i) => (
            <motion.div key={a.texto} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
              className={`flex gap-2 rounded-xl px-3 py-2 text-xs ${a.nivel === 'risco' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : a.nivel === 'atencao' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-surface2 text-muted'}`}>
              <Icon name={a.nivel === 'info' ? 'info' : 'alert'} size={14} className="mt-0.5 shrink-0" />
              {a.texto}
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <LinhaDoTempo r={r} />
        <CurvaVerba r={r} atual={Math.round(orcamentoDia)} onOrcamento={onOrcamento} />
      </div>

      <div className={`grid gap-4 ${r.criativos.length === 1 ? 'md:grid-cols-1 xl:max-w-md' : r.criativos.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {r.criativos.map((c, i) => <CartaoCriativo key={c.nome + i} c={c} r={r} vencedor={r.vencedor === c.nome} i={i} />)}
      </div>

      <p className="text-2xs leading-relaxed text-faint">
        Simulação, não promessa. Base usada: CPM {brl(r.base.cpm, 2)}, CTR {r.base.ctr.toFixed(2)}%, {r.base.conversao.toFixed(1)}% dos cliques viram resultado ({FONTE[r.base.fonte]}
        {r.calibracao ? `: ${compacto(r.calibracao.impressoes)} impressões e ${brl(r.calibracao.gasto)} nos últimos 90 dias` : ''}). Faixa provável calculada em {r.rodadas} cenários: leilão, fase de aprendizado, saturação do público e cansaço do criativo.
      </p>
    </div>
  );
}
