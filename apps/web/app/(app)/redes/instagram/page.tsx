'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button, Confirm, Select, SkeletonCards, Tabs, TabPanel, useToast } from '@/components/kit';
import { PublicarModal } from '@/components/redes/PublicarModal';
import { AbaEngajamento, AbaPosts, AbaPublicacoes, AbaPublico, AbaVisaoGeral } from '@/components/redes/instagram/Abas';
import { Contador, GRADIENTE_IG } from '@/components/redes/instagram/partes';
import { ApiError } from '@/lib/api-error';
import { numeroCurto, redesApi, type PainelRede, type Publicacao } from '@/lib/redes';
import { instagramApi, type PublicoInstagram } from '@/lib/redes-instagram';

type Aba = 'visao' | 'posts' | 'engajamento' | 'publico' | 'publicacoes';
const ABAS: { value: Aba; label: string }[] = [
  { value: 'visao', label: 'Visão geral' },
  { value: 'posts', label: 'Posts' },
  { value: 'engajamento', label: 'Engajamento' },
  { value: 'publico', label: 'Público' },
  { value: 'publicacoes', label: 'Publicações' },
];
const INTEGRACOES = '/configuracoes?tab=integracoes';

/**
 * Gestão do Instagram da subconta (aberta por Conversas › Instagram ›
 * "Gerenciar redes"): perfil, indicadores, crescimento, posts com métricas,
 * análise de engajamento (formato, dia/horário, hashtags, frequência),
 * público (idade, gênero, cidades, países), botões do perfil e publicações.
 * Tudo dado real da Graph API da conta conectada; seção sem permissão diz o
 * que falta.
 */
