'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, inteiro, usd, ROTULO_INTENCAO, ROTULO_STATUS_RUN, type RunLog } from '@/lib/agents';
import { Abas, Erro, Esqueleto, Gaveta, Painel, Vazio, mensagemDeErro, useCarga, useToast } from '../kit';
import type { SecaoProps } from '../editor';
import { TraceDetalhe, duracao, porcento } from './Simulador';

type FiltroStatus = 'todos' | 'respondido' | 'transferido' | 'ignorado' | 'erro';
type FiltroEntrega = 'todas' | 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'cancelado';

const TOM_RUN: Record<string, string> = { respondido: 'pill-success', transferido: 'pill-warning', erro: 'pill-danger', processando: 'pill-info' };
const TOM_ENTREGA: Record<string, string> = { enviado: 'pill-success', pendente: 'pill-info', enviando: 'pill-info', falhou: 'pill-danger' };
const ROTULO_ENTREGA: Record<string, string> = { pendente: 'Pendente', enviando: 'Enviando', enviado: 'Enviado', falhou: 'Falhou', cancelado: 'Cancelado' };

export function StatusRunPill({ status }: { status: string }) {
  return <span className={cx('pill', TOM_RUN[status])}>{ROTULO_STATUS_RUN[status] ?? status}</span>;
}

/** Execution Logs: cada mensagem processada pelo agente, com o trace estruturado, e a fila de entrega. */
export function Logs({ agente, catalogo }: SecaoProps) {
  const [sub, setSub] = useState<'execucoes' | 'entregas'>('execucoes');
  return (
    <div className="space-y-4">
      <Abas
        valor={sub}
        onChange={setSub}
        opcoes={[
          { valor: 'execucoes', rotulo: 'Execuções' },
          { valor: 'entregas', rotulo: 'Fila de entrega' },
        ]}
      />
      {sub === 'execucoes' ? <Execucoes agenteId={agente.id} intencoes={catalogo.intencoesBase} /> : <FilaEntrega agenteId={agente.id} />}
    </div>
  );
}

