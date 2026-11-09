'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { automations, type RunDetalhe } from '@/lib/automations';
import { crm } from '@/lib/crm';

type ContatoOpcao = { id: string; nome: string; detalhe: string };

const ROTULO_STATUS: Record<string, string> = {
  rodando: 'Rodando',
  esperando: 'Aguardando',
  concluido: 'Concluído',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
};

function rotuloPasso(tipo: string): string {
  const mapa: Record<string, string> = {
    'gatilho.contato_criado': 'Gatilho',
    'gatilho.tag_adicionada': 'Gatilho',
    'acao.enviar_sms': 'Mensagem',
    'acao.notificar_equipe': 'Aviso à equipe',
    'acao.adicionar_tag': 'Tag',
    'acao.remover_tag': 'Tag',
    'acao.criar_oportunidade': 'Oportunidade',
    'acao.mover_etapa': 'Mover etapa',
    'acao.criar_tarefa': 'Tarefa',
    'acao.criar_nota': 'Nota',
    'controle.esperar': 'Espera',
    'controle.esperar_resposta': 'Espera de resposta',
    'controle.condicao': 'Condição',
    'controle.ir_para': 'Ir para',
  };
  return mapa[tipo] ?? tipo;
}

/**
 * Teste da automação com um contato real (POST /workflows/:id/testar): o run
 * é marcado como teste e aparece aqui passo a passo. Avisos honestos: ações
 * acontecem de verdade (tag, oportunidade) e, fora de produção, mensagens só
 * saem para o número de teste (trava de dev do MessagesService).
 */
