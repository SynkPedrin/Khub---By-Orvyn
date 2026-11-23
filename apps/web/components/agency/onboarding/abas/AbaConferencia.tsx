'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx, Field } from '@/components/ui';
import { Button, Drawer, Modal, Select, SkeletonLines, Textarea, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { TOM } from '@/lib/agency-daily';
import {
  STATUS_OB,
  STATUS_VERIFICACAO_ORDEM,
  VERIFICACAO,
  codigoErro,
  mensagemErro,
  onboardingApi,
  pendenciasDoErro,
  pendenciasFinalizacao,
  rotuloCampo,
  type Aprovacao,
  type ConfVerificacaoItem,
  type Conferencia,
  type Evidencia,
  type PendenciaFinalizacao,
  type StatusVerificacao,
} from '@/lib/onboarding';
import { LinkTarefaDaily, VerificacaoPill, VazioLocal, nomeMembro } from '../pecas';
import type { Aba, TabProps } from '../OnboardingDetalhe';

/** Seção da verificação → aba do onboarding onde ela se resolve. */
const SECAO_PARA_ABA: Record<string, Aba> = {
  coleta: 'dados',
  imersao: 'imersao',
  acessos: 'tarefas',
  trafego: 'tarefas',
  estrategia: 'inteligencia',
  analise: 'genna',
  identidade: 'dados',
  conteudo: 'tarefas',
  audiovisual: 'tarefas',
  agente_ia: 'agente',
  tarefas: 'tarefas',
  equipe: 'tarefas',
  qualidade: 'conferencia',
  aprovacao: 'conferencia',
};

/**
 * Conferência final: o painel de homologação. Cada seção com status derivado,
 * pendências e evidências; aprovações pendentes com decisão (owner/admin); e
 * a finalização — desabilitada enquanto o agregado indicar critérios
 * pendentes, com o 409 da API mostrando exatamente o que falta.
 */
export function AbaConferencia({ ob, membros, podeEditar, podeDecidir, recarregar, irParaAba }: TabProps) {
  const toast = useToast();
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState<ConfVerificacaoItem | null>(null);
  const [decidindo, setDecidindo] = useState<Aprovacao | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const carregarConf = useCallback(() => {
    setErro(null);
    onboardingApi
      .conferencia(ob.id)
      .then(setConf)
      .catch((e) => setErro(mensagemErro(e, 'Não foi possível carregar a conferência.')));
  }, [ob.id]);

  useEffect(carregarConf, [carregarConf, ob]);

  const pendentes = useMemo(() => (conf ? pendenciasFinalizacao(conf) : []), [conf]);
  const aprovacoesPendentes = useMemo(() => ob.approvals.filter((a) => a.status === 'pendente'), [ob.approvals]);
  const finalizado = ob.status === 'pronto';
  const editavel = podeEditar && !finalizado;

  const aoSalvarVerificacao = () => {
    setVerificando(null);
    recarregar(); // recarrega o detalhe; o efeito acima recarrega a conferência
  };

  if (erro) {
    return (
      <Section title="Conferência final">
        <VazioLocal icone="alert" titulo="Não foi possível carregar" texto={erro} acao={<Button size="sm" onClick={carregarConf}>Tentar de novo</Button>} />
      </Section>
    );
  }
  if (!conf) {
    return (
      <div className="card p-5">
        <SkeletonLines lines={6} label="Carregando conferência" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Estado finalizado */}
      {finalizado && (
        <div className="card border-l-success border-l-4 p-5">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-success">
            <Icon name="trophy" size={17} /> Pronto para operação
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Onboarding finalizado {ob.aprovadoPor ? `por ${nomeMembro(membros, ob.aprovadoPor)} ` : ''}
            {ob.aprovadoEm && (
              <>
                em <Quando data={ob.aprovadoEm} formato="data" />
              </>
            )}
            .
          </p>
        </div>
      )}

      {/* Finalização */}
      {!finalizado && (
        <Section
          title="Finalizar onboarding"
          info={podeDecidir ? 'A finalização revalida TODA a homologação no servidor e é idempotente' : 'Só owner/admin da agência pode finalizar'}
          action={
            <Button variant="primary" size="sm" icon="check2" disabled={!podeDecidir || pendentes.length > 0} onClick={() => setConfirmando(true)}>
              Finalizar onboarding
            </Button>
          }
        >
          {pendentes.length === 0 ? (
            <p className="text-[13px] text-success">Toda a homologação está verificada — falta só a aprovação final, concedida pelo botão acima.</p>
          ) : (
            <div>
              <p className="mb-2 text-[13px] text-muted">
                <span className="font-semibold tabular text-fg">{pendentes.length}</span> {pendentes.length === 1 ? 'critério pendente' : 'critérios pendentes'} para finalizar:
              </p>
              <ul className="space-y-1.5">
                {pendentes.map((p) => (
                  <li key={p.chave} className="flex flex-wrap items-center gap-2">
                    <VerificacaoPill status={p.status as StatusVerificacao} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{p.rotulo}</span>
                    <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => irParaAba(SECAO_PARA_ABA[secaoDaChave(conf, p.chave)] ?? 'conferencia')}>
                      Resolver
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Aprovações pendentes */}
      {aprovacoesPendentes.length > 0 && (
        <Section title="Aprovações pendentes" info="Pedidos que só owner/admin decidem">
          <ul className="divide-y divide-line">
            {aprovacoesPendentes.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-fg">{rotuloCampo(a.acao)}</span>
                  <span className="block text-[11.5px] text-faint">
                    Pedido por {nomeMembro(membros, a.solicitadoPor)} · <Quando data={a.createdAt} />
                    {typeof a.payload?.justificativa === 'string' && a.payload.justificativa ? ` · “${a.payload.justificativa}”` : ''}
                  </span>
                </span>
                {podeDecidir && !finalizado && (
                  <Button size="sm" variant="soft" onClick={() => setDecidindo(a)}>
                    Decidir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Conhecimento */}
      <Section title="Dados do negócio" info="Seções de conhecimento: confirmadas, pendentes e campos obrigatórios faltantes">
        <ul className="divide-y divide-line">
          {conf.conhecimento.map((c) => {
            const ok = !c.pendente && c.camposFaltantes.length === 0;
            return (
              <li key={c.secao} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold', ok ? TOM.success.pill : TOM.warning.pill)}>
                  <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', ok ? TOM.success.dot : TOM.warning.dot)} />
                  {ok ? 'Confirmada' : 'Pendente'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-fg">{c.rotulo}</span>
                  {c.camposFaltantes.length > 0 && <span className="block text-[11.5px] text-warning">Faltam: {c.camposFaltantes.map(rotuloCampo).join(', ')}</span>}
                  {ok && c.confirmadoEm && (
                    <span className="block text-[11.5px] text-faint">
                      Confirmada <Quando data={c.confirmadoEm} formato="data" />
                    </span>
                  )}
                </span>
                <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => irParaAba('dados')}>
                  Ver detalhes
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* Verificações por seção */}
      <Section title="Checklist de homologação" info="Status derivado das verificações de cada seção">
        {conf.verificacoes.length === 0 ? (
          <VazioLocal icone="target" titulo="Sem verificações" texto="O checklist é semeado quando o onboarding é iniciado." />
        ) : (
          <div className="space-y-4">
            {conf.verificacoes.map((s) => (
              <div key={s.secao} className="rounded-xl border border-line">
                <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2.5">
                  <VerificacaoPill status={s.status} />
                  <span className="text-[13.5px] font-semibold capitalize text-fg">{rotuloCampo(s.secao)}</span>
                  {s.pendencias > 0 && <span className="text-[11.5px] font-medium text-warning">{s.pendencias} pendente(s)</span>}
                </header>
                <ul className="divide-y divide-line">
                  {s.itens.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{v.rotulo}</span>
                        <span className="block text-[11.5px] text-faint">
                          {v.obrigatorio ? 'Obrigatória' : 'Opcional'}
                          {v.evidencias > 0 ? ` · ${v.evidencias} evidência(s)` : ''}
                          {v.verificadoPor ? ` · verificada por ${nomeMembro(membros, v.verificadoPor)}` : ''}
                          {v.verificadoEm ? (
                            <>
                              {' '}
                              · <Quando data={v.verificadoEm} formato="data" />
                            </>
                          ) : null}
                        </span>
                      </span>
                      <VerificacaoPill status={v.status} />
                      {v.taskId && <LinkTarefaDaily taskId={v.taskId}>Tarefa</LinkTarefaDaily>}
                      {editavel && v.chave !== 'aprovacao_final' && (
                        <Button size="sm" variant="ghost" onClick={() => setVerificando(v)}>
                          Verificar
                        </Button>
                      )}
                      {v.chave === 'aprovacao_final' && !finalizado && <span className="text-[11.5px] text-faint">Concedida ao finalizar</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Tarefas por seção */}
      {conf.tarefas.length > 0 && (
        <Section title="Tarefas da implantação" info="Progresso das tarefas do Daily vinculadas, por seção">
          <ul className="divide-y divide-line">
            {conf.tarefas.map((g) => (
              <li key={g.secao} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[13.5px] font-semibold capitalize text-fg">{rotuloCampo(g.secao)}</span>
                  <span className="text-xs tabular text-muted">
                    {g.concluidas}/{g.total} concluídas
                  </span>
                  {g.atrasadas > 0 && <span className="text-[11.5px] font-medium text-danger">{g.atrasadas} atrasada(s)</span>}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.itens.map((t) => (
                    <li key={t.taskId} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className={cx('min-w-0 flex-1 truncate', t.status === 'concluida' ? 'text-faint line-through' : 'text-fg')}>{t.titulo}</span>
                      {t.atrasada && <span className="text-[11.5px] font-medium text-danger">atrasada</span>}
                      <LinkTarefaDaily taskId={t.taskId} numero={t.numero} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <VerificarDrawer item={verificando} obId={ob.id} onClose={() => setVerificando(null)} onSalvo={aoSalvarVerificacao} />
      <DecidirAprovacaoModal aprovacao={decidindo} obId={ob.id} onClose={() => setDecidindo(null)} onDecidida={() => { setDecidindo(null); recarregar(); }} />
      <FinalizarModal open={confirmando} onClose={() => setConfirmando(false)} ob={ob} pendentes={pendentes} onFinalizado={() => { setConfirmando(false); recarregar(); }} />
    </div>
  );
}

function secaoDaChave(conf: Conferencia, chave: string): string {
  for (const s of conf.verificacoes) if (s.itens.some((v) => v.chave === chave)) return s.secao;
  return 'conferencia';
}

/** Registrar a transição de uma verificação (com evidências ou confirmação explícita sem elas). */
function VerificarDrawer({ item, obId, onClose, onSalvo }: { item: ConfVerificacaoItem | null; obId: string; onClose: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<StatusVerificacao>('pendente');
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [semEvidencia, setSemEvidencia] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setStatus(item.status);
      setEvidencias([]);
      setSemEvidencia(false);
      setMotivo('');
      setErro(null);
    }
  }, [item]);

  const salvar = async () => {
    if (!item || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const lista = evidencias.filter((e) => e.referencia?.trim() || e.observacao?.trim());
      await onboardingApi.verificar(obId, item.chave, {
        status,
        ...(lista.length ? { evidencias: lista } : {}),
        ...(status === 'verificado' && !lista.length ? { semEvidencia: true, motivo: motivo.trim() || undefined } : {}),
      });
      toast.success(`Verificação: ${VERIFICACAO[status].label}`);
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível registrar a verificação.'));
    } finally {
      setSalvando(false);
    }
  };

  const faltaEvidencia = status === 'verificado' && evidencias.filter((e) => e.referencia?.trim() || e.observacao?.trim()).length === 0;

  return (
    <Drawer
      open={!!item}
      onClose={onClose}
      title={item ? rotuloCampo(item.chave) : 'Verificação'}
      description={item?.rotulo}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Voltar para o onboarding
          </Button>
          <Button variant="primary" loading={salvando} disabled={faltaEvidencia && !semEvidencia} onClick={() => void salvar()}>
            Salvar verificação
          </Button>
        </>
      }
    >
      {item && (
        <div className="space-y-4">
          <Field label="Status">
            <Select value={status} onChange={(v) => setStatus(v as StatusVerificacao)} options={STATUS_VERIFICACAO_ORDEM.map((s) => ({ value: s, label: VERIFICACAO[s].label }))} />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-fg">Evidências</legend>
            <div className="space-y-2.5">
              {evidencias.map((e, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input h-8 text-[12.5px]" maxLength={60} placeholder="Tipo (ex.: link, print, nota)" value={e.tipo ?? ''} onChange={(ev) => setEvidencias((l) => l.map((x, j) => (j === i ? { ...x, tipo: ev.target.value } : x)))} />
                    <input className="input h-8 text-[12.5px]" maxLength={500} placeholder="Referência (URL ou descrição curta)" value={e.referencia ?? ''} onChange={(ev) => setEvidencias((l) => l.map((x, j) => (j === i ? { ...x, referencia: ev.target.value } : x)))} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input className="input h-8 flex-1 text-[12.5px]" maxLength={1000} placeholder="Observação (opcional)" value={e.observacao ?? ''} onChange={(ev) => setEvidencias((l) => l.map((x, j) => (j === i ? { ...x, observacao: ev.target.value } : x)))} />
                    <button type="button" aria-label="Remover evidência" className="btn btn-ghost btn-icon btn-sm" onClick={() => setEvidencias((l) => l.filter((_, j) => j !== i))}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" variant="ghost" icon="plus" className="mt-2" onClick={() => setEvidencias((l) => [...l, {}])}>
              Adicionar evidência
            </Button>
          </fieldset>

          {faltaEvidencia && (
            <div className="rounded-lg bg-warning-soft p-3">
              <label className="flex items-start gap-2.5 text-[13px] text-fg">
                <input type="checkbox" className="checkbox mt-0.5" checked={semEvidencia} onChange={(e) => setSemEvidencia(e.target.checked)} />
                Confirmo que verifiquei sem evidência anexada (o motivo vira registro)
              </label>
              {semEvidencia && <Textarea className="mt-2" rows={2} maxLength={500} placeholder="Motivo da confirmação sem evidência" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
            </div>
          )}

          {erro && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {erro}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** Decisão de uma aprovação pendente (owner/admin). */
function DecidirAprovacaoModal({ aprovacao, obId, onClose, onDecidida }: { aprovacao: Aprovacao | null; obId: string; onClose: () => void; onDecidida: () => void }) {
  const toast = useToast();
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState<'aprovar' | 'recusar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aprovacao) {
      setJustificativa('');
      setErro(null);
    }
  }, [aprovacao]);

  const decidir = async (aprovar: boolean) => {
    if (!aprovacao || salvando) return;
    setSalvando(aprovar ? 'aprovar' : 'recusar');
    setErro(null);
    try {
      await onboardingApi.decidirAprovacao(obId, aprovacao.id, aprovar, justificativa.trim() || undefined);
      toast.success(aprovar ? 'Aprovado' : 'Recusado');
      onDecidida();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível decidir.'));
      setSalvando(null);
    }
  };

  return (
    <Modal open={!!aprovacao} onClose={onClose} title={aprovacao ? `Decidir: ${rotuloCampo(aprovacao.acao)}` : ''} description="A decisão fica registrada na linha do tempo do onboarding.">
      <div className="space-y-4">
        {aprovacao?.acao === 'mudar_escopo' && typeof aprovacao.payload?.escopo === 'object' && (
          <p className="rounded-lg bg-surface2 px-3 py-2 text-[13px] text-muted">
            Escopo pedido: {Object.entries(aprovacao.payload.escopo as Record<string, unknown>).map(([k, v]) => `${rotuloCampo(k)}: ${v === true ? 'sim' : 'não'}`).join(' · ')}
          </p>
        )}
        <Field label="Justificativa (opcional)">
          <Textarea rows={3} maxLength={1000} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
        </Field>
        {erro && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={!!salvando}>
            Voltar
          </Button>
          <Button variant="danger" loading={salvando === 'recusar'} onClick={() => void decidir(false)}>
            Recusar
          </Button>
          <Button variant="primary" loading={salvando === 'aprovar'} onClick={() => void decidir(true)}>
            Aprovar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Confirmação da finalização com resumo; o 409 da API lista o que falta. */
function FinalizarModal({ open, onClose, ob, pendentes, onFinalizado }: { open: boolean; onClose: () => void; ob: TabProps['ob']; pendentes: PendenciaFinalizacao[]; onFinalizado: () => void }) {
  const toast = useToast();
  const [salvando, setSalvando] = useState(false);
  const [faltas, setFaltas] = useState<PendenciaFinalizacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFaltas([]);
      setErro(null);
    }
  }, [open]);

  const finalizar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    setFaltas([]);
    try {
      await onboardingApi.finalizar(ob.id);
      toast.success('Onboarding finalizado', { description: 'Cliente pronto para operação.' });
      onFinalizado();
    } catch (e) {
      if (codigoErro(e) === 'onboarding_pendencias') {
        // A lista do servidor é a verdade: alguém pode ter alterado algo enquanto o painel estava aberto.
        setFaltas(pendenciasDoErro(e));
        setErro(mensagemErro(e, 'Homologação incompleta.'));
      } else {
        setErro(mensagemErro(e, 'Não foi possível finalizar.'));
      }
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Finalizar onboarding"
      description={`Confirma a homologação de ${ob.cliente.nome}? A finalização revalida toda a checklist no servidor e marca o cliente como pronto para operação.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Voltar para o onboarding
          </Button>
          <Button variant="primary" icon="check2" loading={salvando} onClick={() => void finalizar()}>
            Confirmar finalização
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-muted">
          Status atual: <strong className="text-fg">{STATUS_OB[ob.status].label}</strong> · verificações obrigatórias pendentes na última conferência:{' '}
          <strong className="tabular text-fg">{pendentes.length}</strong>
        </p>
        {faltas.length > 0 && (
          <div className="rounded-lg bg-danger-soft p-3">
            <p className="mb-1.5 text-[13px] font-semibold text-danger">O servidor recusou: ainda falta verificar</p>
            <ul className="list-inside list-disc space-y-0.5 text-[13px] text-fg">
              {faltas.map((f) => (
                <li key={f.chave}>{f.rotulo}</li>
              ))}
            </ul>
          </div>
        )}
        {erro && !faltas.length && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Modal>
  );
}