function Execucoes({ agenteId, intencoes }: { agenteId: string; intencoes: string[] }) {
  const toast = useToast();
  const [status, setStatus] = useState<FiltroStatus>('todos');
  const [intencao, setIntencao] = useState('');
  const [mais, setMais] = useState<{ itens: RunLog[]; cursor: string | null } | null>(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [aberto, setAberto] = useState<RunLog | null>(null);

  const pagina = useCarga(async () => {
    setMais(null);
    return agentesApi.logs(agenteId, { status: status === 'todos' ? undefined : status, intencao: intencao || undefined });
  }, [agenteId, status, intencao]);
  const versoes = useCarga(() => agentesApi.versoes(agenteId), [agenteId]);
  const numeroVersao = useMemo(() => new Map((versoes.dados ?? []).map((v) => [v.id, v.numero])), [versoes.dados]);

  const itens = [...(pagina.dados?.itens ?? []), ...(mais?.itens ?? [])];
  const cursor = mais ? mais.cursor : pagina.dados?.nextCursor ?? null;

  const carregarMais = async () => {
    if (!cursor) return;
    setCarregandoMais(true);
    try {
      const r = await agentesApi.logs(agenteId, { status: status === 'todos' ? undefined : status, intencao: intencao || undefined, cursor });
      setMais((m) => ({ itens: [...(m?.itens ?? []), ...r.itens], cursor: r.nextCursor }));
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setCarregandoMais(false);
    }
  };

  const versao = (id: string | null) => (id ? (numeroVersao.has(id) ? `v${numeroVersao.get(id)}` : 'versão') : 'rascunho');

  return (
    <Painel
      titulo="Logs de execução"
      descricao="Cada mensagem que o agente processou. Clique numa linha para ver a análise, as decisões e os tempos registrados."
      corpo="pb-2"
    >
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <Abas
          valor={status}
          onChange={setStatus}
          opcoes={[
            { valor: 'todos', rotulo: 'Todos' },
            { valor: 'respondido', rotulo: 'Respondeu' },
            { valor: 'transferido', rotulo: 'Transferiu' },
            { valor: 'ignorado', rotulo: 'Ignorou' },
            { valor: 'erro', rotulo: 'Erro' },
          ]}
        />
        <label className="flex min-w-[200px] items-center gap-2 text-[13px] text-muted">
          <span className="shrink-0">Intenção</span>
          <select className="select" value={intencao} onChange={(e) => setIntencao(e.target.value)}>
            <option value="">Todas</option>
            {intencoes.map((i) => <option key={i} value={i}>{ROTULO_INTENCAO[i] ?? i}</option>)}
          </select>
        </label>
      </div>

      {pagina.carregando && !pagina.dados ? (
        <Esqueleto linhas={6} />
      ) : pagina.erro ? (
        <Erro texto={pagina.erro} tentar={() => void pagina.recarregar()} />
      ) : itens.length === 0 ? (
        <Vazio icone="list" titulo="Nenhuma execução encontrada" descricao={status !== 'todos' || intencao ? 'Nenhum registro com estes filtros.' : 'Quando o agente processar mensagens do WhatsApp, cada execução aparece aqui.'} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[860px]">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Mensagem do contato</th>
                  <th>Intenção</th>
                  <th>Status</th>
                  <th className="text-right">Blocos</th>
                  <th className="text-right">Latência</th>
                  <th className="text-right">Custo</th>
                  <th>Versão</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    aria-label={`Abrir execução de ${dataHora(r.createdAt)}`}
                    onClick={() => setAberto(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAberto(r);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap tabular">{dataHora(r.createdAt)}</td>
                    <td className="max-w-[280px]"><span className="block truncate">{r.mensagem ?? '-'}</span></td>
                    <td className="whitespace-nowrap">{r.intencao ? ROTULO_INTENCAO[r.intencao] ?? r.intencao : '-'}</td>
                    <td><StatusRunPill status={r.status} /></td>
                    <td className="text-right tabular">{inteiro(r.blocos)}</td>
                    <td className="text-right tabular">{duracao(r.latenciaMs)}</td>
                    <td className="text-right tabular">{usd(r.custoUsd)}</td>
                    <td className="whitespace-nowrap">{versao(r.versionId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cursor && (
            <div className="flex justify-center px-5 py-3">
              <button className="btn btn-ghost btn-sm" disabled={carregandoMais} onClick={() => void carregarMais()}>{carregandoMais ? 'Carregando…' : 'Carregar mais'}</button>
            </div>
          )}
        </>
      )}

      <Gaveta aberto={!!aberto} onFechar={() => setAberto(null)} titulo={aberto ? `Execução de ${dataHora(aberto.createdAt)}` : 'Execução'} largura="sm:w-[640px]">
        {aberto && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusRunPill status={aberto.status} />
              <span className="pill">{versao(aberto.versionId)}</span>
              {aberto.modelo && <span className="pill">{aberto.modelo}</span>}
              <Link href={`/inbox?c=${aberto.conversationId}`} className="btn btn-soft btn-sm ml-auto"><Icon name="inbox" size={14} /> Ver conversa</Link>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[
                ['Intenção', aberto.intencao ? ROTULO_INTENCAO[aberto.intencao] ?? aberto.intencao : '-'],
                ['Confiança', porcento(aberto.confianca)],
                ['Sentimento', aberto.sentimento ?? '-'],
                ['Urgência', aberto.urgencia ?? '-'],
                ['Blocos', inteiro(aberto.blocos)],
                ['Latência', duracao(aberto.latenciaMs)],
                ['Tokens', `${inteiro(aberto.tokensEntrada)} / ${inteiro(aberto.tokensSaida)}`],
                ['Custo', usd(aberto.custoUsd)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface2/60 px-3 py-2">
                  <dt className="text-[11.5px] text-muted">{k}</dt>
                  <dd className="text-[13.5px] font-medium text-fg">{v}</dd>
                </div>
              ))}
            </dl>
            {aberto.motivo && (
              <div className="rounded-xl border border-line bg-surface2/60 px-3.5 py-2.5 text-[13px]">
                <p className="text-muted">Motivo registrado</p>
                <p className="mt-0.5 text-fg">{aberto.motivo}</p>
              </div>
            )}
            {aberto.mensagem && (
              <div className="rounded-xl border border-line px-3.5 py-2.5 text-[13px]">
                <p className="text-muted">Mensagem do contato</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-fg">{aberto.mensagem}</p>
              </div>
            )}
            <TraceDetalhe trace={aberto.trace ?? {}} tokens={{ entrada: aberto.tokensEntrada, saida: aberto.tokensSaida }} custoUsd={Number(aberto.custoUsd)} />
          </div>
        )}
      </Gaveta>
    </Painel>
  );
}

function FilaEntrega({ agenteId }: { agenteId: string }) {
  const [status, setStatus] = useState<FiltroEntrega>('todas');
  const lista = useCarga(() => agentesApi.entregas(agenteId, status === 'todas' ? undefined : status), [agenteId, status]);
  return (
    <Painel
      titulo="Fila de entrega"
      descricao="Blocos de mensagem enviados ao WhatsApp em sequência, com o atraso de digitação. Uma sequência é cancelada se o contato escrever de novo antes do fim."
      corpo="pb-2"
      acao={<button className="btn btn-ghost btn-sm" onClick={() => void lista.recarregar()} disabled={lista.carregando}><Icon name="refresh" size={14} /> Atualizar</button>}
    >
      <div className="px-5 pb-3 pt-4">
        <Abas
          valor={status}
          onChange={setStatus}
          opcoes={[
            { valor: 'todas', rotulo: 'Todas' },
            { valor: 'pendente', rotulo: 'Pendentes' },
            { valor: 'enviando', rotulo: 'Enviando' },
            { valor: 'enviado', rotulo: 'Enviadas' },
            { valor: 'falhou', rotulo: 'Falharam' },
            { valor: 'cancelado', rotulo: 'Canceladas' },
          ]}
        />
      </div>
      {lista.carregando && !lista.dados ? (
        <Esqueleto linhas={5} />
      ) : lista.erro ? (
        <Erro texto={lista.erro} tentar={() => void lista.recarregar()} />
      ) : !lista.dados?.length ? (
        <Vazio icone="send" titulo="Nenhuma entrega" descricao={status === 'todas' ? 'Os blocos enviados pelo agente aparecem aqui.' : 'Nenhuma entrega com este status.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Sequência</th>
                <th>Bloco</th>
                <th>Texto</th>
                <th>Status</th>
                <th className="text-right">Tentativas</th>
                <th>Motivo</th>
                <th>Agendado</th>
                <th>Enviado</th>
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-[12px] text-muted" title={e.sequenciaId}>{e.sequenciaId.slice(0, 8)}</td>
                  <td className="whitespace-nowrap tabular">{e.ordem}/{e.total}</td>
                  <td className="max-w-[260px]"><span className="block truncate" title={e.texto}>{e.texto}</span></td>
                  <td><span className={cx('pill', TOM_ENTREGA[e.status])}>{ROTULO_ENTREGA[e.status] ?? e.status}</span></td>
                  <td className="text-right tabular">{inteiro(e.tentativas)}</td>
                  <td className="max-w-[200px]"><span className="block truncate" title={e.motivo ?? undefined}>{e.motivo ?? '-'}</span></td>
                  <td className="whitespace-nowrap tabular">{dataHora(e.agendadoPara)}</td>
                  <td className="whitespace-nowrap tabular">{dataHora(e.enviadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  );
}
