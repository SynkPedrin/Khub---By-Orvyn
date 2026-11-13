'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { NyroMensagens } from '@/components/app/NyroMensagens';
import { PageShell } from '@/components/revenue/Page';
import { NICO, NicoAvatar, NicoStatus, capacidadeHumana, type EstadoNico } from '@/components/nico/Nico';
import { useNyroChat } from '@/lib/use-nyro-chat';
import { ANEXO_EXTENSOES, nyro, type Aprovacao } from '@/lib/nyro';
import { useAuth } from '@/lib/auth';

const SUGESTOES = [
  'Monte meu funil pelo meu nicho',
  'Como está meu funil hoje?',
  'Quem são meus leads quentes?',
  'Crie uma automação de follow-up',
  'Qual é o gargalo do meu funil?',
  'Traga uma automação de boas-vindas',
];

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Mesa de trabalho da NICO (ADR-0040): a agente interna de marketing, que
 * conversa com a equipe e EXECUTA ações na plataforma (com aprovação nas
 * sensíveis). Ao lado: o que ela está esperando você aprovar e o que ela sabe
 * fazer (capacidades reais vindas da API, não uma lista de marketing).
 */
export default function NicoPage() {
  const { user } = useAuth();
  const { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir, anexos, anexar, removerAnexo } = useNyroChat(true);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [pendentes, setPendentes] = useState<Aprovacao[] | null>(null);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolar = useCallback(() => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40), []);
  useEffect(() => {
    rolar();
  }, [bolhas, passos, rolar]);

  const carregarPendentes = useCallback(() => {
    nyro
      .pendentes()
      .then(setPendentes)
      .catch(() => setPendentes([]));
  }, []);
  // A cada resposta a NICO pode ter proposto uma ação nova que espera aprovação.
  useEffect(() => {
    if (status?.configurada === false) return;
    carregarPendentes();
  }, [bolhas.length, status?.configurada, carregarPendentes]);

  // Mensagem pronta vinda da Biblioteca ("Como usar isso na minha empresa?").
  const autoRef = useRef(false);
  useEffect(() => {
    if (autoRef.current || status == null || status.configurada === false) return;
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    autoRef.current = true;
    void enviar(q);
  }, [status, enviar]);

  const decidirPendente = async (a: Aprovacao, aprovar: boolean) => {
    setDecidindo(a.id);
    try {
      await decidir(a, aprovar);
    } finally {
      setDecidindo(null);
      carregarPendentes();
    }
  };

  const estado: EstadoNico = status?.configurada === false ? 'configurar' : pensando ? 'pensando' : 'online';
  const vazio = bolhas.length === 0 && status?.configurada !== false;
  const nome = user?.name?.split(' ')[0];

  return (
    <PageShell className="max-w-none">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* CONVERSA */}
        <section className="card flex h-[calc(100dvh-170px)] min-h-[560px] flex-col overflow-hidden p-0" aria-label="Conversa com a NICO">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <NicoAvatar tamanho={46} estado={estado} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2.5">
                <Image src="/nico-logo.png" alt={NICO.nome} width={2172} height={724} unoptimized priority className="h-8 w-auto object-contain" />
                <span className="rounded-full bg-lime-soft px-2 py-0.5 text-[11px] font-semibold text-lime-ink">Equipe interna</span>
              </p>
              <p className="text-[13px] text-muted">{NICO.papel}</p>
            </div>
            <NicoStatus estado={estado} />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-5 py-6">
            <div className="mx-auto max-w-2xl space-y-4">
              {vazio && (
                <div className="pb-2 text-center">
                  <NicoAvatar tamanho={72} className="mx-auto" />
                  <h1 className="t-display mt-4">
                    {saudacao()}
                    {nome ? `, ${nome}` : ''}.
                  </h1>
                  <p className="mx-auto mt-2 max-w-md text-[14px] text-muted">
                    Sou a NICO, a IA de marketing da sua operação. Analiso tráfego e financeiro, escrevo copy e roteiro, melhoro prompts, monto automações e leio seus arquivos. É só pedir.
                  </p>
                </div>
              )}
              <NyroMensagens status={status} bolhas={bolhas} passos={passos} pensando={pensando} erro={erro} sugestoes={SUGESTOES} onSugestao={enviar} onDecidir={decidir} />
              <div ref={fimRef} />
            </div>
          </div>

          {status?.configurada !== false && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
              className="border-t border-line p-4"
            >
              {anexos.length > 0 && (
                <div className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-1.5">
                  {anexos.map((a) => (
                    <span key={a.nome} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 px-2.5 py-1 text-[12px] text-fg">
                      <Icon name="paperclip" size={12} /> {a.nome}
                      <button type="button" onClick={() => removerAnexo(a.nome)} aria-label={`Remover ${a.nome}`} className="text-muted hover:text-fg">
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mx-auto flex max-w-2xl items-end gap-2">
                <input
                  ref={arquivoRef}
                  type="file"
                  multiple
                  hidden
                  accept={ANEXO_EXTENSOES.map((e) => `.${e}`).join(',')}
                  onChange={(e) => {
                    if (e.target.files?.length) void anexar(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button type="button" onClick={() => arquivoRef.current?.click()} disabled={pensando} className="btn btn-ghost btn-icon h-11 w-11" aria-label="Anexar arquivo" title="Anexar PDF, DOCX, PPTX, MD, CSV, JSON, código…">
                  <Icon name="paperclip" size={18} />
                </button>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  disabled={pensando}
                  rows={1}
                  placeholder="Peça algo para a NICO"
                  aria-label="Mensagem para a NICO"
                  className="textarea max-h-40 min-h-[44px] flex-1 resize-none"
                />
                <button type="submit" disabled={(!texto.trim() && !anexos.length) || pensando} className="btn btn-primary h-11 px-4">
                  <Icon name="send" size={17} />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </div>
              <p className="mx-auto mt-1.5 max-w-2xl text-[11.5px] text-muted">Ela lê PDF, DOCX, PPTX, MD, CSV, JSON e código (até 3 arquivos, 10 MB cada). Age com as suas permissões; ações sensíveis esperam seu ok.</p>
            </form>
          )}
        </section>

        {/* PAINEL LATERAL */}
        <aside className="min-w-0 space-y-4">
          <section className="card p-5">
            <p className="t-section">Quem é a NICO</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{NICO.resumo}</p>
            <div className="mt-4 rounded-xl bg-[var(--fill-4)] p-3">
              <p className="text-[13px] text-fg">{NICO.diferenca}</p>
              <Link href="/agentes" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                Ver Agentes de IA <Icon name="arrowRight" size={13} />
              </Link>
            </div>
          </section>

          <section className="card p-5" aria-live="polite">
            <div className="flex items-center justify-between">
              <p className="t-section">Aguardando sua aprovação</p>
              {pendentes && pendentes.length > 0 && <span className="pill pill-warning">{pendentes.length}</span>}
            </div>
            {pendentes === null ? (
              <div className="mt-3 space-y-2">
                <div className="skeleton h-10 w-full rounded-lg" />
                <div className="skeleton h-10 w-full rounded-lg" />
              </div>
            ) : pendentes.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Nada pendente. Quando a NICO propuser uma ação sensível, ela espera aqui pelo seu ok.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pendentes.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line p-3">
                    <p className="text-[13.5px] text-fg">{a.resumo}</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" disabled={decidindo === a.id} onClick={() => void decidirPendente(a, true)}>
                        Aprovar
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={decidindo === a.id} onClick={() => void decidirPendente(a, false)}>
                        Recusar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {status && status.capacidades.length > 0 && (
            <section className="card p-5">
              <p className="t-section">O que a NICO pode fazer</p>
              <ul className="mt-3 space-y-2.5">
                {status.capacidades.map((cap) => ({ ...cap, ...capacidadeHumana(cap) })).map((c) => (
                  <li key={c.nome} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime-soft text-lime-ink">
                      <Icon name={c.precisaAprovacao ? 'lock' : 'check'} size={11} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-fg">{c.nome}</span>
                      <span className="block text-[12.5px] text-muted">
                        {c.descricao}
                        {c.precisaAprovacao ? ' · pede sua aprovação' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
