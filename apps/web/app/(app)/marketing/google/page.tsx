'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { Button, Confirm, SkeletonCards, TabPanel, Tabs, useToast } from '@/components/kit';
import { useAuth } from '@/lib/auth';
import { googleApi, mensagemErroGoogle, type StatusGoogle } from '@/lib/google';
import { AbaTagManager } from '@/components/marketing/google/AbaTagManager';
import { AbaSearchConsole } from '@/components/marketing/google/AbaSearchConsole';
import { AbaMeuNegocio } from '@/components/marketing/google/AbaMeuNegocio';

type Aba = 'gtm' | 'sc' | 'gbp';
const ID_ABAS = 'google-presenca';
const LINK_INTEGRACOES = '/configuracoes?tab=integracoes';

export default function GooglePresencaPage() {
  const { user } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role ?? '');
  const toast = useToast();
  const [status, setStatus] = useState<StatusGoogle | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('gtm');
  const [desconectando, setDesconectando] = useState(false);
  const [confirmarDesconexao, setConfirmarDesconexao] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    googleApi.status().then(setStatus).catch((e) => setErro(mensagemErroGoogle(e, 'Não consegui verificar a conexão com o Google.')));
  }, []);

  useEffect(() => {
    carregar();
    // Retorno do OAuth (app/api/integrations/google/callback).
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get('erro');
    if (sp.get('conectado')) toast.success('Google conectado.');
    if (e) toast.error('Conexão com o Google não concluída', { description: e });
    if (e || sp.get('conectado')) window.history.replaceState(null, '', '/marketing/google');
    // toast é estável (contexto); roda uma vez na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar]);

  const pedirEscrita = async () => {
    try {
      const { url } = await googleApi.urlConexao('gtm_escrita');
      window.location.href = url;
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui iniciar a autorização.'));
    }
  };

  const desconectar = async () => {
    setDesconectando(true);
    try {
      await googleApi.desconectar();
      toast.success('Google desconectado desta conta.');
      setConfirmarDesconexao(false);
      carregar();
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui desconectar.'));
    } finally {
      setDesconectando(false);
    }
  };

  const cap = status?.capacidades;

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90">
            <BrandLogo brand="google" size={26} />
          </span>
          <div>
            <h1 className="t-display">Presença no Google</h1>
            <p className="mt-1 text-sm text-muted">Tag Manager, SEO no Search Console e o Perfil da Empresa no Google Meu Negócio.</p>
          </div>
        </div>
        {status?.conectado && admin && (
          <div className="flex flex-wrap gap-2">
            {cap && !cap.tagManagerPublicar && (
              <Button variant="soft" size="sm" icon="lock" onClick={pedirEscrita}>Permitir edição no Tag Manager</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setConfirmarDesconexao(true)}>Desconectar</Button>
          </div>
        )}
      </div>

      {erro && (
        <p className="flex items-center gap-2 rounded-xl bg-danger/5 px-4 py-2.5 text-sm text-danger">
          <Icon name="alert" size={15} /> {erro}
          <button onClick={carregar} className="ml-auto font-semibold underline">Tentar de novo</button>
        </p>
      )}

      {!status && !erro && <SkeletonCards count={3} label="Verificando conexão com o Google" />}

      {status && !status.configurado && <ConfigRequired provider="google_presenca" missing={status.missing} />}

      {status && status.configurado && !status.conectado && (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90">
            <BrandLogo brand="google" size={34} />
          </span>
          <div className="max-w-md">
            <h2 className="text-lg font-bold text-fg">Conecte o Google desta conta</h2>
            <p className="mt-1.5 text-sm text-muted">
              {status.status === 'error' && status.erro ? status.erro : 'Para ver o Tag Manager, o desempenho no Search Console e as avaliações do Perfil da Empresa, conecte a conta Google do cliente em Integrações.'}
            </p>
          </div>
          {admin ? (
            <Link href={LINK_INTEGRACOES} className="btn btn-primary">
              <Icon name="link" size={16} /> Conectar Google em Integrações
            </Link>
          ) : (
            <p className="text-xs text-muted">Peça a um administrador da conta para conectar o Google em Integrações.</p>
          )}
        </Card>
      )}

      {status?.conectado && cap && (
        <>
          <Tabs<Aba>
            idBase={ID_ABAS}
            label="Produtos do Google"
            value={aba}
            onChange={setAba}
            items={[
              { value: 'gtm', label: 'Tag Manager' },
              { value: 'sc', label: 'Search Console' },
              { value: 'gbp', label: 'Meu Negócio' },
            ]}
          />
          <TabPanel idBase={ID_ABAS} value="gtm" active={aba === 'gtm'}>
            {aba === 'gtm' && <AbaTagManager capacidades={cap} admin={admin} onPedirEscrita={pedirEscrita} />}
          </TabPanel>
          <TabPanel idBase={ID_ABAS} value="sc" active={aba === 'sc'}>
            {aba === 'sc' && <AbaSearchConsole habilitado={cap.searchConsole} />}
          </TabPanel>
          <TabPanel idBase={ID_ABAS} value="gbp" active={aba === 'gbp'}>
            {aba === 'gbp' && <AbaMeuNegocio habilitado={cap.meuNegocio} admin={admin} />}
          </TabPanel>
        </>
      )}

      <Confirm
        open={confirmarDesconexao}
        onClose={() => setConfirmarDesconexao(false)}
        onConfirm={desconectar}
        loading={desconectando}
        title="Desconectar o Google?"
        description="O KHUB revoga o acesso no Google e para de ler Tag Manager, Search Console e Meu Negócio desta conta. Nada é apagado no Google."
        confirmLabel="Desconectar"
      />
    </div>
  );
}