export default function InstagramPage() {
  const router = useRouter();
  const toast = useToast();
  const [aba, setAba] = useState<Aba>('visao');
  const [dias, setDias] = useState(28);
  const [conexaoId, setConexaoId] = useState<string | undefined>(undefined);
  const [painel, setPainel] = useState<PainelRede | null>(null);
  const [pub, setPub] = useState<PublicoInstagram | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoPub, setCarregandoPub] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pubs, setPubs] = useState<Publicacao[] | null>(null);
  const [publicar, setPublicar] = useState(false);
  const [cancelar, setCancelar] = useState<Publicacao | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    setCarregandoPub(true);
    setErro(null);
    redesApi
      .painel('instagram', conexaoId, dias)
      .then(setPainel)
      .catch((e) => {
        setPainel(null);
        setErro(e instanceof ApiError && e.status === 403 ? 'Você não tem acesso às redes sociais desta conta.' : 'Não consegui carregar o Instagram agora.');
      })
      .finally(() => setCarregando(false));
    instagramApi.publico(conexaoId, dias).then(setPub).catch(() => setPub(null)).finally(() => setCarregandoPub(false));
    redesApi.publicacoes('instagram').then(setPubs).catch(() => setPubs([]));
  }, [conexaoId, dias]);
  useEffect(() => { carregar(); }, [carregar]);

  const confirmarCancelamento = async () => {
    if (!cancelar) return;
    setCancelando(true);
    try {
      await redesApi.cancelar(cancelar.id);
      toast.success('Agendamento cancelado.');
      redesApi.publicacoes('instagram').then(setPubs).catch(() => undefined);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não consegui cancelar.');
    } finally {
      setCancelando(false);
      setCancelar(null);
    }
  };

  const conta = painel?.conta;
  const usuario = conta?.usuario?.replace(/^@/, '') ?? null;
  const engMedio = painel?.kpis.find((k) => k.chave === 'engajamento')?.valor ?? null;
  const alcance = painel?.kpis.find((k) => k.chave === 'alcance')?.valor ?? null;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link href="/conversas?canal=Instagram" className="inline-flex items-center gap-1 hover:text-brand"><Icon name="chevronRight" size={13} className="rotate-180" /> Conversas</Link>
        <span>·</span>
        <Link href="/redes?rede=instagram" className="hover:text-brand">Redes sociais</Link>
      </div>

      {/* Perfil */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden p-5">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-[0.16] blur-3xl" style={{ background: GRADIENTE_IG }} />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="relative h-16 w-16 shrink-0 sm:h-[88px] sm:w-[88px]">
            <motion.span aria-hidden className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 0deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5, #feda75)` }} animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} />
            <span className="absolute inset-[3px] overflow-hidden rounded-full border-[3px] border-[var(--surface)] bg-white">
              {conta?.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={conta.foto} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center"><BrandLogo brand="instagram" size={36} /></span>
              )}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="t-display truncate max-sm:text-[22px]">{usuario ? `@${usuario}` : 'Instagram'}</h1>
              {painel?.conectado && <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-2xs font-semibold text-emerald-600 dark:text-emerald-400">conectado</span>}
            </div>
            {conta?.nome && usuario && conta.nome !== usuario && <p className="text-sm text-muted">{conta.nome}</p>}
            <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                { r: 'seguidores', v: conta?.seguidores },
                { r: 'publicações', v: conta?.publicacoes },
                { r: `alcance (${dias} dias)`, v: alcance },
              ].map((x) => (
                <span key={x.r}><b className="text-lg font-bold tabular-nums text-fg"><Contador valor={x.v ?? null} /></b> <span className="text-muted">{x.r}</span></span>
              ))}
              {engMedio != null && <span><b className="text-lg font-bold tabular-nums text-[#d62976]">{engMedio.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</b> <span className="text-muted">engajamento médio</span></span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon="chat" onClick={() => router.push('/conversas?canal=Instagram')}>Direct</Button>
            {usuario && <a href={`https://www.instagram.com/${encodeURIComponent(usuario)}/`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><Icon name="external" size={14} /> Perfil</a>}
            {painel?.publicacao.disponivel && <Button size="sm" icon="plus" onClick={() => setPublicar(true)}>Nova publicação</Button>}
          </div>
        </div>
        {painel?.conectado && (
          <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {painel.contas.length > 1 && (
              <div className="w-56"><Select size="sm" value={conta?.conexaoId ?? painel.contas[0].id} onChange={(v) => setConexaoId(v)} options={painel.contas.filter((c) => c.status === 'conectado').map((c) => ({ value: c.id, label: c.nome }))} aria-label="Conta" /></div>
            )}
            <div className="w-40"><Select size="sm" value={String(dias)} onChange={(v) => setDias(Number(v))} options={[{ value: '7', label: 'Últimos 7 dias' }, { value: '14', label: 'Últimos 14 dias' }, { value: '28', label: 'Últimos 28 dias' }]} aria-label="Período" /></div>
            <Button variant="ghost" size="sm" icon="refresh" onClick={carregar} disabled={carregando}>Atualizar</Button>
            <span className="ml-auto text-2xs text-muted">Dados da API oficial do Instagram (Meta). Seguidores registrados 1× por dia.</span>
          </div>
        )}
      </motion.div>

      {carregando && !painel ? (
        <SkeletonCards count={8} label="Carregando Instagram" />
      ) : erro ? (
        <p className="flex items-center gap-2 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert" size={15} /> {erro}
          <button type="button" onClick={carregar} className="ml-auto font-semibold underline">Tentar de novo</button>
        </p>
      ) : painel && !painel.conectado ? (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="card flex flex-col items-center gap-4 px-6 py-14 text-center">
          <motion.span animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm"><BrandLogo brand="instagram" size={36} /></motion.span>
          <div>
            <p className="text-lg font-bold text-fg">O Instagram desta conta ainda não está conectado</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Conecte a conta profissional do Instagram para ver métricas, posts, engajamento, público e publicar daqui. O Direct passa a cair em Conversas.</p>
          </div>
          <Button icon="link" onClick={() => router.push(INTEGRACOES)}>Conectar Instagram</Button>
        </motion.div>
      ) : painel ? (
        <>
          <Tabs idBase="ig" label="Gestão do Instagram" value={aba} onChange={setAba} items={ABAS.map((a) => ({ ...a, count: a.value === 'posts' ? painel.posts.length : a.value === 'publicacoes' ? pubs?.length : undefined }))} />
          <div className={cx(carregando && 'pointer-events-none opacity-60 transition-opacity')}>
            <TabPanel idBase="ig" value="visao" active={aba === 'visao'}><AbaVisaoGeral p={painel} pub={pub} onAba={setAba} /></TabPanel>
            <TabPanel idBase="ig" value="posts" active={aba === 'posts'}><AbaPosts p={painel} /></TabPanel>
            <TabPanel idBase="ig" value="engajamento" active={aba === 'engajamento'}><AbaEngajamento p={painel} /></TabPanel>
            <TabPanel idBase="ig" value="publico" active={aba === 'publico'}><AbaPublico pub={pub} carregando={carregandoPub} /></TabPanel>
            <TabPanel idBase="ig" value="publicacoes" active={aba === 'publicacoes'}><AbaPublicacoes p={painel} pubs={pubs} onNova={() => setPublicar(true)} onCancelar={setCancelar} /></TabPanel>
          </div>
          <p className="text-2xs text-faint">Seguidores: {numeroCurto(conta?.seguidores)} · período {painel.periodoDias} dias · análise de conteúdo nos {painel.posts.length} posts mais recentes.</p>
        </>
      ) : null}

      {publicar && painel?.conta && <PublicarModal painel={painel} aberto={publicar} onFechar={() => setPublicar(false)} onCriada={() => redesApi.publicacoes('instagram').then(setPubs).catch(() => undefined)} />}
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
