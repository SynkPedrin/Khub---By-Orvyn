'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { Badge, cx } from '@/components/ui';
import { Button } from '@/components/kit';
import { GraficoSerie } from '@/components/redes/GraficoSerie';
import { numeroCurto, type Kpi, type PainelRede, type PostRede, type Publicacao } from '@/lib/redes';
import { nomeCidade, nomePais, type PublicoInstagram } from '@/lib/redes-instagram';
import { DIAS_SEMANA, FAIXAS_HORA, ROTULO_TIPO, destaques, frequencia, gradeHorarios, hashtags, interacoes, melhorDia, porFormato } from '@/lib/instagram-analise';
import { AvisoSecao, BarraDividida, Barras, Bloco, Contador, MetricasPost, MiniaturaPost } from './partes';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

function valorKpi(k: Kpi): string {
  if (k.valor == null) return 'sem dado';
  if (k.formato === 'percentual') return pct(k.valor);
  return numeroCurto(Math.round(k.valor));
}

/* ================================ Visão geral ================================ */

export function AbaVisaoGeral({ p, pub, onAba }: { p: PainelRede; pub: PublicoInstagram | null; onAba: (a: 'engajamento' | 'publico') => void }) {
  const ds = useMemo(() => destaques(p.posts), [p.posts]);
  return (
    <div className="space-y-5">
      <AvisoSecao s={p.kpisStatus} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {p.kpis.map((k, i) => (
          <motion.div key={k.chave} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="card p-4">
            <p className="text-xs font-medium text-muted">{k.rotulo}</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <p className={cx('text-2xl font-semibold tabular-nums', k.valor == null ? 'text-muted' : 'text-fg')}>
                {k.valor == null ? 'sem dado' : <Contador valor={k.valor} formatar={(v) => valorKpi({ ...k, valor: v })} />}
              </p>
              {k.variacao != null && (
                <span className={cx('inline-flex items-center gap-0.5 text-xs font-semibold', k.variacao >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  <Icon name={k.variacao >= 0 ? 'arrowUp' : 'arrowDown'} size={12} /> {Math.abs(k.variacao).toLocaleString('pt-BR')}%
                </span>
              )}
            </div>
          </motion.div>
        ))}
        {pub && (
          <>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="card p-4">
              <p className="text-xs font-medium text-muted">Novos seguidores ({pub.periodoDias} dias)</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{pub.seguidores.ganhos == null ? <span className="text-base text-muted">sem dado</span> : <>+<Contador valor={pub.seguidores.ganhos} /></>}</p>
              {pub.seguidores.perdidos != null && <p className="text-2xs text-muted">{numeroCurto(pub.seguidores.perdidos)} deixaram de seguir</p>}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="card p-4">
              <p className="text-xs font-medium text-muted">Cliques nos botões do perfil</p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-fg"><Contador valor={pub.cliquesPerfil.total} /></p>
              <p className="text-2xs text-muted">ligar, mensagem, rotas, e-mail</p>
            </motion.div>
          </>
        )}
      </div>

      {ds.length > 0 && (
        <Bloco titulo="O que os dados mostram" sub={`Calculado nos ${p.posts.length} posts mais recentes.`} icone="sparkles" i={1}>
          <ul className="grid gap-2 md:grid-cols-2">
            {ds.map((d, i) => (
              <motion.li key={d.texto} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.06 }}
                className={cx('flex gap-2 rounded-xl px-3 py-2.5 text-[13px]', d.tom === 'bom' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : d.tom === 'atencao' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-surface2 text-fg')}>
                <Icon name={d.tom === 'atencao' ? 'alert' : d.tom === 'bom' ? 'trend' : 'info'} size={15} className="mt-0.5 shrink-0" />
                {d.texto}
              </motion.li>
            ))}
          </ul>
        </Bloco>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Bloco titulo="Seguidores" sub="Uma foto por dia registrada pelo KHUB." icone="users" i={2}>
          {p.crescimento.seguidores.length >= 2 ? <GraficoSerie titulo="Seguidores por dia" serie={p.crescimento.seguidores} /> : <AvisoSecao s={p.crescimento.status.mensagem ? p.crescimento.status : { status: 'sem_dados', mensagem: 'A curva aparece a partir do segundo dia de registro.' }} />}
        </Bloco>
        <Bloco titulo="Alcance diário" sub={`Últimos ${p.periodoDias} dias.`} icone="trend" i={3}>
          {p.crescimento.alcance.length >= 2 ? <GraficoSerie titulo="Alcance diário" serie={p.crescimento.alcance} /> : <AvisoSecao s={p.kpisStatus.status === 'ok' ? { status: 'sem_dados', mensagem: 'Sem dados diários no período.' } : p.kpisStatus} />}
        </Bloco>
      </div>

      {pub && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Bloco titulo="Quem você alcança" sub="Seguidores x pessoas novas." icone="eye" i={4}>
            {pub.alcancePorRelacao.status.status === 'ok' ? <BarraDividida fatias={pub.alcancePorRelacao.fatias} cores={['#4f5bd5', '#d62976', '#9ca3af']} /> : <AvisoSecao s={pub.alcancePorRelacao.status} />}
          </Bloco>
          <Bloco titulo="Alcance por formato" sub={`Últimos ${pub.periodoDias} dias.`} icone="layout" i={5}>
            {pub.alcancePorFormato.status.status === 'ok' ? <Barras itens={pub.alcancePorFormato.fatias} cor="#d62976" /> : <AvisoSecao s={pub.alcancePorFormato.status} />}
          </Bloco>
          <Bloco titulo="Botões do perfil" sub="O que a pessoa tocou no seu perfil." icone="phone" i={6} acao={<button type="button" onClick={() => onAba('publico')} className="text-xs font-semibold text-brand hover:underline">Público</button>}>
            {pub.cliquesPerfil.status.status === 'ok' ? <Barras itens={pub.cliquesPerfil.botoes} cor="#4f5bd5" vazio="Ninguém tocou nos botões do perfil no período." /> : <AvisoSecao s={pub.cliquesPerfil.status} />}
          </Bloco>
        </div>
      )}

      {p.ranking.length > 0 && (
        <Bloco titulo="Melhores posts" sub="Maior engajamento entre os recentes." icone="trophy" i={7} acao={<button type="button" onClick={() => onAba('engajamento')} className="text-xs font-semibold text-brand hover:underline">Ver análise</button>}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {p.ranking.slice(0, 5).map((post, i) => <CartaoPost key={post.id} post={post} pos={i + 1} />)}
          </div>
        </Bloco>
      )}
    </div>
  );
}

/* ================================ Posts ================================ */

type Ordem = 'recentes' | 'alcance' | 'engajamento' | 'salvamentos' | 'compartilhamentos' | 'comentarios';
const ORDENS: { v: Ordem; rotulo: string }[] = [
  { v: 'recentes', rotulo: 'Mais recentes' },
  { v: 'alcance', rotulo: 'Maior alcance' },
  { v: 'engajamento', rotulo: 'Maior engajamento' },
  { v: 'salvamentos', rotulo: 'Mais salvos' },
  { v: 'compartilhamentos', rotulo: 'Mais compartilhados' },
  { v: 'comentarios', rotulo: 'Mais comentados' },
];

function CartaoPost({ post, pos }: { post: PostRede; pos?: number }) {
  return (
    <motion.article layout="position" whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="group card overflow-hidden p-0">
      <div className="relative">
        <MiniaturaPost post={post} className="aspect-square w-full" />
        {pos && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-2xs font-bold text-white">{pos}</span>}
        {post.metricas.engajamento != null && (
          <span className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-2xs font-bold text-white shadow" style={{ background: 'linear-gradient(135deg, #d62976, #962fbf)' }}>
            {pct(post.metricas.engajamento)} eng.
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 min-h-[2.4rem] text-xs text-fg">{post.legenda || 'Sem legenda'}</p>
        <MetricasPost m={post.metricas} />
        <div className="flex items-center justify-between text-2xs text-muted">
          <span>{post.publicadoEm ? new Date(post.publicadoEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
          {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold hover:text-brand">Abrir <Icon name="external" size={10} /></a>}
        </div>
      </div>
    </motion.article>
  );
}

export function AbaPosts({ p }: { p: PainelRede }) {
  const [tipo, setTipo] = useState<string>('todos');
  const [ordem, setOrdem] = useState<Ordem>('recentes');
  const tipos = useMemo(() => [...new Set(p.posts.map((x) => x.tipo))], [p.posts]);
  const lista = useMemo(() => {
    const base = p.posts.filter((x) => tipo === 'todos' || x.tipo === tipo);
    const val = (x: PostRede): number => {
      const m = x.metricas;
      if (ordem === 'alcance') return m.alcance ?? -1;
      if (ordem === 'engajamento') return m.engajamento ?? -1;
      if (ordem === 'salvamentos') return m.salvamentos ?? -1;
      if (ordem === 'compartilhamentos') return m.compartilhamentos ?? -1;
      if (ordem === 'comentarios') return m.comentarios ?? -1;
      return x.publicadoEm ? new Date(x.publicadoEm).getTime() : 0;
    };
    return [...base].sort((a, b) => val(b) - val(a));
  }, [p.posts, tipo, ordem]);

  return (
    <div className="space-y-4">
      <AvisoSecao s={p.postsStatus} />
      {p.postsStatus.status === 'ok' && <AvisoSecao s={p.metricasPostStatus} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {['todos', ...tipos].map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)} className={cx('relative rounded-full px-3 py-1.5 text-xs font-semibold', tipo === t ? 'text-white' : 'border border-line text-muted hover:text-fg')}>
              {tipo === t && <motion.span layoutId="ig-filtro-tipo" className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(135deg, #d62976, #962fbf)' }} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{t === 'todos' ? `Todos (${p.posts.length})` : `${ROTULO_TIPO[t] ?? t} (${p.posts.filter((x) => x.tipo === t).length})`}</span>
            </button>
          ))}
        </div>
        <select className="input w-auto py-1.5 text-xs" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar posts">
          {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
        </select>
      </div>
      <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <AnimatePresence initial={false}>
          {lista.map((post) => (
            <motion.div key={post.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
              <CartaoPost post={post} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      {!lista.length && p.postsStatus.status === 'ok' && <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">Nenhum post neste filtro.</p>}
    </div>
  );
}

/* ================================ Engajamento ================================ */

export function AbaEngajamento({ p }: { p: PainelRede }) {
  const fmts = useMemo(() => porFormato(p.posts), [p.posts]);
  const grade = useMemo(() => gradeHorarios(p.posts), [p.posts]);
  const tags = useMemo(() => hashtags(p.posts), [p.posts]);
  const freq = useMemo(() => frequencia(p.posts), [p.posts]);
  const dia = useMemo(() => melhorDia(p.posts), [p.posts]);
  const maxEng = Math.max(...grade.map((c) => c.engajamentoMedio ?? 0), 0.01);
  const comInsights = p.posts.filter((x) => x.metricas.engajamento != null).length;

  if (!p.posts.length) return <AvisoSecao s={p.postsStatus.status === 'ok' ? { status: 'sem_dados', mensagem: 'Sem posts para analisar.' } : p.postsStatus} />;
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">Análise dos {p.posts.length} posts mais recentes ({comInsights} com insights). Horários no seu fuso.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { r: 'Posts por semana', v: freq.postsPorSemana, f: (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) },
          { r: 'Intervalo médio', v: freq.intervaloMedioDias, f: (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias` },
          { r: 'Último post', v: freq.diasDesdeUltimo, f: (x: number) => (Math.round(x) === 0 ? 'hoje' : `há ${Math.round(x)} dia(s)`) },
          { r: 'Melhor dia', v: dia?.engajamentoMedio ?? null, f: () => (dia ? DIAS_SEMANA[dia.dia] : '—') },
        ].map((k, i) => (
          <motion.div key={k.r} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
            <p className="text-xs text-muted">{k.r}</p>
            <p className="mt-1 text-xl font-semibold text-fg">{k.v == null ? <span className="text-sm text-muted">pouco histórico</span> : k.f(k.v)}</p>
            {k.r === 'Melhor dia' && dia && <p className="text-2xs text-muted">{pct(dia.engajamentoMedio)} de engajamento · {dia.posts} posts</p>}
          </motion.div>
        ))}
      </div>

      <Bloco titulo="Desempenho por formato" sub="Média por post de cada formato." icone="layout" i={1}>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-muted">
                <th className="py-2 font-semibold">Formato</th>
                <th className="py-2 text-right font-semibold">Posts</th>
                <th className="py-2 text-right font-semibold">Alcance médio</th>
                <th className="py-2 text-right font-semibold">Interações</th>
                <th className="py-2 text-right font-semibold">Salvos</th>
                <th className="py-2 text-right font-semibold">Compart.</th>
                <th className="py-2 text-right font-semibold">Engajamento</th>
              </tr>
            </thead>
            <tbody>
              {fmts.map((g, i) => (
                <tr key={g.tipo} className="border-b border-line last:border-0">
                  <td className="py-2.5 font-semibold text-fg">{i === 0 && g.engajamentoMedio != null && <Icon name="crown" size={13} className="mr-1 inline text-[#fa7e1e]" />}{g.rotulo}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted">{g.posts}</td>
                  <td className="py-2.5 text-right tabular-nums text-fg">{numeroCurto(g.alcanceMedio)}</td>
                  <td className="py-2.5 text-right tabular-nums text-fg">{numeroCurto(g.interacoesMedias)}</td>
                  <td className="py-2.5 text-right tabular-nums text-fg">{g.salvamentosMedios == null ? '—' : g.salvamentosMedios.toLocaleString('pt-BR')}</td>
                  <td className="py-2.5 text-right tabular-nums text-fg">{g.compartilhamentosMedios == null ? '—' : g.compartilhamentosMedios.toLocaleString('pt-BR')}</td>
                  <td className="py-2.5 text-right font-bold tabular-nums text-[#d62976]">{pct(g.engajamentoMedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bloco>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Bloco titulo="Quando seus posts engajam mais" sub="Engajamento médio por dia e faixa de horário da publicação. Número = posts na faixa." icone="clock" i={2}>
          <div className="overflow-x-auto scrollbar-thin">
            <div className="grid min-w-[460px] grid-cols-[36px_repeat(8,minmax(0,1fr))] gap-1 text-2xs">
              <span />
              {FAIXAS_HORA.map((h) => <span key={h} className="text-center text-muted">{h}</span>)}
              {DIAS_SEMANA.map((d, dia) => (
                <div key={d} className="contents">
                  <span className="flex items-center text-muted">{d}</span>
                  {grade.filter((c) => c.dia === dia).map((c) => {
                    const t = c.engajamentoMedio != null ? c.engajamentoMedio / maxEng : 0;
                    return (
                      <motion.div
                        key={`${c.dia}-${c.faixa}`}
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: (c.dia * 8 + c.faixa) * 0.006 }}
                        title={c.posts ? `${DIAS_SEMANA[c.dia]} ${FAIXAS_HORA[c.faixa]}: ${c.posts} post(s), ${pct(c.engajamentoMedio)} de engajamento` : 'Sem posts'}
                        className="flex h-8 items-center justify-center rounded-md font-semibold"
                        style={{ background: c.posts ? `rgba(214, 41, 118, ${0.12 + t * 0.78})` : 'var(--surface-3)', color: t > 0.55 ? '#fff' : 'var(--text)' }}
                      >
                        {c.posts || ''}
                      </motion.div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </Bloco>
        <Bloco titulo="Hashtags" sub="As mais usadas e o engajamento dos posts com elas." icone="tag" i={3}>
          {tags.length ? (
            <ul className="divide-y divide-line">
              {tags.map((t) => (
                <li key={t.tag} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span className="truncate font-semibold text-[#4f5bd5]">#{t.tag}</span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums text-muted">
                    <span>{t.usos}×</span>
                    <span className="w-20 whitespace-nowrap text-right">{numeroCurto(t.alcanceMedio)} alc.</span>
                    <b className="w-14 whitespace-nowrap text-right text-fg">{pct(t.engajamentoMedio)}</b>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-xs text-muted">Os posts recentes não usam hashtags.</p>
          )}
        </Bloco>
      </div>

      <Bloco titulo="Ranking completo" sub="Todos os posts recentes pelo engajamento." icone="trophy" i={4}>
        <ul className="divide-y divide-line">
          {[...p.posts].sort((a, b) => (b.metricas.engajamento ?? -1) - (a.metricas.engajamento ?? -1) || interacoes(b) - interacoes(a)).map((post, i) => (
            <li key={post.id} className="flex items-center gap-3 py-2.5">
              <span className="w-6 text-center text-xs font-bold text-muted">{i + 1}</span>
              <MiniaturaPost post={post} className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-fg">{post.legenda || 'Sem legenda'}</p>
                <MetricasPost m={post.metricas} />
              </div>
              <b className="shrink-0 text-xs tabular-nums text-[#d62976]">{pct(post.metricas.engajamento)}</b>
              {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-brand" aria-label="Abrir no Instagram"><Icon name="external" size={14} /></a>}
            </li>
          ))}
        </ul>
      </Bloco>
    </div>
  );
}

/* ================================ Público ================================ */

export function AbaPublico({ pub, carregando }: { pub: PublicoInstagram | null; carregando: boolean }) {
  if (carregando && !pub) return <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">Carregando o público…</p>;
  if (!pub) return <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">Não consegui carregar o público agora.</p>;
  const s = pub.publico.status;
  return (
    <div className="space-y-5">
      <AvisoSecao s={s} />
      {s.status === 'ok' && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Bloco titulo="Gênero" sub="Seguidores neste mês (Meta)." icone="users" i={0}>
              <BarraDividida fatias={pub.publico.genero} cores={['#d62976', '#4f5bd5', '#9ca3af']} />
            </Bloco>
            <Bloco titulo="Idade" sub="Faixas de idade dos seguidores." icone="user" i={1}>
              <Barras itens={pub.publico.idade} porcentagem cor="linear-gradient(90deg, #fa7e1e, #d62976)" />
            </Bloco>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Bloco titulo="Cidades" sub="Top 10 cidades dos seguidores." icone="mapPin" i={2}>
              <Barras itens={pub.publico.cidades.map((c) => ({ rotulo: nomeCidade(c.rotulo), valor: c.valor }))} porcentagem cor="#962fbf" />
            </Bloco>
            <Bloco titulo="Países" sub="Top 10 países." icone="globe" i={3}>
              <Barras itens={pub.publico.paises.map((c) => ({ rotulo: nomePais(c.chave), valor: c.valor }))} porcentagem cor="#4f5bd5" />
            </Bloco>
          </div>
          <p className="text-2xs text-faint">Fonte: Instagram (follower_demographics). A Meta só mostra os 45 maiores grupos e só para contas com 100+ seguidores.</p>
        </>
      )}
    </div>
  );
}

/* ================================ Publicações ================================ */

const STATUS_PUB: Record<Publicacao['status'], { label: string; tone: 'green' | 'amber' | 'brand' | 'neutral' }> = {
  agendado: { label: 'agendado', tone: 'brand' },
  publicando: { label: 'publicando', tone: 'amber' },
  processando: { label: 'processando', tone: 'amber' },
  publicado: { label: 'publicado', tone: 'green' },
  erro: { label: 'erro', tone: 'amber' },
  cancelado: { label: 'cancelado', tone: 'neutral' },
};

export function AbaPublicacoes({ p, pubs, onNova, onCancelar }: { p: PainelRede; pubs: Publicacao[] | null; onNova: () => void; onCancelar: (x: Publicacao) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Posts e Reels publicados ou agendados pelo KHUB nesta conta.</p>
        {p.publicacao.disponivel ? <Button size="sm" icon="plus" onClick={onNova}>Nova publicação</Button> : <span className="text-xs text-muted" title={p.publicacao.faltando?.join(', ')}>{p.publicacao.motivo}</span>}
      </div>
      <div className="card divide-y divide-line p-0">
        {pubs?.map((x) => {
          const st = STATUS_PUB[x.status];
          return (
            <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{x.legenda || x.midiaUrl}</p>
                <p className="text-2xs text-muted">{x.formato} · {x.status === 'publicado' && x.publicadoEm ? `publicado em ${new Date(x.publicadoEm).toLocaleString('pt-BR')}` : `para ${new Date(x.agendadoPara).toLocaleString('pt-BR')}`}</p>
                {x.erro && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{x.erro}</p>}
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
              {x.permalink && <a href={x.permalink} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand">Ver post</a>}
              {x.status === 'agendado' && <Button variant="ghost" size="sm" onClick={() => onCancelar(x)}>Cancelar</Button>}
            </div>
          );
        })}
        {pubs && !pubs.length && <p className="px-4 py-8 text-center text-sm text-muted">Nenhuma publicação feita pelo KHUB ainda.</p>}
        {!pubs && <p className="px-4 py-8 text-center text-sm text-muted">Carregando…</p>}
      </div>
    </div>
  );
}

