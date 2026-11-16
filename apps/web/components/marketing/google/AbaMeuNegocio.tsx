'use client';

import { useCallback, useEffect, useState } from 'react';
import { Avatar, Badge, Field } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Modal, Select, SkeletonCards, SkeletonRows, Textarea, useToast } from '@/components/kit';
import {
  codigoErroGoogle,
  googleApi,
  mensagemErroGoogle,
  type AvaliacaoGbp,
  type ContaGbp,
  type DesempenhoGbp,
  type LocalGbp,
} from '@/lib/google';
import { AvisoErro, AvisoInfo, Kpi, Secao, dataBr, numero } from './comum';

const SITUACAO: Record<string, { rotulo: string; tom: 'green' | 'amber' | 'neutral' }> = {
  OPEN: { rotulo: 'aberto', tom: 'green' },
  CLOSED_TEMPORARILY: { rotulo: 'fechado temporariamente', tom: 'amber' },
  CLOSED_PERMANENTLY: { rotulo: 'fechado permanentemente', tom: 'neutral' },
};
const DIA: Record<string, string> = { MONDAY: 'seg', TUESDAY: 'ter', WEDNESDAY: 'qua', THURSDAY: 'qui', FRIDAY: 'sex', SATURDAY: 'sáb', SUNDAY: 'dom' };
const ESTADO_RESPOSTA: Record<string, string> = { PENDING: 'em análise pelo Google', REJECTED: 'recusada pelo Google', APPROVED: 'publicada' };
const LIMITE_RESPOSTA = 4096;

type Problema = { codigo: string | null; mensagem: string };

