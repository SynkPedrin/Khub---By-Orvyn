'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { numeroCurto, type PostRede, type SecaoStatus } from '@/lib/redes';
import { ROTULO_TIPO } from '@/lib/instagram-analise';

/** Gradiente da marca Instagram (só em detalhes: anel do avatar, realces). */
export const GRADIENTE_IG = 'linear-gradient(135deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)';
const INTEGRACOES = '/configuracoes?tab=integracoes';

/** Número que conta até o valor ao aparecer (respeita "reduzir movimento"). */
export function Contador({ valor, formatar = (v) => numeroCurto(Math.round(v)) }: { valor: number | null | undefined; formatar?: (v: number) => string }) {
  const [v, setV] = useState(0);
  const de = useRef(0);
  useEffect(() => {
    if (valor == null) return;
    const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduzir) { setV(valor); de.current = valor; return; }
    const inicio = de.current;
    const t0 = performance.now();
    let raf = 0;
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / 800);
      const atual = inicio + (valor - inicio) * (1 - Math.pow(1 - p, 3));
      de.current = atual;
      setV(atual);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  if (valor == null) return <span className="text-muted">sem dado</span>;
  return <>{formatar(v)}</>;
}

/** Seção que a Meta bloqueou ou sem dado: diz o motivo e o caminho para resolver. */
export function AvisoSecao({ s }: { s: SecaoStatus }) {
  if (s.status === 'ok' && !s.mensagem) return null;
  const grave = ['sem_permissao', 'token', 'config', 'erro'].includes(s.status);
  return (
    <div className={cx('rounded-xl px-3.5 py-2.5 text-xs', grave ? 'border border-amber-400/40 bg-amber-400/10 text-amber-800 dark:text-amber-200' : 'bg-surface2 text-muted')}>
      <p>{s.mensagem ?? (s.status === 'sem_dados' ? 'Sem dados no período.' : 'Indisponível.')}</p>
      {s.faltando?.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {s.faltando.map((f) => <li key={f} className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-2xs">{f}</li>)}
        </ul>
      ) : null}
      {(s.status === 'sem_permissao' || s.status === 'token') && (
        <p className="mt-1.5 flex flex-wrap gap-3 font-semibold">
          <Link href={INTEGRACOES} className="underline">Reconectar Instagram</Link>
          {s.doc && <a href={s.doc} target="_blank" rel="noopener noreferrer" className="underline">Documentação da Meta</a>}
        </p>
      )}
    </div>
  );
}

export function Bloco({ titulo, sub, icone, acao, children, className, i = 0 }: { titulo: string; sub?: string; icone?: IconName; acao?: ReactNode; children: ReactNode; className?: string; i?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.05, 0.4), type: 'spring', stiffness: 320, damping: 32 }}
      className={cx('card p-5', className)}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold text-fg">
            {icone && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#d62976]/12 text-[#d62976]"><Icon name={icone} size={15} /></span>}
            {titulo}
          </h2>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {acao}
      </div>
      {children}
    </motion.section>
  );
}

/** Barras horizontais animadas (público, cliques, formatos). */
export function Barras({ itens, formatar = (v) => numeroCurto(v), porcentagem = false, cor = 'var(--brand)', vazio = 'Sem dados.' }: { itens: { rotulo: string; valor: number }[]; formatar?: (v: number) => string; porcentagem?: boolean; cor?: string; vazio?: string }) {
  if (!itens.length) return <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-xs text-muted">{vazio}</p>;
  const max = Math.max(...itens.map((x) => x.valor), 1);
  const total = itens.reduce((s, x) => s + x.valor, 0) || 1;
  return (
    <ul className="space-y-2">
      {itens.map((x, i) => (
        <li key={x.rotulo}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-fg">{x.rotulo}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {porcentagem ? `${((x.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : formatar(x.valor)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface3">
            <motion.div className="h-full rounded-full" style={{ background: cor }} initial={{ width: 0 }} animate={{ width: `${(x.valor / max) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Barra única dividida em fatias (gênero, seguidores × não seguidores). */
export function BarraDividida({ fatias, cores }: { fatias: { rotulo: string; valor: number }[]; cores: string[] }) {
  const total = fatias.reduce((s, x) => s + x.valor, 0);
  if (!total) return <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-xs text-muted">Sem dados.</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface3">
        {fatias.map((f, i) => (
          <motion.div key={f.rotulo} style={{ background: cores[i % cores.length] }} initial={{ width: 0 }} animate={{ width: `${(f.valor / total) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {fatias.map((f, i) => (
          <li key={f.rotulo} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: cores[i % cores.length] }} />
            <span className="text-fg">{f.rotulo}</span>
            <b className="tabular-nums text-fg">{((f.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b>
            <span className="text-muted">({numeroCurto(f.valor)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MiniaturaPost({ post, className }: { post: PostRede; className?: string }) {
  const [quebrou, setQuebrou] = useState(false);
  return (
    <div className={cx('relative overflow-hidden bg-surface2', className)}>
      {post.miniatura && !quebrou ? (
        // CDN da Meta (URL expira): <img> simples, sem otimização do Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.miniatura} alt="" loading="lazy" onError={() => setQuebrou(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted"><Icon name={post.tipo === 'imagem' || post.tipo === 'carrossel' ? 'file' : 'video'} size={22} /></div>
      )}
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
        <Icon name={post.tipo === 'reels' || post.tipo === 'video' ? 'play' : post.tipo === 'carrossel' ? 'layout' : 'file'} size={10} />
        {ROTULO_TIPO[post.tipo] ?? post.tipo}
      </span>
    </div>
  );
}

export function MetricasPost({ m }: { m: PostRede['metricas'] }) {
  const itens: [IconName, number | null, string][] = [
    ['users', m.alcance, 'Alcance'],
    ['eye', m.visualizacoes, 'Visualizações'],
    ['star', m.curtidas, 'Curtidas'],
    ['chat', m.comentarios, 'Comentários'],
    ['send', m.compartilhamentos, 'Compartilhamentos'],
    ['tag', m.salvamentos, 'Salvamentos'],
  ];
  const visiveis = itens.filter(([, v]) => v != null);
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-2xs text-muted">
      {visiveis.map(([icone, v, rotulo]) => (
        <span key={rotulo} title={rotulo} className="inline-flex items-center gap-1">
          <Icon name={icone} size={11} /> {numeroCurto(v)}
          <span className="sr-only">{rotulo}</span>
        </span>
      ))}
      {!visiveis.length && <span>sem métricas</span>}
    </div>
  );
}
