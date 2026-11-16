'use client';

import { motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { MetaLogoAnimado } from '../MetaLogoAnimado';
import type { RelatorioSimulacao } from '@/lib/ads-simulador';

function Lista({ itens, icone, cor }: { itens: string[]; icone: 'check' | 'alert' | 'arrowRight' | 'bolt'; cor: string }) {
  if (!itens.length) return null;
  return (
    <ul className="space-y-1.5">
      {itens.map((t, i) => (
        <motion.li key={t} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.04 }} className="flex gap-2 text-xs leading-relaxed text-fg">
          <Icon name={icone} size={13} className={`mt-0.5 shrink-0 ${cor}`} />
          {t}
        </motion.li>
      ))}
    </ul>
  );
}

/** Relatório final da simulação (IA por cima dos números do motor). */
export function RelatorioFinalPainel({ r }: { r: RelatorioSimulacao }) {
  const cor = r.notaGeral >= 70 ? 'var(--brand)' : r.notaGeral >= 50 ? '#f5b400' : '#ef4444';
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="mt-4 overflow-hidden rounded-2xl border border-brand/30 bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-brand/[0.05] px-4 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-lg font-bold tabular-nums" style={{ color: cor }}>
          {Math.round(r.notaGeral)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-bold text-fg">
            <Icon name="sparkles" size={15} className="text-brand" /> Relatório final da simulação
          </p>
          <p className="text-xs font-medium text-fg">{r.veredicto}</p>
        </div>
        <span className="text-2xs text-faint">{new Date(r.geradoEm).toLocaleString('pt-BR')} · {r.modelo}</span>
      </div>
      <div className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-muted">{r.resumo}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-muted">Pontos fortes</p>
            <Lista itens={r.pontosFortes} icone="check" cor="text-emerald-500" />
          </div>
          <div>
            <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-muted">Riscos</p>
            <Lista itens={r.riscos} icone="alert" cor="text-amber-500" />
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-muted">Como melhorar (por impacto)</p>
          <Lista itens={r.melhorias} icone="arrowRight" cor="text-brand" />
        </div>
        <div className="rounded-xl border border-line bg-surface2/60 p-3">
          <p className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-muted">Primeiros 7 dias no ar</p>
          <Lista itens={r.proximosPassos} icone="bolt" cor="text-brand" />
        </div>
        <p className="text-2xs leading-relaxed text-faint">Relatório gerado por IA sobre a projeção do simulador (que usa {400} cenários e o histórico real da conta quando conectada). É apoio à decisão, não garantia de resultado.</p>
      </div>
    </motion.div>
  );
}

/** Estado de carregamento do relatório. */
export function RelatorioFinalCarregando() {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-line py-10">
      <MetaLogoAnimado size={64} simulando />
      <p className="mt-4 text-sm font-semibold text-fg">Escrevendo o relatório final…</p>
      <p className="mt-1 text-2xs text-muted">Cruzando projeção, criativos, posts do Instagram e concorrência</p>
    </div>
  );
}
