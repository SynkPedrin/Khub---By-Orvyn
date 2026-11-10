'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { KpiCard } from '@/components/revenue/Kpi';
import { KpiGrid } from '@/components/revenue/Page';
import { agentesApi, dataHora, inteiro, ROTULO_INTENCAO, ROTULO_STATUS_RUN, usd, type AgenteResumo, type StatusAgente } from '@/lib/agents';
import { Abas, Confirmar, Erro, Esqueleto, Modal, Painel, StatusAgentePill, Vazio, useAcao, useCarga } from '@/components/agents/kit';

type Filtro = 'todos' | StatusAgente;

/**
 * AGENT MANAGER — central de agentes da Subaccount. Tudo vem do backend
 * (GET /agents/dashboard, /agents, /agents/aprovacoes, /agents/arquivados).
 */
export default function AgentesPage() {
  const router = useRouter();
  const [dias, setDias] = useState(30);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [duplicar, setDuplicar] = useState<AgenteResumo | null>(null);
  const [nomeCopia, setNomeCopia] = useState('');
  const [arquivar, setArquivar] = useState<AgenteResumo | null>(null);
  const [excluir, setExcluir] = useState<{ id: string; nome: string } | null>(null);
  const { ocupado, executar } = useAcao();

  const painel = useCarga(() => agentesApi.dashboard(dias), [dias]);
  const lista = useCarga(() => agentesApi.listar(), []);
  const extras = useCarga(async () => ({ aprovacoes: await agentesApi.aprovacoes(), arquivados: await agentesApi.arquivados(), catalogo: await agentesApi.catalogo() }), []);

  const nomes = useMemo(() => new Map((lista.dados ?? []).map((a) => [a.id, a.nome])), [lista.dados]);
  const filtrados = (lista.dados ?? []).filter((a) => (filtro === 'todos' || a.status === filtro) && (!busca.trim() || `${a.nome} ${a.config.identidade.cargo} ${a.descricao ?? ''}`.toLowerCase().includes(busca.trim().toLowerCase())));
  const recarregarTudo = () => { void lista.recarregar(); void painel.recarregar(); void extras.recarregar(); };

  const status = async (a: AgenteResumo, s: 'ativo' | 'pausado' | 'arquivado') => {
    const r = await executar(`${a.id}:${s}`, () => agentesApi.status(a.id, s), s === 'ativo' ? `${a.nome} ativado` : s === 'pausado' ? `${a.nome} pausado` : `${a.nome} arquivado`);
    if (r) recarregarTudo();
  };
  const confirmarDuplicar = async () => {
    if (!duplicar) return;
    const r = await executar('duplicar', () => agentesApi.duplicar(duplicar.id, nomeCopia || undefined), 'Cópia criada como rascunho');
    setDuplicar(null);
    if (r) router.push(`/agentes/${r.id}`);
  };
  const confirmarExcluir = async () => {
    if (!excluir) return;
    const r = await executar('excluir', () => agentesApi.excluir(excluir.id, excluir.nome), 'Agente excluído definitivamente');
    setExcluir(null);
    if (r) recarregarTudo();
  };
  const decidir = async (execId: string, aprovar: boolean) => {
    const r = await executar(execId, () => (aprovar ? agentesApi.aprovar(execId) : agentesApi.rejeitar(execId)), aprovar ? 'Ação aprovada e executada' : 'Ação rejeitada');
    if (r) void extras.recarregar();
  };

  const d = painel.dados;
  const contagem = (s: Filtro) => (lista.dados ?? []).filter((a) => s === 'todos' || a.status === s).length;

  return (
    <div className="page-shell mx-auto min-w-0 w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="t-display">Agentes de IA</h1>
          <p className="mt-1.5 text-[15px] text-muted">Especialistas que atendem no WhatsApp, consultam a base, atualizam o CRM e fazem follow-up com contexto.</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <div className="segbar" role="tablist" aria-label="Período">
            {[7, 30, 90].map((n) => <button key={n} role="tab" aria-selected={dias === n} className="seg" onClick={() => setDias(n)}>{n} dias</button>)}
          </div>
          <Link href="/agentes/novo" className="btn btn-primary"><Icon name="plus" size={16} /> Novo agente</Link>
        </div>
      </div>

      {extras.dados && !extras.dados.catalogo.ia.configurada && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-[13.5px] text-fg">
          <Icon name="lock" size={15} />
          <span className="flex-1">IA não conectada (falta {extras.dados.catalogo.ia.faltando.join(', ')}). Os agentes identificam intenção e dados por regras, mas toda conversa vai para a equipe até a IA ser conectada.</span>
          <a href="/configuracoes?aba=integracoes" className="btn btn-sm btn-ghost">Conectar</a>
        </div>
      )}

      {painel.erro ? <Erro texto={painel.erro} tentar={painel.recarregar} /> : (
        <>
          <KpiGrid cols={6}>
            <KpiCard compacto loading={!d} label="Agentes" value={d ? inteiro(d.agentes.total) : ''} icon="ai" comparacao={d ? `${d.agentes.ativos} ativos · ${d.agentes.pausados} pausados` : undefined} />
            <KpiCard compacto loading={!d} label="Em treinamento" value={d ? inteiro(d.agentes.emTreinamento) : ''} icon="knowledge" tom="info" comparacao={d ? `${d.documentosProcessando} doc. indexando` : undefined} />
            <KpiCard compacto loading={!d} label="Conversas atendidas" value={d ? inteiro(d.conversasAtendidas) : ''} icon="chat" />
            <KpiCard compacto loading={!d} label="Mensagens enviadas" value={d ? inteiro(d.mensagensEnviadas) : ''} icon="send" />
            <KpiCard compacto loading={!d} label="Leads qualificados" value={d ? inteiro(d.leadsQualificados) : ''} icon="target" tom="success" />
            <KpiCard compacto loading={!d} label="Oportunidades recuperadas" value={d ? inteiro(d.oportunidadesRecuperadas) : ''} icon="refresh" tom="success" comparacao={d ? `${d.followupsEnviados} follow-ups` : undefined} />
            <KpiCard compacto loading={!d} label="Agendamentos" value={d ? inteiro(d.agendamentos) : ''} icon="calendar" />
            <KpiCard compacto loading={!d} label="Conversões" value={d ? inteiro(d.conversoes) : ''} icon="trophy" tom="success" />
            <KpiCard compacto loading={!d} label="Transferência humana" value={d ? `${d.taxaTransferencia}%` : ''} icon="users" tom={d && d.taxaTransferencia > 40 ? 'warning' : 'neutral'} />
            <KpiCard compacto loading={!d} label="Tokens" value={d ? inteiro(d.tokens) : ''} icon="bolt" tom="neutral" />
            <KpiCard compacto loading={!d} label="Custo estimado" value={d ? usd(d.custoUsd) : ''} icon="dollar" tom="neutral" />
            <KpiCard compacto loading={!d} label="Aprovações pendentes" value={d ? inteiro(d.aprovacoesPendentes) : ''} icon="shield" tom={d && d.aprovacoesPendentes ? 'warning' : 'neutral'} />
          </KpiGrid>
        </>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <Abas<Filtro> valor={filtro} onChange={setFiltro} opcoes={(['todos', 'ativo', 'pausado', 'rascunho'] as Filtro[]).map((f) => ({ valor: f, rotulo: f === 'todos' ? 'Todos' : f === 'ativo' ? 'Ativos' : f === 'pausado' ? 'Pausados' : 'Rascunhos', contagem: contagem(f) }))} />
            <input className="input h-9 w-full sm:w-64" placeholder="Buscar agente" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar agente" />
          </div>
          {lista.erro ? <Erro texto={lista.erro} tentar={lista.recarregar} /> : !lista.dados ? <Esqueleto linhas={4} /> : filtrados.length === 0 ? (
            <Vazio icone="ai" titulo={lista.dados.length ? 'Nenhum agente neste filtro' : 'Nenhum agente ainda'} descricao={lista.dados.length ? undefined : 'Crie um especialista com identidade, personalidade, base de conhecimento e regras próprias.'} acao={!lista.dados.length && <Link href="/agentes/novo" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> Criar o primeiro agente</Link>} />
          ) : (
            <ul className="divide-y divide-line p-2">
              {filtrados.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3.5 transition-colors hover:bg-surface2/60">
                  <Link href={`/agentes/${a.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={a.nome} size={42} src={a.config.identidade.avatarUrl ?? undefined} />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-fg">{a.nome}</span>
                        <StatusAgentePill status={a.status} />
                        {a.padrao && <span className="pill pill-brand">Padrão</span>}
                        {a.alteracoesNaoPublicadas && <span className="pill pill-warning">Não publicado</span>}
                        {a.aprovacoesPendentes > 0 && <span className="pill pill-danger">{a.aprovacoesPendentes} aprovação(ões)</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                        {a.config.identidade.cargo || 'Agente de atendimento'} · {extras.dados?.catalogo.modelos.find((m) => m.id === a.modelo)?.nome ?? a.modelo} · {a.versaoPublicada ? `v${a.versaoPublicada.numero}` : 'sem versão'} · {a.fontesConhecimento} fonte(s)
                      </span>
                    </span>
                  </Link>
                  <span className="grid grid-cols-4 gap-4 text-center text-[12px] text-muted max-md:w-full max-md:order-3">
                    <span><b className="block text-[15px] tabular text-fg">{a.conversasAtivas}</b>em conversa</span>
                    <span><b className="block text-[15px] tabular text-fg">{a.metricas7d.respondidas}</b>respostas 7d</span>
                    <span><b className="block text-[15px] tabular text-fg">{a.metricas7d.transferidas}</b>transferidas</span>
                    <span><b className={cx('block text-[15px] tabular', a.metricas7d.erros ? 'text-danger' : 'text-fg')}>{usd(a.metricas7d.custoUsd)}</b>custo 7d</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Link href={`/agentes/${a.id}?aba=simulador`} className="btn btn-ghost btn-sm btn-icon" title="Testar no simulador" aria-label={`Testar ${a.nome}`}><Icon name="chat" size={14} /></Link>
                    {a.status === 'ativo' ? (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Pausar" aria-label={`Pausar ${a.nome}`} disabled={!!ocupado} onClick={() => status(a, 'pausado')}><Icon name="pause" size={14} /></button>
                    ) : (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Ativar" aria-label={`Ativar ${a.nome}`} disabled={!!ocupado} onClick={() => status(a, 'ativo')}><Icon name="play" size={14} /></button>
                    )}
                    <button className="btn btn-ghost btn-sm btn-icon" title="Duplicar" aria-label={`Duplicar ${a.nome}`} onClick={() => { setDuplicar(a); setNomeCopia(`${a.nome} (cópia)`); }}><Icon name="paperclip" size={14} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon" title="Arquivar" aria-label={`Arquivar ${a.nome}`} onClick={() => setArquivar(a)}><Icon name="trash" size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <Painel titulo="Aprovações pendentes" descricao="Ações críticas pedidas pelos agentes. Só executam depois de aprovadas." corpo="px-5 pb-5 pt-3">
            {!extras.dados ? <Esqueleto linhas={2} /> : extras.dados.aprovacoes.length === 0 ? <p className="text-[13px] text-muted">Nada aguardando.</p> : (
              <ul className="space-y-2.5">
                {extras.dados.aprovacoes.slice(0, 8).map((x) => (
                  <li key={x.id} className="rounded-xl border border-line p-3">
                    <p className="text-[13.5px] font-medium text-fg">{x.ferramenta}</p>
                    <p className="mt-0.5 break-words text-xs text-muted">{x.agentId ? nomes.get(x.agentId) ?? 'agente' : 'agente'} · {dataHora(x.createdAt)} · {Object.entries(x.args).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</p>
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-primary btn-sm" disabled={ocupado === x.id} onClick={() => decidir(x.id, true)}>Aprovar</button>
                      <button className="btn btn-ghost btn-sm" disabled={ocupado === x.id} onClick={() => decidir(x.id, false)}>Rejeitar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Painel>

          <Painel titulo="Últimas atividades" corpo="px-2 pb-3 pt-2">
            {!d ? <Esqueleto linhas={3} /> : d.ultimasAtividades.length === 0 ? <p className="px-3 text-[13px] text-muted">Nenhuma atividade ainda.</p> : (
              <ul className="divide-y divide-line">
                {d.ultimasAtividades.map((x) => (
                  <li key={x.id}>
                    <Link href={x.agentId ? `/agentes/${x.agentId}?aba=logs` : '#'} className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface2">
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', x.status === 'respondido' ? 'bg-success' : x.status === 'erro' ? 'bg-danger' : 'bg-warning')} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{x.agente ?? 'Agente'} · {ROTULO_STATUS_RUN[x.status] ?? x.status}{x.intencao ? ` · ${ROTULO_INTENCAO[x.intencao] ?? x.intencao}` : ''}</span>
                      <span className="shrink-0 text-[11.5px] tabular text-faint">{dataHora(x.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Painel>

          {d && d.errosRecentes.length > 0 && (
            <Painel titulo="Erros recentes" corpo="px-5 pb-5 pt-3">
              <ul className="space-y-2 text-[13px]">
                {d.errosRecentes.map((e) => (
                  <li key={e.id} className="rounded-lg bg-danger-soft px-3 py-2">
                    <span className="block font-medium text-fg">{e.agente ?? 'Agente'} · {dataHora(e.createdAt)}</span>
                    <span className="block break-words text-xs text-muted">{e.motivo}</span>
                  </li>
                ))}
              </ul>
            </Painel>
          )}

          {extras.dados && extras.dados.arquivados.length > 0 && (
            <Painel titulo="Arquivados" descricao="Não atendem. Excluir apaga a configuração, versões e dados de aprendizado do agente; conversas continuam." corpo="px-5 pb-5 pt-3">
              <ul className="space-y-1.5">
                {extras.dados.arquivados.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-fg">{a.nome}</span>
                    <button className="btn btn-ghost btn-sm text-danger" onClick={() => setExcluir(a)}>Excluir</button>
                  </li>
                ))}
              </ul>
            </Painel>
          )}
        </div>
      </div>

      <Modal aberto={!!duplicar} onFechar={() => setDuplicar(null)} titulo="Duplicar agente" rodape={<><button className="btn btn-ghost" onClick={() => setDuplicar(null)}>Cancelar</button><button className="btn btn-primary" disabled={ocupado === 'duplicar'} onClick={confirmarDuplicar}>Duplicar</button></>}>
        <p className="mb-3 text-[14px] text-muted">A cópia leva configuração, fontes de conhecimento, estratégias de follow-up (desligadas) e cenários de teste. Nasce como rascunho.</p>
        <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-fg">Nome da cópia</span><input className="input" maxLength={80} value={nomeCopia} onChange={(e) => setNomeCopia(e.target.value)} /></label>
      </Modal>
      <Confirmar aberto={!!arquivar} titulo={`Arquivar ${arquivar?.nome ?? ''}`} texto={<p>O agente para de atender e os follow-ups agendados são cancelados. Conversas em andamento seguem para a equipe.</p>} confirmar="Arquivar" perigo onConfirmar={() => { const a = arquivar; setArquivar(null); if (a) void status(a, 'arquivado'); }} onFechar={() => setArquivar(null)} />
      <Confirmar aberto={!!excluir} titulo="Excluir agente definitivamente" texto={<p>Esta ação não pode ser desfeita. Configuração, versões, avaliações e aprendizado do agente serão apagados.</p>} confirmar="Excluir" perigo exigirTexto={excluir?.nome} onConfirmar={confirmarExcluir} onFechar={() => setExcluir(null)} />
    </div>
  );
}
