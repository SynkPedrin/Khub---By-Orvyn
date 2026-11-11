'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader, KpiGrid } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { Quando } from '@/components/revenue/Quando';
import { EmptyState } from '@/components/revenue/States';
import { CanalBadge, ScoreBadge, StatusBadge, canalRotulo, statusRotulo } from '@/components/revenue/lead-ui';
import { numero } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import { KPIS_LEADS, LEADS, TOTAL_LEADS } from '@/lib/demo/dataset';
import type { Lead } from '@/lib/revenue/types';
import { PainelLead } from './PainelLead';
import { NovoLeadModal } from '@/components/crm/NovoLeadModal';
import { ListaLeads } from '@/components/crm/leads/ListaLeads';

/**
 * LEADS — listagem
 *
 * Camadas: KPIs (o que mudou) → filtros (recortar) → tabela (agir) →
 * painel lateral (contexto sem perder a lista).
 *
 * O painel lateral existe para o caso dominante: qualificar vários leads em
 * sequência. Abrir a página inteira a cada um custaria duas navegações por
 * lead e perderia a posição na lista.
 */
export default function LeadsPage() {
  const demo = modoDemo();
  // Estado levantado: o botão do cabeçalho e o do estado vazio abrem o mesmo
  // modal, e a lista real recarrega quando `versao` muda.
  const [novoAberto, setNovoAberto] = useState(false);
  const [versao, setVersao] = useState(0);
  const abrirNovo = () => setNovoAberto(true);

  return (
    <PageShell>
      <PageHeader
        title="Leads"
        subtitle="Gerencie, acompanhe e converta mais oportunidades."
        quote={'"Mais leads.\nMais receita."'}
        actions={
          <>
            <SeloDemo />
            <button type="button" className="btn btn-primary" onClick={demo ? undefined : abrirNovo}>
              <Icon name="plus" size={16} />
              Novo Lead
            </button>
          </>
        }
      />

      {demo ? <LeadsComDados /> : <ListaLeads versao={versao} vazio={<LeadsVazio onNovo={abrirNovo} />} />}

      {!demo && novoAberto && (
        <NovoLeadModal
          onClose={() => setNovoAberto(false)}
          onCreated={() => {
            setNovoAberto(false);
            setVersao((v) => v + 1);
          }}
        />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

const FILTROS = [
  { chave: 'origem', rotulo: 'Fonte', padrao: 'Todas as fontes' },
  { chave: 'status', rotulo: 'Status', padrao: 'Todos os status' },
  { chave: 'responsavel', rotulo: 'Responsável', padrao: 'Todos os responsáveis' },
  { chave: 'score', rotulo: 'Score', padrao: 'Qualquer score' },
  { chave: 'canal', rotulo: 'Canal', padrao: 'Todos os canais' },
] as const;

function LeadsComDados() {
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<Lead | null>(LEADS[0] ?? null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set([LEADS[0]?.id].filter(Boolean) as string[]));
  const [ordem, setOrdem] = useState<'recentes' | 'score'>('recentes');

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = termo
      ? LEADS.filter((l) =>
          [l.nome, l.empresa, l.email, l.cargo].some((c) => c?.toLowerCase().includes(termo)),
        )
      : LEADS;

    return ordem === 'score'
      ? [...filtrados].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      : filtrados;
  }, [busca, ordem]);

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <KpiGrid>
        <KpiCard label="Novos Leads" value={numero(KPIS_LEADS.novos.valor)} icon="leads" delta={KPIS_LEADS.novos.delta} comparacao="vs. semana passada" />
        <KpiCard label="Qualificados" value={numero(KPIS_LEADS.qualificados.valor)} icon="chat" delta={KPIS_LEADS.qualificados.delta} comparacao="vs. semana passada" />
        <KpiCard
          label="Sem Resposta"
          value={numero(KPIS_LEADS.semResposta.valor)}
          icon="clock"
          tom="warning"
          delta={KPIS_LEADS.semResposta.delta}
          deltaBom={false}
          comparacao="vs. semana passada"
        />
        <KpiCard label="Leads Quentes" value={numero(KPIS_LEADS.quentes.valor)} icon="flame" tom="danger" delta={KPIS_LEADS.quentes.delta} comparacao="vs. semana passada" />
      </KpiGrid>

      {/* Filtros */}
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        {FILTROS.map((f) => (
          <div key={f.chave} className="field min-w-[168px] flex-1">
            <label htmlFor={`f-${f.chave}`}>{f.rotulo}</label>
            <select id={`f-${f.chave}`} className="select" defaultValue="">
              <option value="">{f.padrao}</option>
            </select>
          </div>
        ))}
        <button type="button" className="btn btn-soft">
          <Icon name="filter" size={15} />
          Mais filtros
        </button>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Tabela */}
        <section className="card flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <h2 className="t-section">
              Leads <span className="font-normal text-muted">({numero(TOTAL_LEADS)})</span>
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  className="input h-9 w-[190px] pl-9"
                  placeholder="Buscar leads..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  aria-label="Buscar na lista de leads"
                />
              </div>

              <select
                className="select h-9 w-auto"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as typeof ordem)}
                aria-label="Ordenar leads"
              >
                <option value="recentes">Mais recentes</option>
                <option value="score">Maior score</option>
              </select>

              {/* Alternador de visão: `aria-pressed`, não `aria-selected` —
                  este último exige role="tab", que não é o caso aqui. */}
              <div className="segbar" role="group" aria-label="Formato de exibição">
                <button type="button" className="seg" aria-pressed="true" aria-label="Ver em lista">
                  <Icon name="list" size={15} />
                </button>
                <button type="button" className="seg" aria-pressed="false" aria-label="Ver em cartões">
                  <Icon name="grid" size={15} />
                </button>
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-x-auto scrollbar-thin">
            {lista.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nenhum lead encontrado"
                description={`Nada corresponde a "${busca}". Tente outro termo ou limpe os filtros.`}
                action={
                  <button type="button" className="btn btn-sm" onClick={() => setBusca('')}>
                    Limpar busca
                  </button>
                }
              />
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-10">
                      <span className="sr-only">Selecionar</span>
                    </th>
                    <th>Lead / Empresa</th>
                    <th>Fonte</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Responsável</th>
                    <th>Última interação</th>
                    <th>Próxima ação</th>
                    <th className="w-10">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => (
                    <tr
                      key={l.id}
                      data-selected={selecionado?.id === l.id}
                      onClick={() => setSelecionado(l)}
                      className="cursor-pointer"
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={marcados.has(l.id)}
                          onChange={() => alternar(l.id)}
                          aria-label={`Selecionar ${l.nome}`}
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={l.nome} size={32} />
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold text-fg">{l.nome}</p>
                            <p className="truncate text-xs text-muted">{l.empresa}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <CanalBadge canal={l.origem} />
                      </td>
                      <td>
                        <ScoreBadge score={l.score} faixa={l.faixa} />
                      </td>
                      <td>
                        <StatusBadge status={l.status} />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={l.responsavel?.nome ?? '?'} size={24} />
                          <span className="truncate text-[13px] text-fg">
                            {l.responsavel?.nome.split(' ')[0]}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Quando data={l.ultimaInteracaoAt} className="whitespace-nowrap text-[13px] text-muted" />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <BotaoProximaAcao lead={l} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Mais ações para ${l.nome}`}>
                          <Icon name="dots" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Paginacao mostrando={lista.length} total={TOTAL_LEADS} />
        </section>

        {/* Painel lateral */}
        <aside className="min-w-0 2xl:sticky 2xl:top-4 2xl:self-start">
          {selecionado ? (
            <PainelLead lead={selecionado} onFechar={() => setSelecionado(null)} />
          ) : (
            <div className="card">
              <EmptyState icon="leads" title="Nenhum lead selecionado" description="Clique em uma linha para ver o resumo aqui." />
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function BotaoProximaAcao({ lead }: { lead: Lead }) {
  const acao = lead.proximaAcao;
  if (!acao) return <span className="text-[13px] text-faint">-</span>;

  const icone = { responder: 'chat', abrir: 'external', reengajar: 'mail', ligar: 'phone' } as const;
  // Ação de conversa vai para Conversas; as demais abrem o lead.
  const destino = acao.tipo === 'responder' ? '/conversas' : `/leads/${lead.id}`;

  return (
    <Link href={destino} className={cx('btn btn-sm whitespace-nowrap', acao.tipo === 'responder' ? 'btn-soft' : '')}>
      <Icon name={icone[acao.tipo]} size={14} />
      {acao.rotulo}
    </Link>
  );
}

function Paginacao({ mostrando, total }: { mostrando: number; total: number }) {
  const paginas = Math.ceil(total / 10);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Paginação de leads">
      <p className="text-[13px] text-muted">
        Mostrando 1 a {mostrando} de {numero(total)} leads
      </p>

      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Página anterior" disabled>
          <Icon name="arrowLeft" size={15} />
        </button>
        {[1, 2, 3, 4, 5].map((p) => (
          <button
            key={p}
            type="button"
            className={cx('btn btn-sm w-8 px-0', p === 1 && 'btn-soft')}
            aria-current={p === 1 ? 'page' : undefined}
          >
            {p}
          </button>
        ))}
        <span className="px-1 text-muted">…</span>
        <button type="button" className="btn btn-sm w-10 px-0">
          {paginas}
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Próxima página">
          <Icon name="arrowRight" size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="por-pagina" className="text-[13px] text-muted">
          Itens por página
        </label>
        <select id="por-pagina" className="select h-8 w-auto" defaultValue="10">
          <option>10</option>
          <option>25</option>
          <option>50</option>
        </select>
      </div>
    </nav>
  );
}

function LeadsVazio({ onNovo }: { onNovo: () => void }) {
  return (
    <div className="card">
      <EmptyState
        icon="leads"
        title="Nenhum lead ainda"
        description="Conecte um canal de entrada (WhatsApp, formulário, anúncios) ou cadastre um lead manualmente para começar."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={onNovo}>
              <Icon name="plus" size={15} />
              Novo Lead
            </button>
            <Link href="/configuracoes?aba=integracoes" className="btn btn-sm">
              <Icon name="link" size={15} />
              Conectar um canal
            </Link>
          </div>
        }
      />
    </div>
  );
}
