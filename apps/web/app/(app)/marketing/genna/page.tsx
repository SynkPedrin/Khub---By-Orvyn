'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { Button, Confirm, SkeletonCards, TabPanel, Tabs, useToast } from '@/components/kit';
import { useAuth } from '@/lib/auth';
import { codigoErroGenna, gennaApi, mensagemErroGenna, type ClasseFerramenta, type FerramentaGenna as Ferramenta, type StatusGenna } from '@/lib/genna';
import { FerramentaGenna } from '@/components/marketing/genna/FerramentaGenna';

const ID_ABAS = 'genna';
const ABAS: { value: ClasseFerramenta; label: string; vazio: string }[] = [
  { value: 'leitura', label: 'Métricas e conteúdos', vazio: 'O Genna não ofereceu consultas para esta conta.' },
  { value: 'escrita', label: 'Criar', vazio: 'O Genna não ofereceu ferramentas de criação para esta conta.' },
  { value: 'publicacao', label: 'Publicar', vazio: 'O Genna não ofereceu publicação para esta conta.' },
];

/**
 * Instagram do cliente pelo Genna (ADR-0053): métricas, conteúdos, radar do
 * nicho, criação e publicação. As ferramentas vêm do próprio Genna (MCP
 * `tools/list`), então o painel acompanha o que o Genna oferecer.
 */
