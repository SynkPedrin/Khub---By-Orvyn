'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, ROTULO_COMPORTAMENTO, ROTULO_INTENCAO, usd, type Avaliacao, type CampoComportamento, type Cenario, type Expectativas, type Proposta } from '@/lib/agents';
import { Abas, Alternar, Campo, Confirmar, Erro, Esqueleto, Gaveta, ListaTextos, Metrica, Modal, Painel, Vazio, useAcao, useCarga } from '../kit';
import type { SecaoProps } from '../editor';

type StatusProposta = Proposta['status'];
const ROTULO_STATUS_PROPOSTA: Record<StatusProposta, string> = { aberta: 'Abertas', em_avaliacao: 'Em avaliação', aprovada: 'Aprovadas', rejeitada: 'Rejeitadas', aplicada: 'Aplicadas' };
const ROTULO_TIPO_EVENTO: Record<string, string> = {
  transferencia: 'Transferências',
  lacuna_conhecimento: 'Lacunas na base',
  baixa_confianca: 'Baixa confiança',
  objecao: 'Objeções',
  guardrail: 'Guardrail',
  erro_ferramenta: 'Erros de ferramenta',
  correcao_humana: 'Correções humanas',
  feedback: 'Feedback',
  conversao: 'Conversões',
  perda: 'Perdas',
  sem_resposta: 'Sem resposta',
};

