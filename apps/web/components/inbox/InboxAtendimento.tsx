'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { AvatarContato } from './AvatarContato';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { crm, type Conversa, type MensagemConversa } from '@/lib/crm';
import { settingsApi } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-error';
import { useRealtime } from '@/lib/realtime';

/**
 * Inbox de atendimento REAL (ADR-0039) — substitui a tela que só existia no
 * modo demo. Lista leve + mensagens carregadas por conversa, tempo real com
 * polling de reserva, envio otimista reconciliado, marcar como lida ao abrir
 * e troca de atendimento IA ↔ humano.
 */

type Filtro = 'todas' | 'nao_lidas' | 'ia' | 'humano';
type Msg = MensagemConversa & { local?: 'enviando' | 'falhou' };

const STATUS_SAIDA: Record<string, { rotulo: string; tom: string }> = {
  enviando: { rotulo: 'Enviando…', tom: 'text-muted' },
  falhou: { rotulo: 'Falhou', tom: 'text-danger' },
  failed: { rotulo: 'Falhou', tom: 'text-danger' },
  bloqueado_dev: { rotulo: 'Não enviada (ambiente de teste)', tom: 'text-warning' },
  canal_desconectado: { rotulo: 'WhatsApp desconectado', tom: 'text-warning' },
  sending: { rotulo: 'Enviando…', tom: 'text-muted' },
  unknown: { rotulo: 'Entrega não confirmada', tom: 'text-warning' },
};

const diaDe = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : '');
const hojeOuOntem = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 864e5);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return diaDe(iso);
};

/** Linhas "📎 url" (anexos importados) viram link; o resto é texto. */
function CorpoMensagem({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linha, i) => {
        const anexo = /^📎\s*(https?:\/\/\S+)/.exec(linha);
        if (anexo) {
          return (
            <a key={i} href={anexo[1]} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 underline decoration-current/40 underline-offset-2">
              <Icon name="paperclip" size={13} /> Anexo
            </a>
          );
        }
        return (
          <span key={i} className="block whitespace-pre-wrap break-words">
            {linha || ' '}
          </span>
        );
      })}
    </>
  );
}

/**
 * Estado vazio do Inbox. Olha as integrações de verdade: se o WhatsApp já
 * está conectado, o CTA não pode sugerir "conectar de novo" — o que falta é
 * a primeira mensagem chegar.
 */
function InboxVazio() {
  const [conectado, setConectado] = useState<boolean | null>(null);
  useEffect(() => {
    settingsApi
      .integrations()
      .then((rows) =>
        setConectado(rows.some((r) => ['stevo_api', 'evolution', 'whatsapp'].includes(r.provider) && r.status === 'connected')),
      )
      .catch(() => setConectado(null));
  }, []);

  return (
    <div className="card">
      <EmptyState
        icon="chat"
        title="Nenhuma conversa ainda"
        description={
          conectado
            ? 'WhatsApp conectado e funcionando. Quando um cliente escrever, a conversa aparece aqui na hora.'
            : 'Quando um cliente escrever no WhatsApp conectado, a conversa aparece aqui na hora.'
        }
        action={
          conectado ? undefined : (
            <Link href="/configuracoes?aba=integracoes" className="btn btn-primary btn-sm">
              <Icon name="whatsapp" size={15} /> Conectar WhatsApp
            </Link>
          )
        }
      />
    </div>
  );
}