export default function GennaPage() {
  const { user } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role ?? '');
  const toast = useToast();
  const [status, setStatus] = useState<StatusGenna | null>(null);
  const [ferramentas, setFerramentas] = useState<Ferramenta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<ClasseFerramenta>('leitura');
  const [busca, setBusca] = useState('');
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  const carregarFerramentas = useCallback(async (renovar = false) => {
    setAtualizando(true);
    try {
      setFerramentas(await gennaApi.ferramentas(renovar));
      setErro(null);
    } catch (e) {
      setFerramentas([]);
      setErro(mensagemErroGenna(e, 'Não consegui ler as ferramentas do Genna.'));
      // Token recusado no meio do caminho: a conexão caiu, volta para o "Conectar".
      if (codigoErroGenna(e) === 'genna_nao_conectado') gennaApi.status().then(setStatus).catch(() => undefined);
    } finally {
      setAtualizando(false);
    }
  }, []);

  const carregar = useCallback(() => {
    setErro(null);
    gennaApi
      .status()
      .then((s) => {
        setStatus(s);
        if (s.conectado) void carregarFerramentas();
      })
      .catch((e) => setErro(mensagemErroGenna(e, 'Não consegui verificar a conexão com o Genna.')));
  }, [carregarFerramentas]);

  useEffect(() => {
    carregar();
    // Retorno do OAuth (app/api/integrations/genna/callback).
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get('erro');
    if (sp.get('conectado')) toast.success('Genna conectado.');
    if (e) toast.error('Conexão com o Genna não concluída', { description: e });
    if (e || sp.get('conectado')) window.history.replaceState(null, '', '/marketing/genna');
    // toast é estável (contexto); roda uma vez na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar]);

  const conectar = async () => {
    setConectando(true);
    try {
      const { url } = await gennaApi.urlConexao();
      window.location.href = url;
    } catch (e) {
      toast.error(mensagemErroGenna(e, 'Não consegui iniciar a autorização no Genna.'));
      setConectando(false);
    }
  };

  const desconectar = async () => {
    setDesconectando(true);
    try {
      await gennaApi.desconectar();
      toast.success('Genna desconectado desta conta.');
      setConfirmarDesconexao(false);
      setFerramentas(null);
      carregar();
    } catch (e) {
      toast.error(mensagemErroGenna(e, 'Não consegui desconectar.'));
    } finally {
      setDesconectando(false);
    }
  };

  const porClasse = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const m: Record<ClasseFerramenta, Ferramenta[]> = { leitura: [], escrita: [], publicacao: [] };
    for (const f of ferramentas ?? []) {
      if (termo && !`${f.nome} ${f.titulo} ${f.descricao}`.toLowerCase().includes(termo)) continue;
      m[f.classe].push(f);
    }
    return m;
  }, [ferramentas, busca]);

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90">
            <BrandLogo brand="instagram" size={26} />
          </span>
          <div>
            <h1 className="t-display">Instagram com Genna</h1>
            <p className="mt-1 text-sm text-muted">Métricas do perfil e dos posts, formatos que funcionam, radar do nicho, criação e publicação.</p>
          </div>
        </div>
        {status?.conectado && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon="refresh" loading={atualizando} onClick={() => carregarFerramentas(true)}>Atualizar</Button>
            {admin && <Button variant="ghost" size="sm" onClick={() => setConfirmarDesconexao(true)}>Desconectar</Button>}
          </div>
        )}
      </div>

      {erro && (
        <p role="alert" className="flex items-center gap-2 rounded-xl bg-danger/5 px-4 py-2.5 text-sm text-danger">
          <Icon name="alert" size={15} /> {erro}
          <button onClick={carregar} className="ml-auto font-semibold underline">Tentar de novo</button>
        </p>
      )}

      {!status && !erro && <SkeletonCards count={3} label="Verificando conexão com o Genna" />}

      {status && !status.configurado && <ConfigRequired provider="genna" missing={status.missing} />}

      {status && status.configurado && !status.conectado && (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90">
            <BrandLogo brand="instagram" size={34} />
          </span>
          <div className="max-w-md">
            <h2 className="text-lg font-bold text-fg">Conecte o Genna desta conta</h2>
            <p className="mt-1.5 text-sm text-muted">
              {status.status === 'error' && status.erro
                ? status.erro
                : 'Entre com a conta Genna do cliente para ver as métricas do Instagram, analisar os conteúdos e criar posts. Publicar sempre passa por aprovação na NICO.'}
            </p>
          </div>
          {admin ? (
            <Button variant="primary" icon="link" loading={conectando} onClick={conectar}>Conectar Genna</Button>
          ) : (
            <p className="text-xs text-muted">Peça a um administrador da conta para conectar o Genna.</p>
          )}
        </Card>
      )}

      {status?.conectado && (
        <>
          {!status.podePublicar && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              <Icon name="info" size={16} className="mt-0.5 shrink-0" /> A conta Genna foi conectada sem a permissão de publicar. Para publicar pelo KHUB, desconecte e conecte de novo aprovando todas as permissões.
            </p>
          )}
          {ferramentas === null ? (
            <SkeletonCards count={4} label="Lendo as ferramentas do Genna" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Tabs<ClasseFerramenta>
                  idBase={ID_ABAS}
                  label="O que fazer no Genna"
                  value={aba}
                  onChange={setAba}
                  items={ABAS.map((a) => ({ value: a.value, label: `${a.label} (${porClasse[a.value].length})` }))}
                />
                <div className="relative ml-auto w-full sm:w-72">
                  <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input className="input pl-9" placeholder="Buscar ferramenta" aria-label="Buscar ferramenta do Genna" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
              </div>
              {ABAS.map((a) => (
                <TabPanel key={a.value} idBase={ID_ABAS} value={a.value} active={aba === a.value}>
                  {aba === a.value && (
                    <div className="space-y-3">
                      {porClasse[a.value].length === 0 ? (
                        <Card className="px-6 py-10 text-center text-sm text-muted">{busca ? 'Nenhuma ferramenta com esse termo.' : a.vazio}</Card>
                      ) : (
                        porClasse[a.value].map((f) => <FerramentaGenna key={f.nome} f={f} admin={admin} />)
                      )}
                    </div>
                  )}
                </TabPanel>
              ))}
            </>
          )}
        </>
      )}

      <Confirm
        open={confirmarDesconexao}
        onClose={() => setConfirmarDesconexao(false)}
        onConfirm={desconectar}
        loading={desconectando}
        title="Desconectar o Genna?"
        description="O KHUB apaga o acesso ao Genna desta conta e para de ler o Instagram por ele. Nada é apagado no Genna. Para remover o acesso também do lado do Genna, use o painel do Genna."
        confirmLabel="Desconectar"
      />
    </div>
  );
}
