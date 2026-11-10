'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, inteiro, ROTULO_FERRAMENTA_GRUPO, valorTexto, type ExecucaoFerramenta, type FerramentaCatalogo } from '@/lib/agents';
import { BarraSalvar, Erro, Esqueleto, Painel, Vazio, igual, mensagemDeErro, useAcao, useCarga, useToast } from '../kit';
import type { SecaoProps } from '../editor';

const STATUS_EXEC: Record<string, { rotulo: string; tom: string }> = {
  executado: { rotulo: 'Executada', tom: 'pill-success' },
  aprovado: { rotulo: 'Aprovada', tom: 'pill-success' },
  simulado: { rotulo: 'Simulada', tom: 'pill-info' },
  aguardando_aprovacao: { rotulo: 'Aguardando aprovação', tom: 'pill-warning' },
  rejeitado: { rotulo: 'Rejeitada', tom: '' },
  negado: { rotulo: 'Negada', tom: 'pill-danger' },
  erro: { rotulo: 'Erro', tom: 'pill-danger' },
};
const ORIGEM_EXEC: Record<string, string> = { modelo: 'Decisão do agente', regra: 'Regra', aprovacao: 'Aprovação humana' };

function Interruptor({ ligado, onChange, rotulo, desabilitado }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => onChange(!ligado)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', ligado ? 'bg-brand' : 'bg-surface3')}
    >
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Ferramentas({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const opcionais = catalogo.ferramentas.filter((f) => !f.obrigatoria).map((f) => f.nome);
  const extrair = () => ({
    ferramentas: agente.ferramentas.filter((n) => opcionais.includes(n)).sort(),
    exigir: [...agente.config.permissoes.exigirConfirmacao].sort(),
  });
  const [rascunho, setRascunho] = useState(extrair);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setRascunho(extrair()); }, [agente.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const original = extrair();
  const sujo = !igual(rascunho, original);

  const ligada = (f: FerramentaCatalogo) => f.obrigatoria || rascunho.ferramentas.includes(f.nome);
  const alternar = (nome: string, v: boolean) => setRascunho((r) => ({ ...r, ferramentas: (v ? [...r.ferramentas, nome] : r.ferramentas.filter((n) => n !== nome)).sort() }));
  const alternarAprovacao = (nome: string, v: boolean) => setRascunho((r) => ({ ...r, exigir: (v ? [...r.exigir, nome] : r.exigir.filter((n) => n !== nome)).sort() }));

  const salvar = async () => {
    setSalvando(true);
    try {
      const a = await agentesApi.atualizar(agente.id, {
        ferramentas: rascunho.ferramentas,
        config: { permissoes: { ...agente.config.permissoes, exigirConfirmacao: rascunho.exigir } },
      });
      onAtualizado(a);
      toast('ok', 'Rascunho salvo. Publique para valer no atendimento.');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const grupos = (Object.keys(ROTULO_FERRAMENTA_GRUPO) as FerramentaCatalogo['grupo'][])
    .map((g) => ({ grupo: g, itens: catalogo.ferramentas.filter((f) => f.grupo === g) }))
    .filter((g) => g.itens.length > 0);
  const ativas = catalogo.ferramentas.filter(ligada).length;

  return (
    <div className="space-y-5">
      <Painel
        titulo="Ferramentas do CRM"
        descricao="O que o agente pode consultar e fazer no CRM. Toda ação vale só para o contato da conversa e fica registrada no log abaixo."
        acao={<span className="pill pill-brand">{ativas} de {catalogo.ferramentas.length} ligadas</span>}
      >
        <div className="space-y-6">
          {grupos.map(({ grupo, itens }) => (
            <section key={grupo} aria-labelledby={`grupo-${grupo}`}>
              <h3 id={`grupo-${grupo}`} className="t-label mb-2.5">{ROTULO_FERRAMENTA_GRUPO[grupo]}</h3>
              <ul className="grid gap-2.5 lg:grid-cols-2">
                {itens.map((f) => {
                  const on = ligada(f);
                  const exige = rascunho.exigir.includes(f.nome);
                  const semBase = f.nome === 'buscar_conhecimento' && !agente.conhecimentoAtivo;
                  return (
                    <li key={f.nome} className={cx('rounded-xl border border-line p-3.5', on && 'border-brand-border bg-brand-softer/40')}>
                      <div className="flex items-start gap-3">
                        <Interruptor ligado={on} onChange={(v) => alternar(f.nome, v)} rotulo={`${on ? 'Desligar' : 'Ligar'} ${f.rotulo}`} desabilitado={f.obrigatoria} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13.5px] font-medium text-fg">{f.rotulo}</span>
                            <span className={cx('pill', f.tipo === 'escrita' ? 'pill-warning' : 'pill-info')}>{f.tipo === 'escrita' ? 'Escrita' : 'Leitura'}</span>
                            {f.critica && <span className="pill pill-danger">Crítica</span>}
                            {f.obrigatoria && <span className="pill">Sempre ligada</span>}
                          </div>
                          <p className="mt-1 text-xs text-muted">{f.descricao}</p>
                          {semBase && on && (
                            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-fg">
                              <Icon name="alert" size={13} className="mt-px shrink-0 text-warning" />
                              <span>
                                A base de conhecimento está desligada, então esta ferramenta não fica disponível.{' '}
                                <Link className="text-brand hover:underline" href={`/agentes/${agente.id}?aba=conhecimento`}>Ligar a base</Link>
                              </span>
                            </p>
                          )}
                          {f.tipo === 'escrita' && (
                            <label className={cx('mt-2.5 flex items-center gap-2 text-[12.5px]', on ? 'text-fg' : 'text-faint')}>
                              <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={exige} disabled={!on} onChange={(e) => alternarAprovacao(f.nome, e.target.checked)} />
                              Requer aprovação humana antes de executar
                            </label>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Painel>

      <BarraSalvar sujo={sujo} salvando={salvando} onSalvar={() => void salvar()} onDescartar={() => setRascunho(extrair())} />

      <Execucoes agenteId={agente.id} catalogo={catalogo.ferramentas} />
    </div>
  );
}

// ------------------------------------------------------------------ aprovações e log

function Argumentos({ args }: { args: Record<string, unknown> }) {
  const entradas = Object.entries(args ?? {});
  if (!entradas.length) return <p className="text-xs text-muted">Sem argumentos.</p>;
  return (
    <dl className="grid gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[auto_minmax(0,1fr)]">
      {entradas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium text-muted">{k}</dt>
          <dd className="break-words text-fg">{valorTexto(v) || '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

function Execucoes({ agenteId, catalogo }: { agenteId: string; catalogo: FerramentaCatalogo[] }) {
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const pendentes = useCarga(() => agentesApi.execucoesFerramentas(agenteId, 'aguardando_aprovacao'), [agenteId]);
  const log = useCarga(() => agentesApi.execucoesFerramentas(agenteId), [agenteId]);
  const [resultados, setResultados] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const rotulo = (nome: string) => catalogo.find((f) => f.nome === nome)?.rotulo ?? nome;

  const recarregar = () => {
    void pendentes.recarregar();
    void log.recarregar();
  };
  const aprovar = async (e: ExecucaoFerramenta) => {
    const r = await executar(`apr:${e.id}`, () => agentesApi.aprovar(e.id));
    if (r) {
      const texto = r.ok ? 'Aprovada e executada' : `Aprovada, mas falhou: ${r.erro ?? 'erro desconhecido'}`;
      setResultados((x) => ({ ...x, [e.id]: { ok: r.ok, texto } }));
      toast(r.ok ? 'ok' : 'erro', texto);
      recarregar();
    }
  };
  const rejeitar = async (e: ExecucaoFerramenta) => {
    const r = await executar(`rej:${e.id}`, () => agentesApi.rejeitar(e.id), 'Ação rejeitada: nada foi executado');
    if (r) {
      setResultados((x) => ({ ...x, [e.id]: { ok: true, texto: 'Rejeitada' } }));
      recarregar();
    }
  };
  const decididas = Object.entries(resultados);

  return (
    <>
      <Painel
        titulo="Aguardando aprovação"
        descricao="Ações que o agente quis executar e dependem de alguém da equipe. O contato foi avisado de que a equipe vai confirmar."
        acao={<button className="btn btn-ghost btn-sm" onClick={() => void pendentes.recarregar()} disabled={pendentes.carregando}><Icon name="refresh" size={14} /> Atualizar</button>}
        corpo="p-0"
      >
        {pendentes.carregando && !pendentes.dados ? (
          <Esqueleto linhas={2} />
        ) : pendentes.erro && !pendentes.dados ? (
          <Erro texto={pendentes.erro} tentar={pendentes.recarregar} />
        ) : !pendentes.dados?.length ? (
          <Vazio icone="shield" titulo="Nada aguardando aprovação" descricao="Quando uma ferramenta que exige aprovação for acionada, ela aparece aqui." />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {pendentes.dados.map((e) => (
              <li key={e.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-fg">{rotulo(e.ferramenta)}</span>
                      <span className="text-xs text-muted">{dataHora(e.createdAt)} · {ORIGEM_EXEC[e.origem] ?? e.origem}</span>
                    </p>
                    <div className="mt-2 rounded-lg border border-line bg-surface2/60 p-2.5">
                      <Argumentos args={e.args} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-sm" disabled={!!ocupado} onClick={() => void rejeitar(e)}>Rejeitar</button>
                    <button className="btn btn-primary btn-sm" disabled={!!ocupado} onClick={() => void aprovar(e)}><Icon name="check" size={14} /> {ocupado === `apr:${e.id}` ? 'Executando…' : 'Aprovar'}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {decididas.length > 0 && (
          <div className="space-y-1.5 border-t border-line px-5 py-3" aria-live="polite">
            {decididas.map(([id, r]) => (
              <p key={id} className={cx('flex items-center gap-1.5 text-[13px]', r.ok ? 'text-success' : 'text-danger')}>
                <Icon name={r.ok ? 'check' : 'alert'} size={13} /> {r.texto}
              </p>
            ))}
          </div>
        )}
      </Painel>

      <Painel
        titulo="Execuções recentes"
        descricao="Tudo o que o agente consultou ou fez no CRM, com o resultado."
        acao={<button className="btn btn-ghost btn-sm" onClick={() => void log.recarregar()} disabled={log.carregando}><Icon name="refresh" size={14} /> Atualizar</button>}
        corpo="p-0"
      >
        {log.carregando && !log.dados ? (
          <Esqueleto linhas={4} />
        ) : log.erro && !log.dados ? (
          <Erro texto={log.erro} tentar={log.recarregar} />
        ) : !log.dados?.length ? (
          <Vazio icone="list" titulo="Nenhuma execução ainda" descricao="As chamadas de ferramenta aparecem aqui assim que o agente atender." />
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr><th>Ferramenta</th><th>Status</th><th>Origem</th><th>Latência</th><th>Erro</th><th>Data</th></tr>
              </thead>
              <tbody>
                {log.dados.map((e) => {
                  const st = STATUS_EXEC[e.status] ?? { rotulo: e.status, tom: '' };
                  return (
                    <tr key={e.id}>
                      <td className="font-medium text-fg">{rotulo(e.ferramenta)}</td>
                      <td><span className={cx('pill', st.tom)}>{st.rotulo}</span></td>
                      <td className="text-muted">{ORIGEM_EXEC[e.origem] ?? e.origem}</td>
                      <td className="tabular text-muted">{e.latenciaMs === null ? '-' : `${inteiro(e.latenciaMs)} ms`}</td>
                      <td className="max-w-[280px] break-words text-[12.5px] text-danger">{e.erro ?? ''}</td>
                      <td className="whitespace-nowrap text-muted">{dataHora(e.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
    </>
  );
}