export function TestarAutomacao({ workflowId, rotulos, onFechar }: { workflowId: string; rotulos: Record<string, string>; onFechar: () => void }) {
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<ContatoOpcao[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [semResultado, setSemResultado] = useState(false);
  const [contato, setContato] = useState<ContatoOpcao | null>(null);
  const [run, setRun] = useState<RunDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pararPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => pararPoll, [pararPoll]);

  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) {
      setOpcoes([]);
      return;
    }
    setBuscando(true);
    setSemResultado(false);
    const t = setTimeout(() => {
      const ctl = new AbortController();
      const expira = setTimeout(() => ctl.abort(), 15000);
      crm
        .search(q)
        .then((r) => {
          const achados = r.filter((x) => x.tipo === 'contato').slice(0, 6).map((x) => ({ id: x.id, nome: x.titulo, detalhe: x.subtitulo }));
          setOpcoes(achados);
          setSemResultado(achados.length === 0);
        })
        .catch(() => {
          setOpcoes([]);
          setSemResultado(true);
        })
        .finally(() => {
          clearTimeout(expira);
          setBuscando(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const acompanhar = useCallback(
    (runId: string) => {
      pararPoll();
      const tick = () => {
        automations
          .run(runId)
          .then((d) => {
            setRun(d);
            if (['concluido', 'falhou', 'cancelado'].includes(d.status)) pararPoll();
          })
          .catch(() => pararPoll());
      };
      tick();
      pollRef.current = setInterval(tick, 2000);
    },
    [pararPoll],
  );

  const iniciar = async () => {
    if (!contato) return;
    setIniciando(true);
    setErro(null);
    try {
      const r = await automations.testar(workflowId, contato.id);
      if (!r.runId) throw new Error('A execução de teste não foi criada.');
      acompanhar(r.runId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui iniciar o teste.');
    } finally {
      setIniciando(false);
    }
  };

  const cancelar = async () => {
    if (!run) return;
    try {
      await automations.cancelar(run.id);
      acompanhar(run.id);
    } catch {
      setErro('Não consegui cancelar a execução.');
    }
  };

  const terminal = run && ['concluido', 'falhou', 'cancelado'].includes(run.status);

  return (
    <div className="lg-backdrop fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onFechar}>
      <Card className="lg-sheet w-full max-w-lg animate-scale-in p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="t-section">Testar automação</h2>
            <p className="mt-1 text-[13px] text-muted">Roda o fluxo com um contato de verdade, sem esperar o gatilho.</p>
          </div>
          <button type="button" onClick={onFechar} className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar">
            <Icon name="close" size={16} />
          </button>
        </div>

        {!run && (
          <div className="mt-4 space-y-3">
            <div className="relative">
              <input
                className="input w-full"
                placeholder="Buscar contato por nome, telefone ou e-mail"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setContato(null);
                }}
                aria-label="Buscar contato para o teste"
              />
              {opcoes.length > 0 && !contato && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-[var(--base-0)] shadow-lg">
                  {opcoes.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-[var(--fill-4)]"
                        onClick={() => {
                          setContato(o);
                          setBusca(o.nome);
                          setOpcoes([]);
                        }}
                      >
                        <span className="text-[13.5px] font-medium text-fg">{o.nome}</span>
                        <span className="text-[12px] text-muted">{o.detalhe}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {buscando && <p className="text-[12px] text-muted">Buscando…</p>}
            {!buscando && semResultado && !contato && <p className="text-[12px] text-muted">Nenhum contato encontrado. Confira se você está na operação certa.</p>}

            <div className="rounded-xl bg-[var(--fill-4)] p-3 text-[12.5px] leading-relaxed text-muted">
              <p>· Tags, oportunidade e tarefas do fluxo são criadas de verdade para este contato. Prefira um contato de teste.</p>
              <p className="mt-1">· Neste ambiente, as mensagens não vão para o contato: saem apenas para o número de teste da equipe.</p>
            </div>

            {erro && <p className="text-[13px] text-danger">{erro}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onFechar}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={!contato || iniciando} onClick={() => void iniciar()}>
                <Icon name="play" size={15} />
                {iniciando ? 'Iniciando…' : 'Rodar teste'}
              </button>
            </div>
          </div>
        )}

        {run && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-medium text-fg">
                Teste com {contato?.nome}
                <span
                  className={cx(
                    'pill ml-2',
                    run.status === 'concluido' && 'pill-success',
                    run.status === 'falhou' && 'pill-danger',
                    (run.status === 'rodando' || run.status === 'esperando') && 'pill-brand',
                    run.status === 'cancelado' && 'pill-warning',
                  )}
                >
                  {ROTULO_STATUS[run.status] ?? run.status}
                </span>
              </p>
              {!terminal && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelar()}>
                  Cancelar execução
                </button>
              )}
            </div>
            {run.status === 'esperando' && <p className="mt-1 text-[12.5px] text-muted">Numa espera do fluxo. As próximas etapas acontecem no tempo programado.</p>}
            {run.erro && <p className="mt-2 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">{run.erro}</p>}

            <ol className="scrollbar-thin mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {run.passos.map((s) => (
                <li key={s.id} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2">
                  <span
                    className={cx(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                      s.status === 'ok' ? 'bg-lime-soft text-lime-ink' : 'bg-[var(--danger-soft)] text-danger',
                    )}
                  >
                    <Icon name={s.status === 'ok' ? 'check' : 'close'} size={11} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">
                      {rotulos[s.noId] ?? rotuloPasso(s.tipo)}
                      <span className="ml-1.5 text-[11px] font-normal text-muted">{rotuloPasso(s.tipo)}</span>
                    </p>
                    {typeof s.saida?.texto === 'string' && <p className="mt-0.5 whitespace-pre-line text-[12px] text-muted">{String(s.saida.texto).slice(0, 180)}</p>}
                    {s.erro && <p className="mt-0.5 text-[12px] text-danger">{s.erro}</p>}
                  </div>
                </li>
              ))}
              {run.passos.length === 0 && <li className="py-4 text-center text-[13px] text-muted">Iniciando a execução…</li>}
            </ol>

            <div className="mt-4 flex justify-end">
              <button type="button" className="btn btn-soft" onClick={onFechar}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
