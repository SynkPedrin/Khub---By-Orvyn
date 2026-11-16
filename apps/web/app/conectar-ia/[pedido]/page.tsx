'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ApiError } from '@/lib/api-error';
import { conectorIaApi, type PedidoConexao } from '@/lib/conector-ia';

/**
 * Tela de consentimento do conector MCP (ADR-0049). O Claude/ChatGPT mandam a
 * pessoa para cá via /oauth/authorize; o middleware garante login (e devolve
 * para esta URL depois). Aprovar cria a conexão e volta para o app com o código.
 */
const PODE = [
  'Ler contatos, funil, conversas, agenda, financeiro e relatórios',
  'Ver, criar e editar o rascunho dos agentes de IA e testá-los no simulador',
  'Ver, testar (no número de teste) e editar o rascunho das automações',
  'Ver configurações, equipe, integrações e a auditoria',
];
const APROVACAO = 'Publicar ou ativar agente/automação, mudar canais do agente, enviar mensagem a cliente e mover negócio de etapa: só depois que alguém aprovar aqui no KHUB.';

export default function ConectarIaPage({ params }: { params: { pedido: string } }) {
  const pedido = decodeURIComponent(params.pedido);
  const [dados, setDados] = useState<PedidoConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'aprovar' | 'negar' | null>(null);

  useEffect(() => {
    conectorIaApi.pedido(pedido)
      .then(setDados)
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Não consegui carregar o pedido de conexão.'));
  }, [pedido]);

  const aprovar = async () => {
    setEnviando('aprovar');
    try {
      const r = await conectorIaApi.decidir(pedido, true);
      window.location.href = r.redirect;
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Falha ao autorizar. Tente de novo.');
      setEnviando(null);
    }
  };
  const negar = () => {
    setEnviando('negar');
    if (dados?.negar) window.location.href = dados.negar;
    else window.location.href = '/dashboard';
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="card w-full max-w-[480px] p-6 sm:p-8">
        <div className="flex items-center gap-2.5">
          <Image src="/khub-mark.png" alt="" width={30} height={30} unoptimized className="object-contain" />
          <span className="text-[13px] font-bold tracking-[0.2em] text-fg">KHUB</span>
        </div>

        {erro ? (
          <div className="mt-6">
            <h1 className="text-xl font-semibold text-fg">Não foi possível conectar</h1>
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {erro}
            </p>
          </div>
        ) : !dados ? (
          <p className="mt-6 text-sm text-muted">Carregando pedido…</p>
        ) : (
          <>
            <h1 className="mt-6 text-[22px] font-semibold leading-tight tracking-tight text-fg">
              <span className="text-brand">{dados.aplicativo}</span> quer acessar o KHUB
            </h1>
            <p className="mt-1.5 text-[13.5px] text-muted">
              Subconta <strong className="text-fg">{dados.subconta}</strong>. O acesso volta para <span className="font-mono text-[12.5px]">{dados.destino}</span> e age em seu nome.
            </p>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Vai poder</p>
              {PODE.map((t) => (
                <p key={t} className="flex items-start gap-2 text-sm text-fg">
                  <Icon name="check" size={15} className="mt-0.5 shrink-0 text-emerald-500" /> {t}
                </p>
              ))}
              <p className="flex items-start gap-2 pt-1 text-sm text-fg">
                <Icon name="shield" size={15} className="mt-0.5 shrink-0 text-amber-500" /> {APROVACAO}
              </p>
            </div>

            {!dados.podeAutorizar && (
              <p className="mt-5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                Só o dono ou um admin desta subconta pode conectar o {dados.aplicativo}. Seu papel aqui é “{dados.papel}”.
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={negar} disabled={!!enviando}>
                {enviando === 'negar' ? 'Voltando…' : 'Negar'}
              </Button>
              <Button onClick={aprovar} disabled={!dados.podeAutorizar || !!enviando}>
                {enviando === 'aprovar' ? 'Autorizando…' : 'Autorizar acesso'}
              </Button>
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
              Você pode desligar a qualquer momento em Configurações › Integrações › Claude e ChatGPT. Tudo o que o {dados.aplicativo} fizer fica na auditoria.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