/** Learning Center + Evaluation: padrões, propostas com aprovação humana, cenários e avaliações de regressão. */
export function Aprendizado({ agente, catalogo, onAtualizado }: SecaoProps) {
  const [aba, setAba] = useState<'propostas' | 'cenarios' | 'avaliacoes'>('propostas');
  const resumo = useCarga(() => agentesApi.aprendizado(agente.id), [agente.id]);
  const { ocupado, executar } = useAcao();

  const analisar = async () => {
    const r = await executar('analisar', () => agentesApi.analisarAprendizado(agente.id));
    if (r) {
      void resumo.recarregar();
      setAba('propostas');
    }
  };

  return (
    <div className="space-y-5">
      <Painel
        titulo="Aprendizado controlado"
        descricao="O agente aprende padrões das conversas e propõe melhorias. Nada muda sozinho: comportamento e regras só mudam depois de avaliação de regressão e aprovação humana. Permissões, limites e políticas nunca são alterados pelo aprendizado."
        acao={<button className="btn btn-soft btn-sm" disabled={ocupado === 'analisar'} onClick={analisar}><Icon name="refresh" size={14} /> {ocupado === 'analisar' ? 'Analisando…' : 'Analisar agora'}</button>}
      >
        {resumo.erro ? <Erro texto={resumo.erro} tentar={resumo.recarregar} /> : !resumo.dados ? <Esqueleto linhas={2} /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.keys(ROTULO_TIPO_EVENTO).filter((k) => resumo.dados!.eventos[k]).slice(0, 8).map((k) => (
                <Metrica key={k} rotulo={ROTULO_TIPO_EVENTO[k]} valor={resumo.dados!.eventos[k]} detalhe="últimos 30 dias" />
              ))}
              {Object.keys(resumo.dados.eventos).length === 0 && <p className="col-span-full text-[13px] text-muted">Ainda não há eventos. Eles aparecem conforme o agente atende.</p>}
            </div>
            {resumo.dados.padroes.length > 0 && (
              <div>
                <p className="t-label mb-2">Padrões mais frequentes</p>
                <ul className="flex flex-wrap gap-1.5">
                  {resumo.dados.padroes.map((p) => <li key={`${p.tipo}:${p.chave}`} className="pill">{ROTULO_TIPO_EVENTO[p.tipo] ?? p.tipo}: {p.chave} <b className="tabular">{p.ocorrencias}</b></li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Painel>

      <Abas valor={aba} onChange={setAba} opcoes={[{ valor: 'propostas', rotulo: 'Propostas de melhoria' }, { valor: 'cenarios', rotulo: 'Cenários de teste' }, { valor: 'avaliacoes', rotulo: 'Avaliações' }]} />
      {aba === 'propostas' && <Propostas agenteId={agente.id} onAplicada={async () => onAtualizado(await agentesApi.obter(agente.id))} />}
      {aba === 'cenarios' && <Cenarios agenteId={agente.id} intencoes={catalogo.intencoesBase} ferramentas={catalogo.ferramentas.map((f) => f.nome)} />}
      {aba === 'avaliacoes' && <Avaliacoes agenteId={agente.id} temVersao={!!agente.versaoPublicada} />}
    </div>
  );
}

// ------------------------------------------------------------------ propostas

function Propostas({ agenteId, onAplicada }: { agenteId: string; onAplicada: () => Promise<void> }) {
  const [status, setStatus] = useState<StatusProposta>('aberta');
  const lista = useCarga(() => agentesApi.propostas(agenteId), [agenteId]);
  const { ocupado, executar } = useAcao();
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [publicar, setPublicar] = useState(true);
  const [forcar, setForcar] = useState<Proposta | null>(null);

  // Proposta em avaliação: acompanha até sair desse estado.
  const emAvaliacao = (lista.dados ?? []).some((p) => p.status === 'em_avaliacao');
  useEffect(() => {
    if (!emAvaliacao) return;
    const t = setInterval(() => void lista.recarregar(), 4000);
    return () => clearInterval(t);
  }, [emAvaliacao]); // eslint-disable-line react-hooks/exhaustive-deps

  const aprovar = async (p: Proposta, extra: { forcar?: boolean } = {}) => {
    const conteudo = p.tipo === 'conhecimento' && !p.patch ? respostas[p.id] ?? p.conteudoSugerido ?? '' : undefined;
    const r = await executar(p.id, () => agentesApi.aprovarProposta(p.id, { conteudo, publicar, forcar: extra.forcar }),
      p.tipo === 'conhecimento' && !p.patch ? 'Resposta oficial adicionada à base' : extra.forcar ? 'Proposta aplicada no rascunho sem avaliação' : 'Avaliação de regressão iniciada');
    if (r) {
      await lista.recarregar();
      if (r.status === 'aplicada') await onAplicada();
    }
  };
  const rejeitar = async (p: Proposta) => {
    if (await executar(p.id, () => agentesApi.rejeitarProposta(p.id), 'Proposta rejeitada')) await lista.recarregar();
  };

  if (lista.erro) return <Erro texto={lista.erro} tentar={lista.recarregar} />;
  if (!lista.dados) return <Esqueleto linhas={3} />;
  const visiveis = lista.dados.filter((p) => p.status === status);
  const contagem = (s: StatusProposta) => lista.dados!.filter((p) => p.status === s).length;

  return (
    <Painel titulo="Propostas" descricao="Cada proposta nasce de um padrão recorrente, com evidências anonimizadas." acao={<Abas<StatusProposta> valor={status} onChange={setStatus} opcoes={(Object.keys(ROTULO_STATUS_PROPOSTA) as StatusProposta[]).map((s) => ({ valor: s, rotulo: ROTULO_STATUS_PROPOSTA[s], contagem: contagem(s) }))} />}>
      {visiveis.length === 0 ? <Vazio icone="trophy" titulo="Nenhuma proposta aqui" descricao={status === 'aberta' ? 'Use "Analisar agora" depois de algumas conversas para detectar padrões.' : undefined} /> : (
        <ul className="space-y-3">
          {visiveis.map((p) => (
            <li key={p.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="pill pill-brand">{p.tipo}</span>
                <span className="text-[14.5px] font-semibold text-fg">{p.titulo}</span>
                <span className="pill">{p.ocorrencias} ocorrência(s)</span>
                <span className="ml-auto text-xs text-faint">{dataHora(p.updatedAt)}</span>
              </div>
              <p className="mt-1.5 text-[13.5px] text-muted">{p.descricao}</p>
              {p.patch && <PatchLegivel patch={p.patch} />}
              {p.evidencias.length > 0 && (
                <details className="mt-2 text-[12.5px]">
                  <summary className="cursor-pointer text-muted">Evidências ({p.evidencias.length})</summary>
                  <ul className="mt-2 space-y-1.5">
                    {p.evidencias.map((e, i) => (
                      <li key={i} className="rounded-lg bg-surface2 px-3 py-2 text-muted">
                        {Object.entries(e).filter(([k]) => !['conversationId', 'em'].includes(k)).map(([k, v]) => <span key={k} className="block"><b className="text-fg">{k}:</b> {String(v)}</span>)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {status === 'aberta' && (
                <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                  {p.tipo === 'conhecimento' && !p.patch ? (
                    <Campo rotulo="Resposta oficial da empresa" dica="Só entra na base o que a empresa escrever aqui. Mensagens de clientes nunca viram verdade da empresa.">
                      <textarea className="textarea" rows={5} value={respostas[p.id] ?? p.conteudoSugerido ?? ''} onChange={(e) => setRespostas({ ...respostas, [p.id]: e.target.value })} />
                    </Campo>
                  ) : p.patch ? (
                    <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" className="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} /> Publicar automaticamente se a avaliação não detectar regressão</label>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary btn-sm" disabled={ocupado === p.id} onClick={() => aprovar(p)}>{p.patch ? 'Aprovar e avaliar' : 'Aprovar'}</button>
                    {p.patch && <button className="btn btn-ghost btn-sm" disabled={ocupado === p.id} onClick={() => setForcar(p)}>Aplicar sem avaliação</button>}
                    <button className="btn btn-ghost btn-sm" disabled={ocupado === p.id} onClick={() => rejeitar(p)}>Rejeitar</button>
                  </div>
                </div>
              )}
              {p.status === 'em_avaliacao' && <p className="mt-2 text-[12.5px] text-muted">Avaliando o rascunho com a mudança contra os cenários de teste…</p>}
            </li>
          ))}
        </ul>
      )}
      <Confirmar aberto={!!forcar} titulo="Aplicar sem avaliação" texto={<p>A mudança entra no rascunho sem passar pelos cenários de regressão. Use só quando tiver certeza; a publicação continua sendo um passo separado.</p>} confirmar="Aplicar" perigo onConfirmar={() => { const p = forcar; setForcar(null); if (p) void aprovar(p, { forcar: true }); }} onFechar={() => setForcar(null)} />
    </Painel>
  );
}

function PatchLegivel({ patch }: { patch: Record<string, unknown> }) {
  const comportamento = (patch.comportamento ?? {}) as Partial<Record<CampoComportamento, string>>;
  const regras = (patch.regrasAdicionar ?? []) as { nome: string }[];
  const consultar = (patch.consultarEmAdicionar ?? []) as string[];
  return (
    <div className="mt-2.5 space-y-2 rounded-xl bg-surface2 p-3 text-[13px]">
      <p className="t-label">Mudança proposta</p>
      {Object.entries(comportamento).map(([campo, texto]) => (
        <div key={campo}><span className="font-medium text-fg">{ROTULO_COMPORTAMENTO[campo as CampoComportamento]?.titulo ?? campo}:</span> <span className="whitespace-pre-wrap text-muted">{texto}</span></div>
      ))}
      {regras.length > 0 && <p className="text-muted">Novas regras: {regras.map((r) => r.nome).join(', ')}</p>}
      {consultar.length > 0 && <p className="text-muted">Consultar a base também em: {consultar.map((c) => ROTULO_INTENCAO[c] ?? c).join(', ')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ cenários

function Cenarios({ agenteId, intencoes, ferramentas }: { agenteId: string; intencoes: string[]; ferramentas: string[] }) {
  const lista = useCarga(() => agentesApi.cenarios(agenteId), [agenteId]);
  const { ocupado, executar } = useAcao();
  const [editando, setEditando] = useState<Cenario | null>(null);
  const [remover, setRemover] = useState<Cenario | null>(null);
  const novo = (): Cenario => ({ id: '', nome: '', mensagens: [{ de: 'contato', texto: '' }], expectativas: {}, ativo: true, origem: 'manual', createdAt: '' });

  const salvar = async () => {
    if (!editando) return;
    const c = editando;
    const ok = await executar<unknown>('salvar', () => (c.id ? agentesApi.atualizarCenario(agenteId, c.id, { nome: c.nome, mensagens: c.mensagens, expectativas: c.expectativas }) : agentesApi.criarCenario(agenteId, { nome: c.nome, mensagens: c.mensagens, expectativas: c.expectativas })), 'Cenário salvo');
    if (ok) {
      setEditando(null);
      void lista.recarregar();
    }
  };
  const alternar = async (c: Cenario) => {
    if (await executar(c.id, () => agentesApi.atualizarCenario(agenteId, c.id, { ativo: !c.ativo }))) void lista.recarregar();
  };

  if (lista.erro) return <Erro texto={lista.erro} tentar={lista.recarregar} />;
  if (!lista.dados) return <Esqueleto linhas={3} />;
  const e = editando;
  const exp = e?.expectativas ?? {};
  const setExp = (x: Partial<Expectativas>) => e && setEditando({ ...e, expectativas: { ...exp, ...x } });
  const ultimaDoContato = e ? e.mensagens[e.mensagens.length - 1]?.de === 'contato' && e.mensagens.every((m) => m.texto.trim()) : false;

  return (
    <Painel titulo="Cenários de teste" descricao="Conversas de referência com o que se espera do agente. São a régua da avaliação de regressão antes de publicar." acao={<button className="btn btn-soft btn-sm" onClick={() => setEditando(novo())}><Icon name="plus" size={14} /> Novo cenário</button>}>
      {lista.dados.length === 0 ? <Vazio icone="check2" titulo="Nenhum cenário" /> : (
        <ul className="divide-y divide-line">
          {lista.dados.map((c) => (
            <li key={c.id} className={cx('flex flex-wrap items-center gap-3 py-3', !c.ativo && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-fg">{c.nome}</span>
                <span className="block truncate text-xs text-muted">{c.mensagens[c.mensagens.length - 1]?.texto} · {c.origem}</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="checkbox" checked={c.ativo} disabled={ocupado === c.id} onChange={() => alternar(c)} /> Ativo</label>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditando(JSON.parse(JSON.stringify(c)) as Cenario)}>Editar</button>
              <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Remover ${c.nome}`} onClick={() => setRemover(c)}><Icon name="trash" size={13} /></button>
            </li>
          ))}
        </ul>
      )}

      <Modal aberto={!!e} onFechar={() => setEditando(null)} titulo={e?.id ? 'Editar cenário' : 'Novo cenário'} largura="max-w-2xl" rodape={<><button className="btn btn-ghost" onClick={() => setEditando(null)}>Cancelar</button><button className="btn btn-primary" disabled={!e?.nome.trim() || !ultimaDoContato || ocupado === 'salvar'} onClick={salvar}>Salvar</button></>}>
        {e && (
          <div className="space-y-4">
            <Campo rotulo="Nome"><input className="input" maxLength={120} value={e.nome} onChange={(x) => setEditando({ ...e, nome: x.target.value })} /></Campo>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-fg">Conversa (a última mensagem precisa ser do contato)</p>
              <ul className="space-y-2">
                {e.mensagens.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <select className="select h-9 w-28 shrink-0" value={m.de} onChange={(x) => setEditando({ ...e, mensagens: e.mensagens.map((y, j) => (j === i ? { ...y, de: x.target.value as 'contato' | 'ia' } : y)) })} aria-label="Autor">
                      <option value="contato">Contato</option>
                      <option value="ia">Agente</option>
                    </select>
                    <input className="input h-9" maxLength={2000} value={m.texto} onChange={(x) => setEditando({ ...e, mensagens: e.mensagens.map((y, j) => (j === i ? { ...y, texto: x.target.value } : y)) })} aria-label="Mensagem" />
                    {e.mensagens.length > 1 && <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remover mensagem" onClick={() => setEditando({ ...e, mensagens: e.mensagens.filter((_, j) => j !== i) })}><Icon name="close" size={13} /></button>}
                  </li>
                ))}
              </ul>
              {e.mensagens.length < 30 && <button className="btn btn-ghost btn-sm mt-2" onClick={() => setEditando({ ...e, mensagens: [...e.mensagens, { de: 'contato', texto: '' }] })}><Icon name="plus" size={13} /> Mensagem</button>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Deve conter" dica="Alternativas com |, ex.: 250|duzentos"><ListaTextos valores={exp.deveConter ?? []} onChange={(v) => setExp({ deveConter: v })} max={10} /></Campo>
              <Campo rotulo="Não deve conter"><ListaTextos valores={exp.naoDeveConter ?? []} onChange={(v) => setExp({ naoDeveConter: v })} max={10} /></Campo>
              <Campo rotulo="Intenção esperada">
                <select className="select" value={exp.intencaoEsperada ?? ''} onChange={(x) => setExp({ intencaoEsperada: x.target.value || undefined })}>
                  <option value="">Qualquer</option>
                  {intencoes.map((i) => <option key={i} value={i}>{ROTULO_INTENCAO[i] ?? i}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Transferência">
                <select className="select" value={exp.deveTransferir === undefined ? '' : exp.deveTransferir ? 'sim' : 'nao'} onChange={(x) => setExp({ deveTransferir: x.target.value === '' ? undefined : x.target.value === 'sim' })}>
                  <option value="">Não verificar</option>
                  <option value="sim">Deve transferir</option>
                  <option value="nao">Não deve transferir</option>
                </select>
              </Campo>
              <Campo rotulo="Ferramentas esperadas">
                <select className="select" multiple size={4} value={exp.ferramentasEsperadas ?? []} onChange={(x) => setExp({ ferramentasEsperadas: Array.from(x.target.selectedOptions).map((o) => o.value) })}>
                  {ferramentas.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Campo>
              <div className="space-y-3">
                <Alternar ligado={!!exp.exigeFonte} onChange={(v) => setExp({ exigeFonte: v })} rotulo="Exige fonte da base" />
                <Campo rotulo="Máximo de blocos"><input className="input" type="number" min={1} max={8} value={exp.maxBlocos ?? ''} onChange={(x) => setExp({ maxBlocos: x.target.value ? Number(x.target.value) : undefined })} /></Campo>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Confirmar aberto={!!remover} titulo="Remover cenário" texto={<p>O cenário deixa de fazer parte das avaliações.</p>} confirmar="Remover" perigo onConfirmar={async () => { const c = remover; setRemover(null); if (c && (await executar(c.id, () => agentesApi.removerCenario(agenteId, c.id), 'Cenário removido'))) void lista.recarregar(); }} onFechar={() => setRemover(null)} />
    </Painel>
  );
}

// ------------------------------------------------------------------ avaliações

function Avaliacoes({ agenteId, temVersao }: { agenteId: string; temVersao: boolean }) {
  const lista = useCarga(() => agentesApi.avaliacoes(agenteId), [agenteId]);
  const { ocupado, executar } = useAcao();
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const detalhe = useCarga(() => (detalheId ? agentesApi.avaliacao(detalheId) : Promise.resolve(null)), [detalheId]);

  const executando = (lista.dados ?? []).some((a) => a.status === 'executando');
  useEffect(() => {
    if (!executando) return;
    const t = setInterval(() => void lista.recarregar(), 3000);
    return () => clearInterval(t);
  }, [executando]); // eslint-disable-line react-hooks/exhaustive-deps

  const iniciar = async (alvo: 'rascunho' | 'versao') => {
    if (await executar(alvo, () => agentesApi.iniciarAvaliacao(agenteId, alvo), 'Avaliação iniciada')) void lista.recarregar();
  };

  return (
    <Painel
      titulo="Avaliações de regressão"
      descricao="Roda todos os cenários ativos pelo mesmo motor do atendimento (sem enviar nada) e compara com a versão publicada. Publicar um rascunho com regressão pede confirmação."
      acao={<>
        <button className="btn btn-primary btn-sm" disabled={!!ocupado || executando} onClick={() => iniciar('rascunho')}>Avaliar rascunho</button>
        {temVersao && <button className="btn btn-ghost btn-sm" disabled={!!ocupado || executando} onClick={() => iniciar('versao')}>Avaliar versão publicada</button>}
      </>}
    >
      {lista.erro ? <Erro texto={lista.erro} tentar={lista.recarregar} /> : !lista.dados ? <Esqueleto linhas={3} /> : lista.dados.length === 0 ? <Vazio icone="trophy" titulo="Nenhuma avaliação ainda" descricao="Requer a IA conectada: o juiz de qualidade é um modelo." /> : (
        <div className="overflow-x-auto">
          <table className="tbl w-full text-[13px]">
            <thead><tr><th className="text-left">Data</th><th className="text-left">Alvo</th><th className="text-left">Status</th><th className="text-right">Nota</th><th className="text-right">Delta</th><th className="text-right">Custo</th><th /></tr></thead>
            <tbody>
              {lista.dados.map((a) => (
                <tr key={a.id}>
                  <td>{dataHora(a.createdAt)}</td>
                  <td>{a.alvo}</td>
                  <td>
                    <span className={cx('pill', a.status === 'concluida' ? (a.regressao ? 'pill-danger' : 'pill-success') : a.status === 'falhou' ? 'pill-danger' : 'pill-info')}>
                      {a.status === 'concluida' ? (a.regressao ? 'Regressão' : 'Aprovada') : a.status === 'falhou' ? 'Falhou' : 'Executando'}
                    </span>
                  </td>
                  <td className="text-right tabular">{a.nota === null ? '-' : Number(a.nota).toFixed(1)}</td>
                  <td className="text-right tabular">{a.comparacao?.delta === null || a.comparacao?.delta === undefined ? '-' : `${a.comparacao.delta > 0 ? '+' : ''}${a.comparacao.delta}`}</td>
                  <td className="text-right tabular">{usd(a.custoUsd)}</td>
                  <td className="text-right"><button className="btn btn-ghost btn-sm" onClick={() => setDetalheId(a.id)}>Detalhes</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Gaveta aberto={!!detalheId} onFechar={() => setDetalheId(null)} titulo="Resultado da avaliação" largura="sm:w-[720px]">
        {detalhe.erro ? <Erro texto={detalhe.erro} /> : !detalhe.dados ? <Esqueleto linhas={5} /> : <DetalheAvaliacao a={detalhe.dados} />}
      </Gaveta>
    </Painel>
  );
}

function DetalheAvaliacao({ a }: { a: Avaliacao }) {
  const m = a.metricas as Record<string, number | null>;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '-' : v.toFixed(1));
  return (
    <div className="space-y-5">
      {a.erro && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-fg">{a.erro}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metrica rotulo="Nota" valor={a.nota === null ? '-' : Number(a.nota).toFixed(1)} detalhe={a.comparacao?.notaReferencia !== null && a.comparacao?.notaReferencia !== undefined ? `referência ${a.comparacao.notaReferencia}` : 'sem referência'} />
        <Metrica rotulo="Qualidade" valor={n(m.qualidade)} detalhe="de 5" />
        <Metrica rotulo="Precisão" valor={n(m.precisao)} detalhe="de 5" />
        <Metrica rotulo="Aderência à base" valor={n(m.aderenciaBase)} detalhe="de 5" />
        <Metrica rotulo="Naturalidade" valor={n(m.naturalidade)} detalhe="de 5" />
        <Metrica rotulo="Resolução" valor={n(m.resolucao)} detalhe="de 5" />
        <Metrica rotulo="Alucinação" valor={pct(m.taxaAlucinacao)} tom={(m.taxaAlucinacao ?? 0) > 0 ? 'danger' : undefined} />
        <Metrica rotulo="Transferência correta" valor={pct(m.transferenciaCorreta)} />
        <Metrica rotulo="Ferramentas corretas" valor={pct(m.ferramentasCorretas)} />
      </div>
      {a.regressao && a.comparacao && (
        <p className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-[13px] text-fg">
          Regressão detectada{a.comparacao.delta !== null ? ` (delta ${a.comparacao.delta})` : ''}{a.comparacao.pioraram.length ? `. Pioraram: ${a.comparacao.pioraram.join(', ')}` : ''}.
        </p>
      )}
      <ul className="space-y-3">
        {(a.resultados ?? []).map((r) => (
          <li key={r.cenarioId} className="rounded-xl border border-line p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium text-fg">{r.nome}</span>
              <span className="tabular text-[13px] text-muted">{r.erro ? 'erro' : r.nota.toFixed(1)}</span>
            </div>
            {r.erro && <p className="mt-1 text-xs text-danger">{r.erro}</p>}
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {r.checagens.map((c) => <li key={c.nome} className={cx('pill', c.ok ? 'pill-success' : c.critica ? 'pill-danger' : 'pill-warning')}>{c.ok ? '✓' : '✕'} {c.nome}</li>)}
            </ul>
            {r.saida.texto && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface2 px-3 py-2 text-[13px] text-fg">{r.saida.texto}</p>}
            {r.juiz?.comentario && <p className="mt-1.5 text-xs text-muted">Juiz: {r.juiz.comentario}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
