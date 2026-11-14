'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button, Confirm, Select, SkeletonCards, Tabs, TabPanel, useToast } from '@/components/kit';
import { GraficoSerie } from '@/components/redes/GraficoSerie';
import { PublicarModal } from '@/components/redes/PublicarModal';
import { ApiError } from '@/lib/api-error';
import { REDES, numeroCurto, redesApi, type EstadoRede, type Kpi, type PainelRede, type PostRede, type Publicacao, type RedeSocial, type SecaoStatus } from '@/lib/redes';

const INTEGRACOES = '/configuracoes?tab=integracoes';
const NOME: Record<RedeSocial, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
const ehRede = (v: string | null): v is RedeSocial => v === 'instagram' || v === 'tiktok' || v === 'youtube';

const STATUS_PUB: Record<Publicacao['status'], { label: string; tone: 'green' | 'amber' | 'brand' | 'neutral' }> = {
  agendado: { label: 'agendado', tone: 'brand' },
  publicando: { label: 'publicando', tone: 'amber' },
  processando: { label: 'processando na rede', tone: 'amber' },
  publicado: { label: 'publicado', tone: 'green' },
  erro: { label: 'erro', tone: 'amber' },
  cancelado: { label: 'cancelado', tone: 'neutral' },
};

function valorKpi(k: Kpi): string {
  if (k.valor == null) return 'sem dado';
  if (k.formato === 'percentual') return `${k.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (k.formato === 'minutos') return `${numeroCurto(k.valor)} min`;
  return numeroCurto(k.valor);
}

/** Aviso de uma seção que a rede bloqueou: diz o motivo e o que falta, com o caminho para resolver. */
function AvisoSecao({ s, rede }: { s: SecaoStatus; rede: RedeSocial }) {
  if (s.status === 'ok' && !s.mensagem) return null;
  if (s.status === 'sem_dados' && !s.mensagem) return null;
  const grave = s.status === 'sem_permissao' || s.status === 'token' || s.status === 'config' || s.status === 'erro';
  return (
    <div className={cx('rounded-xl px-4 py-3 text-sm', grave ? 'border border-amber-400/40 bg-amber-400/10 text-amber-800 dark:text-amber-200' : 'bg-surface2 text-muted')}>
      <p>{s.mensagem}</p>
      {s.faltando?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {s.faltando.map((f) => <li key={f} className="rounded-md bg-amber-400/20 px-1.5 py-0.5 font-mono text-[11px]">{f}</li>)}
        </ul>
      ) : null}
      {(s.status === 'sem_permissao' || s.status === 'token') && (
        <p className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
          <Link href={INTEGRACOES} className="underline">Reconectar {NOME[rede]}</Link>
          {s.doc && <a href={s.doc} target="_blank" rel="noopener noreferrer" className="underline">Documentação oficial</a>}
        </p>
      )}
    </div>
  );
}

function Metricas({ m, compacto }: { m: PostRede['metricas']; compacto?: boolean }) {
  const itens: [string, number | null, string][] = [
    ['eye', m.visualizacoes, 'Visualizações'],
    ['users', m.alcance, 'Alcance'],
    ['star', m.curtidas, 'Curtidas'],
    ['chat', m.comentarios, 'Comentários'],
    ['send', m.compartilhamentos, 'Compartilhamentos'],
    ['tag', m.salvamentos, 'Salvamentos'],
  ];
  const visiveis = itens.filter(([, v]) => v != null);
  return (
    <div className={cx('flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted', compacto && 'gap-x-2')}>
      {visiveis.map(([icone, v, rotulo]) => (
        <span key={rotulo} title={rotulo} className="inline-flex items-center gap-1">
          <Icon name={icone as 'eye'} size={12} /> {numeroCurto(v)}
          <span className="sr-only">{rotulo}</span>
        </span>
      ))}
      {m.engajamento != null && <span className="font-semibold text-fg" title="Taxa de engajamento">{m.engajamento.toLocaleString('pt-BR')}% eng.</span>}
      {!visiveis.length && m.engajamento == null && <span>sem métricas</span>}
    </div>
  );
}

function Miniatura({ post, className }: { post: PostRede; className?: string }) {
  const [quebrou, setQuebrou] = useState(false);
  return (
    <div className={cx('relative overflow-hidden bg-surface2', className)}>
      {post.miniatura && !quebrou ? (
        // URLs de CDN das redes (expiram): <img> simples, sem otimização do Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.miniatura} alt="" loading="lazy" onError={() => setQuebrou(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted"><Icon name={post.tipo === 'imagem' ? 'file' : 'video'} size={22} /></div>
      )}
      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">{post.tipo}</span>
    </div>
  );
}

function PainelConectado({ p, onConta, dias, onDias, recarregar }: { p: PainelRede; onConta: (id: string) => void; dias: number; onDias: (d: number) => void; recarregar: () => void }) {
  const toast = useToast();
  const [publicar, setPublicar] = useState(false);
  const [pubs, setPubs] = useState<Publicacao[] | null>(null);
  const [cancelar, setCancelar] = useState<Publicacao | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const carregarPubs = useCallback(() => {
    redesApi.publicacoes(p.rede).then(setPubs).catch(() => setPubs([]));
  }, [p.rede]);
  useEffect(() => { carregarPubs(); }, [carregarPubs]);

  const confirmarCancelamento = async () => {
    if (!cancelar) return;
    setCancelando(true);
    try {
      await redesApi.cancelar(cancelar.id);
      toast.success('Agendamento cancelado.');
      carregarPubs();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não consegui cancelar.');
    } finally {
      setCancelando(false);
      setCancelar(null);
    }
  };

  const conta = p.conta;
  const rotuloAlcance = p.rede === 'instagram' ? 'Alcance diário' : 'Visualizações por dia';
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-white">
          {conta?.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conta.foto} alt="" className="h-full w-full object-cover" />
          ) : (
            <BrandLogo brand={p.rede} size={28} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-fg">{conta?.usuario ?? conta?.nome ?? p.contas[0]?.nome}</p>
          <p className="text-xs text-muted">
            {conta?.seguidores != null ? `${numeroCurto(conta.seguidores)} ${p.rede === 'youtube' ? 'inscritos' : 'seguidores'}` : 'seguidores sem dado'}
            {conta?.publicacoes != null ? ` · ${numeroCurto(conta.publicacoes)} ${p.rede === 'instagram' ? 'publicações' : 'vídeos'}` : ''}
          </p>
        </div>
        {p.contas.length > 1 && (
          <div className="w-56"><Select size="sm" value={conta?.conexaoId ?? p.contas[0].id} onChange={onConta} options={p.contas.filter((c) => c.status === 'conectado').map((c) => ({ value: c.id, label: c.nome }))} aria-label="Conta" /></div>
        )}
        <div className="w-36"><Select size="sm" value={String(dias)} onChange={(v) => onDias(Number(v))} options={[{ value: '7', label: 'Últimos 7 dias' }, { value: '14', label: 'Últimos 14 dias' }, { value: '28', label: 'Últimos 28 dias' }]} aria-label="Período" /></div>
        <Button variant="secondary" size="sm" icon="refresh" onClick={recarregar}>Atualizar</Button>
        {p.publicacao.disponivel ? (
          <Button size="sm" icon="plus" onClick={() => setPublicar(true)}>Nova publicação</Button>
        ) : (
          <span className="text-xs text-muted" title={p.publicacao.faltando?.join(', ')}>{p.publicacao.motivo}</span>
        )}
      </Card>

      <section aria-label="Indicadores" className="space-y-3">
        <AvisoSecao s={p.kpisStatus} rede={p.rede} />
        {p.kpis.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {p.kpis.map((k) => (
              <Card key={k.chave} className="p-4">
                <p className="text-xs font-medium text-muted">{k.rotulo}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <p className={cx('text-2xl font-semibold', k.valor == null ? 'text-muted' : 'text-fg')}>{valorKpi(k)}</p>
                  {k.variacao != null && (
                    <span className={cx('inline-flex items-center gap-0.5 text-xs font-semibold', k.variacao >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      <Icon name={k.variacao >= 0 ? 'arrowUp' : 'arrowDown'} size={12} /> {Math.abs(k.variacao).toLocaleString('pt-BR')}%
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-bold text-fg">{p.rede === 'youtube' ? 'Inscritos' : 'Seguidores'}</h2>
          <p className="mb-3 text-xs text-muted">{p.crescimento.fonteSeguidores === 'rede' ? 'Calculado pelo YouTube Analytics.' : 'Uma foto por dia registrada pelo KHUB.'}</p>
          {p.crescimento.seguidores.length >= 2 ? <GraficoSerie titulo="Seguidores por dia" serie={p.crescimento.seguidores} /> : <AvisoSecao s={p.crescimento.status.mensagem ? p.crescimento.status : { status: 'sem_dados', mensagem: 'Ainda sem histórico suficiente para a curva.' }} rede={p.rede} />}
        </Card>
        <Card className="p-5">
          <h2 className="font-bold text-fg">{rotuloAlcance}</h2>
          <p className="mb-3 text-xs text-muted">Últimos {p.periodoDias} dias.</p>
          {p.crescimento.alcance.length >= 2 ? (
            <GraficoSerie titulo={rotuloAlcance} serie={p.crescimento.alcance} />
          ) : (
            <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">{p.rede === 'tiktok' ? 'A API do TikTok não oferece série diária de visualizações da conta.' : p.kpisStatus.status === 'ok' ? 'Sem dados diários no período.' : 'Indisponível: veja o aviso dos indicadores acima.'}</p>
          )}
        </Card>
      </div>

      <section aria-label="Melhores posts">
        <h2 className="mb-3 font-bold text-fg">Melhores posts</h2>
        {p.ranking.length ? (
          <Card className="divide-y divide-line p-0">
            {p.ranking.map((post, i) => (
              <div key={post.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-center text-sm font-bold text-muted">{i + 1}</span>
                <Miniatura post={post} className="h-14 w-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{post.legenda || 'Sem legenda'}</p>
                  <Metricas m={post.metricas} compacto />
                </div>
                {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-brand" aria-label="Abrir na rede"><Icon name="external" size={16} /></a>}
              </div>
            ))}
          </Card>
        ) : (
          <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">Sem posts com métricas para ranquear.</p>
        )}
      </section>

      <section aria-label="Posts" className="space-y-3">
        <h2 className="font-bold text-fg">Posts recentes</h2>
        <AvisoSecao s={p.postsStatus} rede={p.rede} />
        {p.postsStatus.status === 'ok' && <AvisoSecao s={p.metricasPostStatus} rede={p.rede} />}
        {p.posts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {p.posts.map((post) => (
              <Card key={post.id} className="overflow-hidden p-0">
                <Miniatura post={post} className="aspect-square w-full" />
                <div className="space-y-2 p-3">
                  <p className="line-clamp-2 min-h-[2.5rem] text-sm text-fg">{post.legenda || 'Sem legenda'}</p>
                  <Metricas m={post.metricas} />
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>{post.publicadoEm ? new Date(post.publicadoEm).toLocaleDateString('pt-BR') : ''}</span>
                    {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand">Abrir</a>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          p.postsStatus.status === 'ok' && <p className="rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">Nenhum post nesta conta ainda.</p>
        )}
      </section>

      <section aria-label="Publicações do KHUB">
        <h2 className="mb-3 font-bold text-fg">Publicações pelo KHUB</h2>
        <Card className="divide-y divide-line p-0">
          {pubs?.map((pub) => {
            const st = STATUS_PUB[pub.status];
            return (
              <div key={pub.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{pub.titulo || pub.legenda || pub.midiaUrl}</p>
                  <p className="text-[11px] text-muted">
                    {pub.formato} · {pub.status === 'publicado' && pub.publicadoEm ? `publicado em ${new Date(pub.publicadoEm).toLocaleString('pt-BR')}` : `para ${new Date(pub.agendadoPara).toLocaleString('pt-BR')}`}
                  </p>
                  {pub.erro && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{pub.erro}</p>}
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                {pub.permalink && <a href={pub.permalink} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand">Ver post</a>}
                {pub.status === 'agendado' && <Button variant="ghost" size="sm" onClick={() => setCancelar(pub)}>Cancelar</Button>}
              </div>
            );
          })}
          {pubs && !pubs.length && <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma publicação feita pelo KHUB nesta rede.</p>}
          {!pubs && <p className="px-4 py-6 text-center text-sm text-muted">Carregando…</p>}
        </Card>
      </section>

      {publicar && conta && <PublicarModal painel={p} aberto={publicar} onFechar={() => setPublicar(false)} onCriada={carregarPubs} />}
      <Confirm
        open={!!cancelar}
        onClose={() => setCancelar(null)}
        onConfirm={confirmarCancelamento}
        loading={cancelando}
        confirmLabel="Cancelar agendamento"
        cancelLabel="Voltar"
        title="Cancelar o agendamento?"
        description="A publicação não vai sair. Para publicar depois, crie de novo."
      />
    </div>
  );
}

export default function RedesPage() {
  const toast = useToast();
  const router = useRouter();
  const [rede, setRede] = useState<RedeSocial>('instagram');
  const [estado, setEstado] = useState<EstadoRede[] | null>(null);
  const [painel, setPainel] = useState<PainelRede | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [conexaoId, setConexaoId] = useState<string | undefined>(undefined);
  const [dias, setDias] = useState(28);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get('rede');
    if (ehRede(r)) setRede(r);
    if (q.get('conectado')) toast.success(`${ehRede(r) ? NOME[r] : 'Rede'} conectado.`, q.get('aviso') ? { description: q.get('aviso') ?? undefined } : undefined);
    else if (q.get('erro')) toast.error(`Não consegui conectar: ${q.get('erro')}`);
    if (q.get('conectado') || q.get('erro')) window.history.replaceState(null, '', '/redes');
    redesApi.estado().then(setEstado).catch(() => setEstado(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    redesApi
      .painel(rede, conexaoId, dias)
      .then(setPainel)
      .catch((e) => {
        setPainel(null);
        setErro(e instanceof ApiError && e.status === 403 ? 'Você não tem acesso às redes sociais desta conta.' : 'Não consegui carregar o painel desta rede.');
      })
      .finally(() => setCarregando(false));
  }, [rede, conexaoId, dias]);
  useEffect(() => { carregar(); }, [carregar]);

  const trocarRede = (r: RedeSocial) => {
    setConexaoId(undefined);
    setPainel(null);
    setRede(r);
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div>
        <h1 className="t-display">Redes sociais</h1>
        <p className="mt-1 text-sm text-muted">Posts, métricas, crescimento e publicação do Instagram, TikTok e YouTube desta conta. Só dados reais das redes conectadas.</p>
      </div>

      <Tabs
        idBase="redes"
        label="Rede social"
        value={rede}
        onChange={trocarRede}
        items={REDES.map((r) => ({
          value: r.rede,
          label: (
            <span className="inline-flex items-center gap-2">
              <BrandLogo brand={r.rede} size={16} /> {r.nome}
              {estado?.find((e) => e.rede === r.rede)?.conectado && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="conectado" />}
            </span>
          ),
        }))}
      />

      {REDES.map((r) => (
        <TabPanel key={r.rede} idBase="redes" value={r.rede} active={rede === r.rede}>
          {carregando && !painel ? (
            <SkeletonCards count={6} label={`Carregando ${r.nome}`} />
          ) : erro ? (
            <p className="flex items-center gap-2 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
              <Icon name="alert" size={15} /> {erro}
              <button onClick={carregar} className="ml-auto font-semibold underline">Tentar de novo</button>
            </p>
          ) : painel && painel.rede === r.rede && !painel.conectado ? (
            <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-line bg-white shadow-sm dark:bg-white/90"><BrandLogo brand={r.rede} size={36} /></span>
              <div>
                <p className="text-lg font-bold text-fg">{r.nome} não está conectado nesta conta</p>
                <p className="mt-1 text-sm text-muted">Conecte em Integrações para ver posts, métricas e crescimento.</p>
              </div>
              <Button icon="link" onClick={() => router.push(INTEGRACOES)}>Conectar {r.nome}</Button>
            </Card>
          ) : painel && painel.rede === r.rede ? (
            <PainelConectado p={painel} onConta={setConexaoId} dias={dias} onDias={setDias} recarregar={carregar} />
          ) : null}
        </TabPanel>
      ))}
    </div>
  );
}