function Estrelas({ n }: { n: number | null }) {
  if (n === null) return <span className="text-[11px] text-muted">sem nota</span>;
  return (
    <span className="inline-flex text-amber-500" aria-label={`${n} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={13} className={i <= n ? '' : 'opacity-25'} />)}
    </span>
  );
}

export function AbaMeuNegocio({ habilitado, admin }: { habilitado: boolean; admin: boolean }) {
  const toast = useToast();
  const [contas, setContas] = useState<ContaGbp[] | null>(null);
  const [conta, setConta] = useState('');
  const [locais, setLocais] = useState<LocalGbp[] | null>(null);
  const [local, setLocal] = useState('');
  const [problema, setProblema] = useState<Problema | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<{ itens: AvaliacaoGbp[]; media: number | null; total: number; proxima: string | null } | null>(null);
  const [erroAvaliacoes, setErroAvaliacoes] = useState<string | null>(null);
  const [desempenho, setDesempenho] = useState<DesempenhoGbp | null>(null);
  const [erroDesempenho, setErroDesempenho] = useState<string | null>(null);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [respondendo, setRespondendo] = useState<{ avaliacao: AvaliacaoGbp; texto: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const registrar = (e: unknown, padrao: string) => setProblema({ codigo: codigoErroGoogle(e), mensagem: mensagemErroGoogle(e, padrao) });

  const carregarContas = useCallback(() => {
    setProblema(null); setContas(null);
    googleApi.gbp.contas().then((c) => {
      setContas(c);
      if (c.length === 1) setConta(c[0]!.name);
    }).catch((e) => { setContas([]); registrar(e, 'Não consegui listar as contas do Perfil da Empresa.'); });
  }, []);

  useEffect(() => { if (habilitado) carregarContas(); }, [habilitado, carregarContas]);

  useEffect(() => {
    setLocais(null); setLocal('');
    if (!conta) return;
    googleApi.gbp.locais(conta).then((l) => {
      setLocais(l);
      if (l.length === 1) setLocal(l[0]!.name);
    }).catch((e) => { setLocais([]); registrar(e, 'Não consegui listar os locais.'); });
  }, [conta]);

  const carregarLocal = useCallback(() => {
    setAvaliacoes(null); setDesempenho(null); setErroAvaliacoes(null); setErroDesempenho(null);
    if (!conta || !local) return;
    googleApi.gbp.avaliacoes(conta, local)
      .then((r) => setAvaliacoes({ itens: r.avaliacoes, media: r.media, total: r.total, proxima: r.proximaPagina }))
      .catch((e) => setErroAvaliacoes(mensagemErroGoogle(e, 'Não consegui ler as avaliações.')));
    googleApi.gbp.desempenho(local)
      .then(setDesempenho)
      .catch((e) => setErroDesempenho(mensagemErroGoogle(e, 'Não consegui ler as métricas de desempenho.')));
  }, [conta, local]);

  useEffect(() => { carregarLocal(); }, [carregarLocal]);

  const carregarMais = async () => {
    if (!avaliacoes?.proxima) return;
    setMaisCarregando(true);
    try {
      const r = await googleApi.gbp.avaliacoes(conta, local, avaliacoes.proxima);
      setAvaliacoes({ ...avaliacoes, itens: [...avaliacoes.itens, ...r.avaliacoes], proxima: r.proximaPagina });
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui carregar mais avaliações.'));
    } finally {
      setMaisCarregando(false);
    }
  };

  const enviarResposta = async () => {
    if (!respondendo) return;
    setEnviando(true);
    try {
      const r = await googleApi.gbp.responder(respondendo.avaliacao.name, respondendo.texto.trim());
      setAvaliacoes((a) => a && {
        ...a,
        itens: a.itens.map((x) => (x.name === respondendo.avaliacao.name ? { ...x, resposta: { comentario: r.comentario, atualizadaEm: r.atualizadaEm, estado: r.estado } } : x)),
      });
      toast.success('Resposta enviada ao Google.');
      setConfirmar(false);
      setRespondendo(null);
    } catch (e) {
      toast.error(mensagemErroGoogle(e, 'Não consegui enviar a resposta.'));
      setConfirmar(false);
    } finally {
      setEnviando(false);
    }
  };

  if (!habilitado) {
    return <AvisoInfo>A conta Google conectada não autorizou o Perfil da Empresa. Reconecte em Integrações e marque a permissão de gerenciar o Perfil da Empresa.</AvisoInfo>;
  }

  if (problema?.codigo === 'google_meu_negocio_sem_acesso') {
    return (
      <Secao titulo="Perfil da Empresa aguardando liberação do Google">
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-fg">
          <p>{problema.mensagem}</p>
          <p className="text-xs text-muted">Tag Manager e Search Console continuam funcionando normalmente. Assim que o Google aprovar o projeto, esta aba passa a mostrar locais, avaliações e métricas sem nenhuma mudança no KHUB.</p>
          <Button size="sm" variant="ghost" icon="refresh" onClick={carregarContas}>Verificar de novo</Button>
        </div>
      </Secao>
    );
  }

  const atual = locais?.find((l) => l.name === local) ?? null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Conta">
          <Select value={conta} onChange={setConta} placeholder={contas === null ? 'Carregando…' : contas.length ? 'Escolha a conta' : 'Nenhuma conta'} disabled={!contas?.length} options={(contas ?? []).map((c) => ({ value: c.name, label: c.nome }))} />
        </Field>
        <Field label="Local (empresa)">
          <Select value={local} onChange={setLocal} placeholder={!conta ? 'Escolha a conta antes' : locais === null ? 'Carregando…' : locais.length ? 'Escolha o local' : 'Nenhum local'} disabled={!locais?.length} options={(locais ?? []).map((l) => ({ value: l.name, label: l.titulo }))} />
        </Field>
      </div>

      {problema && <AvisoErro mensagem={problema.mensagem} onTentar={carregarContas} />}

      {atual && (
        <Secao titulo={atual.titulo} acao={atual.mapsUri ? <a href={atual.mapsUri} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand hover:underline">Ver no Google Maps</a> : null}>
          <div className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div><p className="text-[11px] text-muted">Situação</p>{atual.situacao ? <Badge tone={SITUACAO[atual.situacao]?.tom ?? 'neutral'}>{SITUACAO[atual.situacao]?.rotulo ?? atual.situacao}</Badge> : <p className="text-fg">sem informação</p>}</div>
            <div><p className="text-[11px] text-muted">Categoria</p><p className="text-fg">{[atual.categoria, ...atual.categoriasExtras].filter(Boolean).join(', ') || 'sem categoria'}</p></div>
            <div><p className="text-[11px] text-muted">Telefone</p><p className="text-fg">{atual.telefone ?? 'sem telefone'}</p></div>
            <div><p className="text-[11px] text-muted">Endereço</p><p className="text-fg">{atual.endereco ?? 'sem endereço (atende na região)'}</p></div>
            <div><p className="text-[11px] text-muted">Site</p>{atual.site ? <a href={atual.site} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{atual.site}</a> : <p className="text-amber-600 dark:text-amber-400">sem site cadastrado</p>}</div>
            <div><p className="text-[11px] text-muted">Horário</p><p className="text-fg">{atual.horarios.length ? atual.horarios.map((h) => `${DIA[h.diaAbre ?? ''] ?? h.diaAbre} ${h.abre ?? ''} às ${h.fecha ?? ''}`).join(' · ') : 'sem horário cadastrado'}</p></div>
            {atual.descricao && <div className="sm:col-span-2 xl:col-span-3"><p className="text-[11px] text-muted">Descrição</p><p className="text-fg">{atual.descricao}</p></div>}
          </div>
          {(!atual.temVozDoComerciante || atual.edicoesPendentes) && (
            <div className="px-5 pb-4">
              <AvisoInfo>
                {!atual.temVozDoComerciante && 'O Google ainda não reconhece esta conta como dona verificada do perfil (sem "voz do comerciante"): edições e respostas podem não aparecer. '}
                {atual.edicoesPendentes && 'Há edições aguardando revisão do Google.'}
              </AvisoInfo>
            </div>
          )}
        </Secao>
      )}

      {local && (
        <>
          {erroDesempenho ? (
            <AvisoErro mensagem={erroDesempenho} onTentar={carregarLocal} />
          ) : !desempenho ? (
            <SkeletonCards count={4} label="Lendo métricas" />
          ) : (
            <>
              <p className="text-xs text-muted">Desempenho de {dataBr(desempenho.inicio)} a {dataBr(desempenho.fim)}.</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi rotulo="Visualizações do perfil" icone="eye" valor={numero(desempenho.impressoes.total)} detalhe={`Busca ${numero(desempenho.impressoes.buscaMovel + desempenho.impressoes.buscaDesktop)} · Maps ${numero(desempenho.impressoes.mapasMovel + desempenho.impressoes.mapasDesktop)}`} />
                <Kpi rotulo="Ligações" icone="phone" valor={numero(desempenho.ligacoes)} />
                <Kpi rotulo="Cliques no site" icone="link" valor={numero(desempenho.cliquesSite)} />
                <Kpi rotulo="Pedidos de rota" icone="globe" valor={numero(desempenho.rotas)} />
              </div>
            </>
          )}

          <Secao
            titulo={avaliacoes ? `Avaliações (${numero(avaliacoes.total)})` : 'Avaliações'}
            acao={avaliacoes?.media != null ? <span className="flex items-center gap-1.5 text-sm font-semibold text-fg"><Estrelas n={Math.round(avaliacoes.media)} /> {avaliacoes.media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span> : null}
          >
            {erroAvaliacoes && <div className="px-5 py-4"><AvisoErro mensagem={erroAvaliacoes} onTentar={carregarLocal} /></div>}
            {!avaliacoes && !erroAvaliacoes && <SkeletonRows rows={4} label="Lendo avaliações" />}
            {avaliacoes && (
              <div className="divide-y divide-line">
                {avaliacoes.itens.map((a) => (
                  <div key={a.name} className="flex gap-3 px-5 py-3">
                    <Avatar name={a.autor} size={34} src={a.foto ?? undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-fg">{a.anonimo ? 'Anônimo' : a.autor}</p>
                        <Estrelas n={a.estrelas} />
                        <span className="text-[11px] text-muted">{dataBr(a.criadaEm)}</span>
                      </div>
                      {a.comentario ? <p className="mt-1 whitespace-pre-line text-sm text-fg">{a.comentario}</p> : <p className="mt-1 text-xs text-muted">Só a nota, sem comentário.</p>}
                      {a.resposta ? (
                        <div className="mt-2 rounded-xl bg-surface2 px-3 py-2">
                          <p className="text-[11px] font-semibold text-muted">Sua resposta{a.resposta.estado ? ` · ${ESTADO_RESPOSTA[a.resposta.estado] ?? a.resposta.estado}` : ''}</p>
                          <p className="whitespace-pre-line text-sm text-fg">{a.resposta.comentario}</p>
                        </div>
                      ) : null}
                      {admin && (
                        <button onClick={() => setRespondendo({ avaliacao: a, texto: a.resposta?.comentario ?? '' })} className="mt-2 text-xs font-semibold text-brand hover:underline">
                          {a.resposta ? 'Editar resposta' : 'Responder'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!avaliacoes.itens.length && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma avaliação ainda.</p>}
                {avaliacoes.proxima && (
                  <div className="px-5 py-3 text-center"><Button size="sm" variant="ghost" loading={maisCarregando} onClick={carregarMais}>Carregar mais</Button></div>
                )}
              </div>
            )}
          </Secao>
        </>
      )}

      <Modal
        open={!!respondendo}
        onClose={() => setRespondendo(null)}
        title={respondendo?.avaliacao.resposta ? 'Editar resposta' : 'Responder avaliação'}
        description="A resposta fica pública no Google, abaixo da avaliação."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRespondendo(null)}>Cancelar</Button>
            <Button variant="primary" disabled={!respondendo?.texto.trim()} onClick={() => setConfirmar(true)}>Revisar e enviar</Button>
          </>
        }
      >
        {respondendo && (
          <div className="space-y-3">
            {respondendo.avaliacao.comentario && <p className="rounded-xl bg-surface2 px-3 py-2 text-sm text-muted">&ldquo;{respondendo.avaliacao.comentario}&rdquo;</p>}
            <Textarea value={respondendo.texto} onChange={(e) => setRespondendo({ ...respondendo, texto: e.target.value })} rows={5} maxLength={LIMITE_RESPOSTA} showCount aria-label="Resposta" autoFocus />
          </div>
        )}
      </Modal>

      <Confirm
        open={confirmar}
        onClose={() => setConfirmar(false)}
        onConfirm={enviarResposta}
        loading={enviando}
        tone="primary"
        confirmLabel="Publicar resposta"
        title="Publicar a resposta no Google?"
        description="Qualquer pessoa que vir o perfil vai ler esta resposta. O envio fica registrado na auditoria."
      />
    </div>
  );
}
