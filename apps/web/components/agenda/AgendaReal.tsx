'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { agenda, type Compromisso } from '@/lib/agenda';
import { crm } from '@/lib/crm';
import { ApiError } from '@/lib/api-error';
import { duracao, hora } from '@/lib/format';
import { NovaReuniaoModal } from './NovaReuniaoModal';
import {
  STATUS_LABEL,
  STATUS_ORDEM,
  STATUS_PILL,
  chaveDia,
  ehLink,
  inicioDaSemana,
  mensagemErro,
  rotuloDia,
  rotuloSemana,
  somarDias,
  type StatusCompromisso,
} from './agenda-utils';

/**
 * Agenda real do tenant: compromissos da semana vindos de `/v1/agenda`,
 * agrupados por dia. Inclui o que os agentes de IA marcam pela mesma API.
 */
export function AgendaReal() {
  const [semana, setSemana] = useState(() => inicioDaSemana(new Date()));
  const [itens, setItens] = useState<Compromisso[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string | null>>({});
  const pedidoAtual = useRef(0);
  const contatosPedidos = useRef(new Set<string>());

  const carregar = useCallback(async (inicio: Date, silencioso = false) => {
    const id = ++pedidoAtual.current;
    if (!silencioso) {
      setItens(null);
      setErro(null);
    }
    try {
      const fim = new Date(somarDias(inicio, 7).getTime() - 1);
      const lista = await agenda.compromissos({ de: inicio.toISOString(), ate: fim.toISOString() });
      if (id !== pedidoAtual.current) return;
      setItens([...lista].sort((a, b) => +new Date(a.inicio) - +new Date(b.inicio)));
      setErro(null);
    } catch (e) {
      if (id !== pedidoAtual.current) return;
      setErro(mensagemErro(e, 'carregar a agenda'));
      setItens(null);
    }
  }, []);

  useEffect(() => {
    void carregar(semana);
  }, [semana, carregar]);

  // O payload traz só o `contactId`; o nome vem do CRM, uma vez por contato.
  useEffect(() => {
    if (!itens) return;
    const faltando = [...new Set(itens.map((c) => c.contactId).filter((x): x is string => !!x))].filter(
      (cid) => !contatosPedidos.current.has(cid),
    );
    if (faltando.length === 0) return;
    faltando.forEach((cid) => contatosPedidos.current.add(cid));
    void Promise.allSettled(faltando.map((cid) => crm.contact(cid))).then((res) => {
      setNomes((prev) => {
        const prox = { ...prev };
        res.forEach((r, i) => {
          prox[faltando[i]] = r.status === 'fulfilled' ? r.value.nome : null;
        });
        return prox;
      });
    });
  }, [itens]);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => somarDias(semana, i)), [semana]);
  const porDia = useMemo(() => {
    const m = new Map<string, Compromisso[]>();
    for (const c of itens ?? []) {
      const k = chaveDia(new Date(c.inicio));
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }, [itens]);

  const hojeChave = chaveDia(new Date());
  const ehSemanaAtual = chaveDia(semana) === chaveDia(inicioDaSemana(new Date()));
  const diaSugerido = ehSemanaAtual ? new Date() : semana;

  const atualizarItem = (c: Compromisso) => setItens((prev) => prev?.map((x) => (x.id === c.id ? c : x)) ?? prev);
  const removerItem = (id: string) => setItens((prev) => prev?.filter((x) => x.id !== id) ?? prev);

  const aoCriar = (c: Compromisso) => {
    setModal(false);
    const alvo = inicioDaSemana(new Date(c.inicio));
    if (chaveDia(alvo) !== chaveDia(semana)) setSemana(alvo);
    else void carregar(semana, true);
  };

  const total = itens?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="t-section">{rotuloSemana(semana)}</h2>
          <p className="mt-0.5 text-[13px] text-muted" aria-live="polite">
            {itens === null ? (erro ? 'Agenda indisponível' : 'Carregando compromissos…') : total === 1 ? '1 compromisso nesta semana' : `${total} compromissos nesta semana`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSemana((s) => somarDias(s, -7))} aria-label="Semana anterior">
              <Icon name="arrowLeft" size={16} />
            </button>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setSemana(inicioDaSemana(new Date()))} disabled={ehSemanaAtual}>
              Hoje
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setSemana((s) => somarDias(s, 7))} aria-label="Próxima semana">
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
          <button type="button" className="btn btn-primary btn-sm ml-auto sm:ml-0" onClick={() => setModal(true)}>
            <Icon name="plus" size={15} />
            Nova reunião
          </button>
        </div>
      </div>

      {erro ? (
        <div className="card">
          <ErrorState title="Não foi possível carregar a agenda" description={erro} onRetry={() => void carregar(semana)} />
        </div>
      ) : itens === null ? (
        <div className="card space-y-5 p-5" aria-busy="true">
          <span className="sr-only">Carregando compromissos…</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <div className="skeleton h-4 w-44 rounded-md" />
              <div className="skeleton h-16 w-full rounded-md" />
              {i === 0 && <div className="skeleton h-16 w-full rounded-md" />}
            </div>
          ))}
        </div>
      ) : itens.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="calendar"
            title="Nenhum compromisso nesta semana"
            description="Reuniões, demos e follow-ups criados pela equipe ou pelos agentes de IA aparecem aqui."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal(true)}>
                  <Icon name="plus" size={15} />
                  Nova reunião
                </button>
                <Link href="/configuracoes?aba=integracoes" className="btn btn-sm">
                  <Icon name="link" size={15} />
                  Conectar calendário
                </Link>
              </div>
            }
          />
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {dias.map((d) => {
            const k = chaveDia(d);
            const doDia = porDia.get(k) ?? [];
            const hoje = k === hojeChave;
            return (
              <section key={k} className="px-4 py-4 sm:px-5" aria-label={rotuloDia(d)}>
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
                  <span className={cx(!hoje && doDia.length === 0 && 'text-muted')}>{rotuloDia(d)}</span>
                  {hoje && <span className="pill pill-brand">Hoje</span>}
                </h3>
                {doDia.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-faint">Nada agendado</p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {doDia.map((c) => (
                      <ItemCompromisso
                        key={c.id}
                        c={c}
                        nomeContato={c.contactId ? nomes[c.contactId] : undefined}
                        onAtualizado={atualizarItem}
                        onRemovido={removerItem}
                        onSumiu={() => void carregar(semana, true)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {modal && <NovaReuniaoModal diaSugerido={diaSugerido} onClose={() => setModal(false)} onCreated={aoCriar} />}
    </div>
  );
}

function ItemCompromisso({
  c,
  nomeContato,
  onAtualizado,
  onRemovido,
  onSumiu,
}: {
  c: Compromisso;
  /** `undefined` = ainda carregando ou sem contato; `null` = não foi possível ler o nome. */
  nomeContato: string | null | undefined;
  onAtualizado: (c: Compromisso) => void;
  onRemovido: (id: string) => void;
  onSumiu: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const inicio = new Date(c.inicio);
  const fim = new Date(c.fim);
  const minutos = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  const outroDia = chaveDia(inicio) !== chaveDia(fim);
  const inativo = c.status === 'cancelado' || c.status === 'nao_compareceu';

  const tratarFalha = (e: unknown, acao: string) => {
    setErro(mensagemErro(e, acao));
    if (e instanceof ApiError && e.status === 404) onSumiu();
  };

  const mudarStatus = async (status: StatusCompromisso) => {
    if (status === c.status || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      onAtualizado(await agenda.status(c.id, status));
    } catch (e) {
      tratarFalha(e, 'alterar o status');
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await agenda.remover(c.id);
      onRemovido(c.id);
    } catch (e) {
      tratarFalha(e, 'remover o compromisso');
      setOcupado(false);
      setConfirmando(false);
    }
  };

  return (
    <li className={cx('rounded-lg border border-line bg-surface p-3.5 sm:p-4', ocupado && 'opacity-70')} aria-busy={ocupado}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium tabular text-muted">
              <Icon name="clock" size={13} className="shrink-0 text-faint" />
              {hora(inicio)} - {outroDia ? `${hora(fim)} (dia seguinte)` : hora(fim)}
              {minutos > 0 && <span className="text-faint">· {duracao(minutos)}</span>}
            </span>
            <span className={STATUS_PILL[c.status]}>{STATUS_LABEL[c.status]}</span>
          </div>
          <p className={cx('mt-1.5 break-words text-[14.5px] font-semibold', inativo ? 'text-muted line-through' : 'text-fg')}>{c.titulo}</p>

          {(c.local || c.contactId) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
              {c.local &&
                (ehLink(c.local) ? (
                  <a href={c.local.trim()} target="_blank" rel="noopener noreferrer" className="flex min-w-0 max-w-full items-center gap-1.5 text-brand hover:underline">
                    <Icon name="video" size={13} className="shrink-0" />
                    <span className="truncate">{c.local.trim().replace(/^https?:\/\//i, '')}</span>
                  </a>
                ) : (
                  <span className="flex min-w-0 max-w-full items-center gap-1.5">
                    <Icon name="mapPin" size={13} className="shrink-0 text-faint" />
                    <span className="truncate">{c.local}</span>
                  </span>
                ))}
              {c.contactId && (
                <Link href={`/contatos/${c.contactId}`} className="flex min-w-0 max-w-full items-center gap-1.5 hover:text-fg hover:underline">
                  <Icon name="user" size={13} className="shrink-0 text-faint" />
                  <span className="truncate">{nomeContato ?? (nomeContato === null ? 'Ver contato' : 'Carregando contato…')}</span>
                </Link>
              )}
            </div>
          )}

          {c.notas && <p className="mt-2 whitespace-pre-line break-words text-[12.5px] leading-relaxed text-muted">{c.notas}</p>}
        </div>

        {!confirmando && (
          <div className="flex shrink-0 items-center gap-2">
            <label className="sr-only" htmlFor={`status-${c.id}`}>
              Status de {c.titulo}
            </label>
            <select
              id={`status-${c.id}`}
              className="select h-8 w-auto min-w-0 flex-1 py-0 text-[12.5px] sm:w-40 sm:flex-none"
              value={c.status}
              disabled={ocupado}
              onChange={(e) => void mudarStatus(e.target.value as StatusCompromisso)}
            >
              {STATUS_ORDEM.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm shrink-0"
              onClick={() => {
                setErro(null);
                setConfirmando(true);
              }}
              disabled={ocupado}
              aria-label={`Remover ${c.titulo}`}
              title="Remover"
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </div>

      {confirmando && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-line bg-surface2 p-3 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-label="Confirmar remoção">
          <p className="text-[13px] text-fg">Remover este compromisso da agenda? Não dá para desfazer.</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn btn-ghost btn-sm flex-1 sm:flex-none" onClick={() => setConfirmando(false)} disabled={ocupado} autoFocus>
              Manter
            </button>
            <button type="button" className="btn btn-danger btn-sm flex-1 sm:flex-none" onClick={() => void remover()} disabled={ocupado}>
              {ocupado ? 'Removendo…' : 'Remover'}
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-danger">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{erro}</span>
        </p>
      )}
    </li>
  );
}
