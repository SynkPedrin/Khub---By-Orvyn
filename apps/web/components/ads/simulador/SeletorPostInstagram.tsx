'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { simulador, type PostIg, type PostsInstagramResp } from '@/lib/ads-simulador';

const num = (v: number | null) => (v == null ? '-' : v >= 10_000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR'));

const TIPO_ROTULO: Record<string, string> = { reels: 'Reels', video: 'Vídeo', imagem: 'Imagem', carrossel: 'Carrossel' };

/**
 * Grade de posts e reels reais do Instagram conectado (GET /ads/simulador/
 * posts-instagram) para virar criativo da simulação. Cada estado ruim (não
 * conectado, permissão, token) aparece com a mensagem da API, nunca post fake.
 */
export function SeletorPostInstagram({ onEscolher }: { onEscolher: (post: PostIg) => void }) {
  const [resp, setResp] = useState<PostsInstagramResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    simulador.postsInstagram()
      .then((r) => { if (vivo) setResp(r); })
      .catch(() => { if (vivo) setErro('Não consegui buscar os posts do Instagram agora. Tente de novo.'); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  if (carregando) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton aspect-[4/5] rounded-xl" />)}
      </div>
    );
  }
  if (erro) return <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>;
  if (!resp || !resp.conectado || resp.status.status !== 'ok') {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-5 text-center">
        <Icon name="instagram" size={22} className="mx-auto text-muted" />
        <p className="mt-2 text-xs font-semibold text-fg">Instagram não disponível</p>
        <p className="mx-auto mt-1 max-w-xs text-2xs text-muted">{resp?.status.mensagem ?? 'Conecte o Instagram para puxar posts e reels como criativo.'}</p>
        <a href="/redes" className="btn btn-soft mt-3 inline-flex px-3 py-1.5 text-xs"><Icon name="link" size={13} /> Gerenciar redes</a>
      </div>
    );
  }
  if (!resp.posts.length) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-xs text-muted">Nenhum post ou reels recente em {resp.conta ?? 'sua conta'}.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-2xs text-muted">{resp.conta ? `${resp.conta} · ` : ''}{resp.posts.length} conteúdos recentes · métricas orgânicas reais</p>
        {resp.metricasStatus.status !== 'ok' && <p className="text-2xs text-amber-600 dark:text-amber-400">{resp.metricasStatus.mensagem ?? 'Sem métricas para alguns posts.'}</p>}
      </div>
      <div className="grid max-h-[340px] grid-cols-2 gap-2 overflow-y-auto scrollbar-thin pr-1 sm:grid-cols-3">
        {resp.posts.map((p, i) => (
          <motion.button
            key={p.id}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.3) }}
            onClick={() => onEscolher(p)}
            className="group relative overflow-hidden rounded-xl border border-line bg-surface2 text-left transition-colors hover:border-brand/60"
          >
            <div className="relative aspect-[4/5] bg-surface3">
              {p.miniatura ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.miniatura} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full items-center justify-center text-muted"><Icon name={p.tipo === 'reels' || p.tipo === 'video' ? 'video' : 'instagram'} size={22} /></span>
              )}
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/65 px-2 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm">
                {TIPO_ROTULO[p.tipo] ?? p.tipo}
              </span>
              {p.metricas.engajamento != null && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-2xs font-bold text-black shadow">
                  {p.metricas.engajamento.toFixed(1)}% eng.
                </span>
              )}
            </div>
            <div className="p-2">
              <p className="line-clamp-2 min-h-[2.2em] text-2xs leading-snug text-fg">{p.legenda || '(sem legenda)'}</p>
              <p className="mt-1 flex items-center gap-2 text-2xs text-muted">
                <span>♥ {num(p.metricas.curtidas)}</span>
                <span>💬 {num(p.metricas.comentarios)}</span>
                {p.metricas.salvamentos != null && <span>🔖 {num(p.metricas.salvamentos)}</span>}
              </p>
            </div>
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
              <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-black">Usar como criativo</span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