export function InboxAtendimento() {
  const { user } = useAuth();
  const [convs, setConvs] = useState<Conversa[] | null>(null);
  const [erroLista, setErroLista] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erroThread, setErroThread] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [trocando, setTrocando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  const threadRef = useRef<Msg[] | null>(null);
  const versaoRef = useRef<Record<string, string | undefined>>({});
  selRef.current = sel;
  threadRef.current = thread;

  const descer = useCallback((suave = true) => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'end' }), 30), []);

  const carregarLista = useCallback(async () => {
    try {
      const cs = await crm.conversations();
      setConvs(cs);
      setErroLista(false);
      return cs;
    } catch {
      setErroLista(true);
      return null;
    }
  }, []);

  const abrir = useCallback(
    async (id: string) => {
      setSel(id);
      setThread(null);
      setErroThread(false);
      setAviso('');
      try {
        const r = await crm.mensagens(id);
        if (selRef.current !== id) return;
        setThread(r.mensagens);
        setTotal(r.total);
        descer(false);
      } catch {
        if (selRef.current === id) setErroThread(true);
      }
      // Abrir = ler. Zera o contador local na hora; o servidor confirma.
      setConvs((cs) => cs?.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)) ?? cs);
      crm.marcarLida(id).catch(() => undefined);
    },
    [descer],
  );

  // Carga inicial; `?c=` (deep link da busca ⌘K) abre a conversa pedida.
  useEffect(() => {
    const alvo = new URLSearchParams(window.location.search).get('c');
    void carregarLista().then((cs) => {
      if (!cs) return;
      for (const c of cs) versaoRef.current[c.id] = c.atualizadaEm;
      const inicial = (alvo && cs.find((x) => x.id === alvo)) || (window.matchMedia('(min-width: 1024px)').matches ? cs[0] : null);
      if (inicial) void abrir(inicial.id);
    });
  }, [carregarLista, abrir]);

  /** Evento chegou (socket) ou polling: atualiza a lista e, se a conversa aberta mudou, as mensagens dela. */
  const sincronizar = useCallback(async () => {
    const cs = await carregarLista();
    const id = selRef.current;
    if (!cs || !id) return;
    const conv = cs.find((c) => c.id === id);
    const mudou = conv && conv.atualizadaEm !== versaoRef.current[id];
    for (const c of cs) versaoRef.current[c.id] = c.atualizadaEm;
    if (!mudou) return;
    let r: { total: number; mensagens: MensagemConversa[] };
    try {
      r = await crm.mensagens(id);
    } catch {
      return;
    }
    if (selRef.current !== id) return;
    const atual = threadRef.current ?? [];
    const ids = new Set(atual.map((m) => m.id));
    const novas: Msg[] = [];
    let alterou = false;
    const reconciliada = atual.map((m) => ({ ...m }));
    for (const m of r.mensagens) {
      if (ids.has(m.id)) continue;
      const pend = reconciliada.find((x) => x.local === 'enviando' && x.de !== 'contato' && x.texto === m.texto);
      if (pend) {
        Object.assign(pend, m, { local: undefined });
        alterou = true;
        continue;
      }
      novas.push(m);
    }
    if (novas.length || alterou) {
      setThread([...reconciliada, ...novas]);
      setTotal(r.total);
      if (novas.length) descer();
    }
    // A conversa aberta está sendo lida: o que chegou não fica como "não lida".
    if (conv && conv.naoLidas > 0) {
      setConvs((xs) => xs?.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)) ?? xs);
      crm.marcarLida(id).catch(() => undefined);
    }
  }, [carregarLista, descer]);

  const { conectado } = useRealtime({
    'message.created': () => void sincronizar(),
    'conversation.updated': () => void sincronizar(),
  });
  useEffect(() => {
    if (conectado) return;
    const t = setInterval(() => void sincronizar(), 6000);
    return () => clearInterval(t);
  }, [conectado, sincronizar]);

  const conversa = convs?.find((c) => c.id === sel) ?? null;

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (convs ?? []).filter((c) => {
      if (filtro === 'nao_lidas' && !c.naoLidas) return false;
      if (filtro === 'ia' && c.atendimento !== 'ia') return false;
      if (filtro === 'humano' && c.atendimento !== 'humano') return false;
      if (!q) return true;
      return c.nome.toLowerCase().includes(q) || (c.ultimaPrevia ?? '').toLowerCase().includes(q) || (c.contato?.telefone ?? '').includes(q);
    });
  }, [convs, busca, filtro]);

  const naoLidasTotal = (convs ?? []).filter((c) => c.naoLidas > 0).length;

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !conversa || enviando) return;
    setEnviando(true);
    setAviso('');
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const tmp = `tmp-${Date.now()}`;
    setThread((p) => [...(p ?? []), { id: tmp, de: 'humano', texto: t, hora, criadaEm: new Date().toISOString(), local: 'enviando', enviadoPorNome: user?.name ?? null }]);
    setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, ultimaPrevia: t, ultimaHora: hora } : c)) ?? cs);
    setTexto('');
    descer();
    try {
      const r = await crm.sendMessage(conversa.id, t);
      setThread((p) => p?.map((m) => (m.id === tmp ? { ...m, id: r.id ?? m.id, local: undefined, status: r.status === 'sent' ? 'delivered' : r.status } : m)) ?? p);
      setGated(null);
      if (r.status === 'config_required') setGated({ provider: 'stevo', missing: r.missing ?? [] });
      else if (r.status === 'sem_telefone') setAviso('Este contato não tem telefone cadastrado. A mensagem foi registrada, mas não saiu.');
      else if (r.status === 'failed') setAviso(`O WhatsApp recusou a mensagem${r.erro ? ` (${r.erro})` : ''}. Tente de novo.`);
    } catch (e) {
      setThread((p) => p?.map((m) => (m.id === tmp ? { ...m, local: 'falhou' } : m)) ?? p);
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setAviso('Não consegui enviar. Verifique a conexão e tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const trocarAtendimento = async (acao: 'assumir' | 'devolver_ia') => {
    if (!conversa || trocando) return;
    setTrocando(true);
    try {
      const r = await crm.mudarAtendimento(conversa.id, { acao });
      setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, atendimento: r.atendimento, agentId: r.agentId, assigneeId: r.assigneeId, handoffMotivo: r.handoffMotivo } : c)) ?? cs);
    } catch (e) {
      setAviso(e instanceof ApiError && e.message ? e.message : 'Não foi possível trocar o atendimento agora.');
    } finally {
      setTrocando(false);
    }
  };

  if (erroLista && !convs) {
    return (
      <div className="card">
        <ErrorState title="Não consegui carregar as conversas" description="Verifique sua conexão e tente de novo." onRetry={() => void carregarLista()} />
      </div>
    );
  }

  if (convs && convs.length === 0) {
    return <InboxVazio />;
  }

  // Agrupa mensagens por dia para os separadores.
  const grupos: { dia: string; itens: Msg[] }[] = [];
  for (const m of thread ?? []) {
    const dia = hojeOuOntem(m.criadaEm);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
    else grupos.push({ dia, itens: [m] });
  }

  return (
    <div className="card grid h-[calc(100dvh-210px)] min-h-[520px] grid-cols-[minmax(0,1fr)] overflow-hidden p-0 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* LISTA */}
      <section className={cx('flex min-h-0 min-w-0 flex-col border-line lg:border-r', conversa ? 'hidden lg:flex' : 'flex')} aria-label="Conversas">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between">
            <p className="t-section">
              {convs ? `${convs.length} conversas` : 'Conversas'}
            </p>
            {naoLidasTotal > 0 && <span className="pill pill-brand">{naoLidasTotal} não lidas</span>}
          </div>
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input type="search" className="input w-full pl-9" placeholder="Buscar nome, telefone ou mensagem" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversas" />
          </div>
          <div className="segbar w-full" role="tablist" aria-label="Filtrar conversas">
            {([['todas', 'Todas'], ['nao_lidas', 'Não lidas'], ['ia', 'IA'], ['humano', 'Equipe']] as [Filtro, string][]).map(([v, r]) => (
              <button key={v} type="button" role="tab" aria-selected={filtro === v} className="seg flex-1 whitespace-nowrap px-2" onClick={() => setFiltro(v)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {!convs &&
            Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-3 w-full" />
                </div>
              </li>
            ))}
          {convs && visiveis.length === 0 && <li className="px-4 py-10 text-center text-[13px] text-muted">Nenhuma conversa com esse filtro.</li>}
          {visiveis.map((c) => {
            const ativa = c.id === sel;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void abrir(c.id)}
                  aria-current={ativa ? 'true' : undefined}
                  className={cx(
                    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                    ativa ? 'bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]' : 'hover:bg-[var(--fill-4)]',
                  )}
                >
                  <span className="relative shrink-0">
                    <AvatarContato nome={c.nome} fotoUrl={c.contato?.fotoUrl} size={40} />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--base-0)] shadow-sm">
                      <Icon name={c.canal === 'Instagram' ? 'instagram' : 'whatsapp'} size={11} className={c.canal === 'Instagram' ? 'text-[var(--ch-instagram)]' : 'text-[var(--ch-whatsapp)]'} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cx('truncate text-[14px] text-fg', c.naoLidas ? 'font-semibold' : 'font-medium')}>{c.nome}</span>
                      <span className={cx('shrink-0 text-[11.5px] tabular', c.naoLidas ? 'font-semibold text-brand' : 'text-muted')}>{c.ultimaHora ?? ''}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      {c.atendimento === 'ia' && <span className="shrink-0 rounded-full bg-brand-soft px-1.5 text-[10.5px] font-semibold text-brand">IA</span>}
                      <span className={cx('truncate text-[13px]', c.naoLidas ? 'text-fg' : 'text-muted')}>{c.ultimaPrevia ?? 'Sem mensagens'}</span>
                      {c.naoLidas > 0 && (
                        <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.naoLidas > 99 ? '99+' : c.naoLidas}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* CONVERSA */}
      <section className={cx('min-h-0 min-w-0 flex-col', conversa ? 'flex' : 'hidden lg:flex')} aria-label="Mensagens">
        {!conversa ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState icon="chat" title="Selecione uma conversa" description="Escolha um contato à esquerda para ver o histórico e responder." />
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 lg:px-5">
              <button type="button" className="btn btn-ghost btn-icon btn-sm lg:hidden" onClick={() => setSel(null)} aria-label="Voltar para a lista">
                <Icon name="arrowLeft" size={18} />
              </button>
              <AvatarContato nome={conversa.nome} fotoUrl={conversa.contato?.fotoUrl} size={38} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-fg">{conversa.nome}</p>
                <p className="truncate text-[12.5px] text-muted">
                  {conversa.canal}
                  {conversa.contato?.telefone ? ` · ${conversa.contato.telefone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {conversa.atendimento === 'ia' ? (
                  <>
                    <span className="pill pill-brand hidden sm:inline-flex">
                      <Icon name="sparkles" size={12} /> IA respondendo
                    </span>
                    <button type="button" className="btn btn-sm" disabled={trocando} onClick={() => void trocarAtendimento('assumir')}>
                      Assumir conversa
                    </button>
                  </>
                ) : (
                  conversa.agentId && (
                    <button type="button" className="btn btn-soft btn-sm" disabled={trocando} onClick={() => void trocarAtendimento('devolver_ia')}>
                      <Icon name="sparkles" size={14} /> Devolver para a IA
                    </button>
                  )
                )}
                {conversa.contato?.id && (
                  <Link href={`/contatos/${conversa.contato.id}`} className="btn btn-ghost btn-sm">
                    Ver contato
                  </Link>
                )}
              </div>
              {conversa.atendimento === 'humano' && conversa.handoffMotivo && (
                <p className="w-full rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[12.5px] text-muted">Transferida para a equipe: {conversa.handoffMotivo}</p>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin bg-[color-mix(in_srgb,var(--base-2)_60%,transparent)] px-4 py-5 lg:px-6">
              {erroThread && <ErrorState title="Não consegui abrir esta conversa" description="Tente de novo em instantes." onRetry={() => void abrir(conversa.id)} />}
              {!thread && !erroThread && (
                <div className="space-y-3">
                  {[60, 40, 70, 35].map((w, i) => (
                    <div key={i} className={cx('flex', i % 2 ? 'justify-end' : 'justify-start')}>
                      <div className="skeleton h-12 rounded-2xl" style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              )}
              {thread && total > thread.length && (
                <p className="mb-4 text-center text-[12px] text-muted">Mostrando as {thread.length} mensagens mais recentes de {total}.</p>
              )}
              {grupos.map((g) => (
                <div key={g.dia} className="space-y-1.5">
                  {g.dia && (
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full bg-[var(--base-0)] px-3 py-1 text-[11.5px] font-medium text-muted shadow-sm">{g.dia}</span>
                    </div>
                  )}
                  {g.itens.map((m) => {
                    const minha = m.de !== 'contato';
                    const ia = m.de === 'ia' || m.de === 'nyro';
                    const automacao = m.de === 'automacao';
                    const st = m.local ? STATUS_SAIDA[m.local] : m.status ? STATUS_SAIDA[m.status] : undefined;
                    return (
                      <div key={m.id} className={cx('flex', minha ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cx(
                            'max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-sm sm:max-w-[68%]',
                            !minha && 'rounded-bl-md border border-line bg-[var(--base-0)] text-fg',
                            minha && !ia && !automacao && 'rounded-br-md bg-brand text-white',
                            ia && 'rounded-br-md border border-[color-mix(in_srgb,var(--brand)_18%,transparent)] bg-brand-soft text-fg',
                            automacao && 'rounded-br-md border border-lime-border bg-lime-soft text-fg',
                          )}
                        >
                          {ia && <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand"><Icon name="sparkles" size={11} /> IA</p>}
                          {automacao && (
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-lime-ink">
                              <Icon name="zap" size={11} /> Automação{m.workflowNome ? `: ${m.workflowNome}` : ''}
                            </p>
                          )}
                                                    {!ia && !automacao && minha && (
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-white/85">
                              {/* Mensagens antigas (importadas antes da migration 036) não
                                  têm autor gravado — o histórico do WhatsApp não traz isso.
                                  Caem no rótulo genérico "Equipe" em vez de ficar sem origem. */}
                              <Icon name="users" size={11} /> {m.enviadoPorNome ?? 'Equipe'}
                            </p>
                          )}
                          <CorpoMensagem texto={m.texto} />
                          <p className={cx('mt-1 text-right text-[10.5px] tabular', minha && !ia && !automacao ? 'text-white/75' : 'text-muted')}>
                            {m.hora ?? ''}
                          </p>
                        </div>
                        {st && minha && <span className={cx('sr-only')}>{st.rotulo}</span>}
                      </div>
                    );
                  })}
                  {g.itens.some((m) => m.de !== 'contato' && (m.local || (m.status && STATUS_SAIDA[m.status]))) && (
                    <div className="flex justify-end">
                      {(() => {
                        const ult = [...g.itens].reverse().find((m) => m.de !== 'contato');
                        const st = ult?.local ? STATUS_SAIDA[ult.local] : ult?.status ? STATUS_SAIDA[ult.status] : undefined;
                        return st ? <span className={cx('text-[11.5px]', st.tom)}>{st.rotulo}</span> : null;
                      })()}
                    </div>
                  )}
                </div>
              ))}
              <div ref={fimRef} />
            </div>

            <form
              className="border-t border-line p-3 lg:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
            >
              {gated && (
                <div className="mb-3">
                  <ConfigRequired provider={gated.provider} missing={gated.missing} />
                </div>
              )}
              {aviso && (
                <p role="alert" className="mb-2 text-[12.5px] text-warning">
                  {aviso}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="textarea max-h-40 min-h-[44px] flex-1 resize-none"
                  rows={1}
                  placeholder={conversa.atendimento === 'ia' ? 'A IA está respondendo. Escrever aqui assume a conversa.' : 'Escreva uma mensagem'}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  aria-label="Mensagem"
                />
                <button type="submit" className="btn btn-primary h-11 px-4" disabled={!texto.trim() || enviando} aria-label="Enviar mensagem">
                  <Icon name="send" size={17} />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted">Enter envia · Shift + Enter quebra a linha</p>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
