'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { ApiError } from '@/lib/api-error';
import { conectorIaApi, type ConexaoIa, type InfoConector } from '@/lib/conector-ia';

/**
 * Conector MCP personalizado (ADR-0049): liga o Claude e o ChatGPT ao KHUB.
 * Mostra a URL do servidor, o passo a passo de cada app e as conexões ativas
 * (com "Desconectar", que corta o acesso na hora).
 */
const PASSOS: Record<'claude' | 'chatgpt', { titulo: string; passos: string[] }> = {
  claude: {
    titulo: 'Claude (claude.ai, Desktop ou celular)',
    passos: [
      'Abra Configurações › Conectores e clique em “Adicionar conector personalizado”.',
      'Nome: KHUB. URL do servidor remoto MCP: cole a URL acima. Deixe Client ID/Secret em branco.',
      'Clique em Conectar: abre a tela do KHUB. Entre com sua conta e clique em “Autorizar acesso”.',
      'Numa conversa, ative o KHUB no menu de ferramentas (ícone de ajustes) e peça, por ex.: “faça uma visão geral da minha conta no KHUB”.',
    ],
  },
  chatgpt: {
    titulo: 'ChatGPT (Plus, Pro, Business ou Enterprise)',
    passos: [
      'Configurações › Aplicativos e conectores › Avançado: ligue o “Modo desenvolvedor”.',
      'Volte em Aplicativos e conectores › Criar. Nome: KHUB. URL do servidor MCP: cole a URL acima. Autenticação: OAuth.',
      'Marque que confia no aplicativo e clique em Criar: abre a tela do KHUB. Entre e clique em “Autorizar acesso”.',
      'Numa conversa, clique em + › Mais › Modo desenvolvedor e selecione o KHUB. Ações que alteram dados pedem sua confirmação no próprio ChatGPT.',
    ],
  },
};

export function ConectorIaPainel() {
  const [info, setInfo] = useState<InfoConector | null>(null);
  const [conexoes, setConexoes] = useState<ConexaoIa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<'claude' | 'chatgpt'>('claude');
  const [copiado, setCopiado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    Promise.all([conectorIaApi.info(), conectorIaApi.conexoes()])
      .then(([i, c]) => { setInfo(i); setConexoes(c); })
      .catch((e) => setErro(e instanceof ApiError && e.status === 403 ? 'Só dono ou admin vê e gerencia o conector.' : 'Não consegui carregar o conector agora.'));
  }, []);
  useEffect(carregar, [carregar]);

  const copiar = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  const revogar = async (c: ConexaoIa) => {
    if (!window.confirm(`Desconectar ${c.aplicativo}? Ele perde o acesso ao KHUB na hora.`)) return;
    setRevogando(c.id);
    try {
      await conectorIaApi.revogar(c.id);
      carregar();
    } catch {
      setErro('Não consegui desconectar. Tente de novo.');
    } finally {
      setRevogando(null);
    }
  };

  const contagem = info ? {
    leitura: info.ferramentas.filter((f) => f.tipo === 'leitura').length,
    escrita: info.ferramentas.filter((f) => f.tipo === 'escrita').length,
    aprovacao: info.ferramentas.filter((f) => f.tipo === 'aprovacao').length,
  } : null;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex shrink-0 -space-x-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90"><BrandLogo brand="claude" size={24} /></span>
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-white text-[11px] font-bold text-black shadow-sm dark:bg-white/90">GPT</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-fg">Claude e ChatGPT (conector MCP)</p>
            {conexoes && conexoes.length > 0 ? <Badge tone="green">● {conexoes.length} conectado(s)</Badge> : <Badge tone="brand">novo</Badge>}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted">
            Converse com a sua operação pelo Claude ou pelo ChatGPT: ver e configurar agentes, testar a IA no simulador, analisar e testar automações, consultar CRM, financeiro e configurações. Publicar, ativar e enviar mensagem sempre passam pela sua aprovação aqui.
          </p>
        </div>
        <Button variant="soft" onClick={() => setAberto((v) => !v)} className="!py-1.5 !text-xs">
          {aberto ? 'Fechar' : <><Icon name="link" size={13} /> Conectar</>}
        </Button>
      </div>

      {erro && <p className="mt-3 rounded-xl bg-danger/5 px-4 py-2.5 text-sm text-danger">{erro}</p>}

      {aberto && info && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">URL do servidor MCP</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface2 px-3 py-2 font-mono text-[12.5px] text-fg">{info.url}</code>
              <Button variant="ghost" onClick={copiar} className="!py-2 !text-xs">
                <Icon name={copiado ? 'check' : 'copy'} size={13} /> {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            {contagem && (
              <p className="mt-1.5 text-[11.5px] text-muted">
                {info.totalFerramentas} ferramentas: {contagem.leitura} de leitura, {contagem.escrita} que editam rascunho/testam, {contagem.aprovacao} que pedem aprovação.
              </p>
            )}
          </div>

          <div>
            <div className="flex gap-1.5">
              {(['claude', 'chatgpt'] as const).map((k) => (
                <button key={k} onClick={() => setAba(k)} className={cx('rounded-full px-3 py-1 text-xs font-semibold transition-colors', aba === k ? 'bg-brand text-white' : 'border border-line text-fg hover:bg-surface2')}>
                  {k === 'claude' ? 'Claude' : 'ChatGPT'}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm font-semibold text-fg">{PASSOS[aba].titulo}</p>
            <ol className="mt-2 space-y-1.5">
              {PASSOS[aba].passos.map((p, i) => (
                <li key={p} className="flex gap-2.5 text-sm text-fg">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">{i + 1}</span>
                  <span className="leading-snug">{p}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11.5px] text-muted">Só dono ou admin da subconta consegue autorizar. O app age em nome de quem autorizou, e tudo fica na auditoria.</p>
          </div>
        </div>
      )}

      {conexoes && conexoes.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Conectados</p>
          {conexoes.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3 py-2">
              <span className="text-sm font-semibold text-fg">{c.aplicativo}</span>
              <span className="text-[11.5px] text-muted">
                por {c.autorizadoPor ?? '—'} · desde {new Date(c.criadaEm).toLocaleDateString('pt-BR')}
                {c.ultimoUsoEm ? ` · último uso ${new Date(c.ultimoUsoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ' · ainda não usado'}
              </span>
              <button onClick={() => revogar(c)} disabled={revogando === c.id} className="ml-auto text-xs font-semibold text-danger hover:underline disabled:opacity-50">
                {revogando === c.id ? 'Desconectando…' : 'Desconectar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
