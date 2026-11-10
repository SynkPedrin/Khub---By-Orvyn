'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell } from '@/components/revenue/Page';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { Quando } from '@/components/revenue/Quando';
import { EmptyState } from '@/components/revenue/States';
import { ScoreBadge, Tags, canalRotulo } from '@/components/revenue/lead-ui';
import { dataCurta, moeda, telefone as fmtTelefone } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import {
  LEAD_ATRIBUICAO,
  LEAD_INSIGHTS,
  LEAD_NEGOCIOS,
  LEAD_NOTAS,
  LEAD_PERFIL,
  LEAD_TAREFAS,
  LEAD_TIMELINE,
} from '@/lib/demo/dataset';

/**
 * PERFIL DO LEAD — visão 360°.
 *
 * Três faixas: cabeçalho de identidade (quem é, quanto vale, onde está),
 * abas de profundidade, e um corpo de três colunas que responde "o que
 * aconteceu / o que está aberto / o que a IA acha".
 */

const ABAS = [
  { chave: 'visao', rotulo: 'Visão Geral', icone: 'grid' },
  { chave: 'conversas', rotulo: 'Conversas', icone: 'chat' },
  { chave: 'negocios', rotulo: 'Negócios', icone: 'briefcase' },
  { chave: 'tarefas', rotulo: 'Tarefas', icone: 'check2' },
  { chave: 'notas', rotulo: 'Notas', icone: 'note' },
  { chave: 'arquivos', rotulo: 'Arquivos', icone: 'paperclip' },
  { chave: 'campanhas', rotulo: 'Campanhas', icone: 'send' },
  { chave: 'insights', rotulo: 'Insights IA', icone: 'ai' },
] as const;

type Aba = (typeof ABAS)[number]['chave'];

export default function LeadPerfilPage() {
  const [aba, setAba] = useState<Aba>('visao');
  const demo = modoDemo();

  if (!demo) {
    return (
      <PageShell>
        <Migalhas nome="Lead" />
        <div className="card mt-4">
          <EmptyState
            icon="leads"
            title="Lead não encontrado"
            description="Este perfil ainda não tem dados. Conecte um canal de entrada ou cadastre o lead para vê-lo aqui."
            action={
              <Link href="/leads" className="btn btn-sm">
                <Icon name="arrowLeft" size={15} />
                Voltar para Leads
              </Link>
            }
          />
        </div>
      </PageShell>
    );
  }

  const lead = LEAD_PERFIL;

  return (
    <PageShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Migalhas nome={lead.nome} />
        <div className="flex flex-wrap items-center gap-2">
          <SeloDemo />
          <Link href="/conversas" className="btn btn-primary">
            <Icon name="send" size={15} />
            Responder
          </Link>
          <button type="button" className="btn">
            <Icon name="chart" size={15} />
            Mover etapa
            <Icon name="chevronDown" size={14} />
          </button>
          <Link href="/agenda" className="btn">
            <Icon name="calendar" size={15} />
            Agendar
          </Link>
          <button type="button" className="btn btn-icon" aria-label="Mais ações">
            <Icon name="dots" size={16} />
          </button>
        </div>
      </div>

      <Cabecalho lead={lead} />

      {/* Abas */}
      <div className="mb-4 mt-4 overflow-x-auto scrollbar-thin border-b border-line">
        <div className="flex gap-6" role="tablist" aria-label="Seções do perfil">
          {ABAS.map((a) => (
            <button
              key={a.chave}
              type="button"
              role="tab"
              aria-selected={aba === a.chave}
              onClick={() => setAba(a.chave)}
              className="tab whitespace-nowrap"
            >
              <Icon name={a.icone as IconName} size={16} />
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>

      {aba === 'visao' ? <VisaoGeral /> : <AbaPendente rotulo={ABAS.find((a) => a.chave === aba)!.rotulo} />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

function Migalhas({ nome }: { nome: string }) {
  return (
    <nav aria-label="Trilha de navegação" className="flex items-center gap-2 text-[14px]">
      <Link href="/leads" className="btn btn-ghost btn-icon btn-sm" aria-label="Voltar">
        <Icon name="arrowLeft" size={16} />
      </Link>
      <Link href="/leads" className="text-muted hover:text-fg hover:underline">
        Leads
      </Link>
      <Icon name="chevronRight" size={14} className="text-faint" />
      <span className="font-medium text-fg">{nome}</span>
    </nav>
  );
}

function Cabecalho({ lead }: { lead: typeof LEAD_PERFIL }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_200px_260px]">
      {/* Identidade + contatos */}
      <div className="card flex flex-wrap items-start gap-5 p-5">
        <Avatar name={lead.nome} size={104} />

        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[26px] font-bold leading-tight tracking-tight text-fg">
            <span className="truncate">{lead.nome}</span>
            {lead.linkedin && (
              <a
                href={`https://${lead.linkedin}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`LinkedIn de ${lead.nome}`}
              >
                <Icon name="linkedin" size={19} style={{ color: 'var(--ch-linkedin)' }} />
              </a>
            )}
          </h1>
          <p className="mt-0.5 text-[15px] text-muted">{lead.cargo}</p>
          <p className="text-[15px] font-medium text-fg">{lead.empresa}</p>
          <div className="mt-3">
            <Tags tags={lead.tags} onAdd={() => undefined} />
          </div>
        </div>

        <ul className="min-w-[230px] space-y-2 border-l border-line pl-5">
          <Contato icone="mail">{lead.email}</Contato>
          <Contato icone="phone">
            {fmtTelefone(lead.telefone)}
            <Icon name="whatsapp" size={14} className="ml-1.5 inline" style={{ color: 'var(--ch-whatsapp)' }} />
          </Contato>
          <Contato icone="mapPin">{lead.localizacao}</Contato>
          <Contato icone="building">{lead.empresa}</Contato>
          <Contato icone="users">{lead.tamanhoEmpresa}</Contato>
          <Contato icone="link">
            <a href={`https://${lead.site}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              {lead.site}
            </a>
          </Contato>
        </ul>
      </div>

      {/* Score */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <span className="icon-tile icon-tile-danger">
            <Icon name="flame" size={19} />
          </span>
          <div>
            <p className="text-[13px] font-medium text-muted">Score NICO</p>
            <p className="t-kpi mt-1">{lead.score}</p>
            <p className="delta delta-up mt-1.5">
              <Icon name="arrowUp" size={12} strokeWidth={2.4} />
              15%
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-snug text-muted">Alta probabilidade de conversão.</p>
        {/* Transparência do score: o número sem a origem não é auditável. */}
        <p className="mt-1.5 text-[10px] text-faint" title="Versão do algoritmo de pontuação">
          modelo {lead.scoreVersao}
        </p>
      </div>

      {/* Etapa no funil */}
      <div className="card p-5">
        <div className="flex items-start gap-3">
          <span className="icon-tile">
            <Icon name="funnel" size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted">Etapa no funil</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[20px] font-bold tracking-tight text-fg">
              Negociação
              <Icon name="chevronDown" size={16} className="text-faint" />
            </p>
          </div>
        </div>

        {/* Trilho de progresso do funil */}
        <ol className="mt-4 flex items-center gap-1" aria-label="Progresso no funil">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex flex-1 items-center gap-1">
              <span
                className={cx('h-2 w-2 shrink-0 rounded-full', i <= 2 ? 'bg-brand' : 'bg-surface3')}
                aria-label={i <= 2 ? 'etapa concluída' : 'etapa pendente'}
              />
              {i < 4 && <span className={cx('h-0.5 flex-1', i < 2 ? 'bg-brand' : 'bg-surface3')} />}
            </li>
          ))}
        </ol>

        <p className="mt-3 text-xs text-muted">Desde {dataCurta(LEAD_NEGOCIOS[0].previsaoFechamento)}</p>
        <p className="mt-2 text-[11px] text-muted">Próxima etapa sugerida</p>
        <p className="text-[13px] font-semibold text-fg">Enviar proposta comercial</p>
      </div>
    </div>
  );
}

function Contato({ icone, children }: { icone: IconName; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon name={icone} size={15} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{children}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function VisaoGeral() {
  const lead = LEAD_PERFIL;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {/* Coluna 1 — quem é */}
      <div className="space-y-4">
        <Cartao titulo="Resumo do Contato" acao={<BotaoEditar />}>
          <dl className="space-y-0">
            <Dado rotulo="Nome completo">{lead.nome}</Dado>
            <Dado rotulo="Cargo">{lead.cargo}</Dado>
            <Dado rotulo="Empresa">{lead.empresa}</Dado>
            <Dado rotulo="Segmento">{lead.segmento}</Dado>
            <Dado rotulo="Tamanho da empresa">{lead.tamanhoEmpresa}</Dado>
            <Dado rotulo="Localização">{lead.localizacao}</Dado>
            <Dado rotulo="Fonte">{canalRotulo(lead.origem)}</Dado>
            <Dado rotulo="Primeiro contato">{dataCurta(lead.primeiroContatoEm)}</Dado>
            <Dado rotulo="Última interação">
              <Quando data={lead.ultimaInteracaoAt} />
            </Dado>
            <Dado rotulo="Responsável">
              <span className="flex items-center gap-2">
                <Avatar name={lead.responsavel?.nome ?? '?'} size={22} />
                {lead.responsavel?.nome}
              </span>
            </Dado>
            <Dado rotulo="Tags">
              <Tags tags={lead.tags} onAdd={() => undefined} />
            </Dado>
            <Dado rotulo="Notas rápidas">
              <span className="block rounded-sm bg-warning-soft p-2.5 text-[13px] leading-relaxed text-fg">
                {lead.notas}
              </span>
            </Dado>
          </dl>
        </Cartao>

        <Cartao titulo="Redes e Links">
          <ul className="space-y-2.5">
            <LinkExterno icone="linkedin" titulo="LinkedIn" url={lead.linkedin} cor="var(--ch-linkedin)" />
            <LinkExterno icone="globe" titulo="Website da empresa" url={lead.site} />
          </ul>
        </Cartao>
      </div>

      {/* Coluna 2 — o que aconteceu */}
      <div className="space-y-4">
        <Cartao
          titulo="Timeline de Interações"
          acao={
            <select className="select h-8 w-auto text-[13px]" aria-label="Filtrar canal da timeline">
              <option>Todos os canais</option>
            </select>
          }
        >
          <ol className="relative space-y-5 pl-1">
            {LEAD_TIMELINE.map((t, i) => (
              <li key={t.id} className="relative flex gap-3">
                {/* Fio vertical ligando os eventos */}
                {i < LEAD_TIMELINE.length - 1 && (
                  <span className="absolute left-[15px] top-8 h-[calc(100%+4px)] w-px bg-line" aria-hidden />
                )}
                <span className={cx('icon-tile relative z-sticky h-[30px] w-[30px] shrink-0', tomTimeline(t.tipo))}>
                  <Icon name={iconeTimeline(t.tipo)} size={15} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[13.5px] font-semibold text-fg">{t.titulo}</p>
                  </div>
                  {t.descricao && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t.descricao}</p>}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Quando data={t.quando} className="text-[11.5px] text-faint" />
                    {t.link && (
                      <Link href={t.link.href} className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
                        {t.link.rotulo} <Icon name="arrowRight" size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Cartao>

        <Cartao
          titulo="Notas"
          acao={
            <button type="button" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Adicionar nota <Icon name="plus" size={14} />
            </button>
          }
        >
          <ul className="space-y-4">
            {LEAD_NOTAS.map((n) => (
              <li key={n.id}>
                <div className="flex items-center gap-2">
                  <Avatar name={n.autor} size={22} />
                  <span className="text-[13px] font-medium text-fg">{n.autor}</span>
                  <Quando data={n.quando} className="text-[12px] text-muted" />
                  <button type="button" className="btn btn-ghost btn-icon btn-sm ml-auto" aria-label="Ações da nota">
                    <Icon name="dots" size={15} />
                  </button>
                </div>
                <p
                  className={cx(
                    'mt-1.5 rounded-sm p-2.5 text-[13px] leading-relaxed',
                    n.destaque ? 'bg-warning-soft text-fg' : 'bg-surface2 text-fg',
                  )}
                >
                  {n.corpo}
                </p>
              </li>
            ))}
          </ul>
        </Cartao>
      </div>

      {/* Coluna 3 — o que está aberto */}
      <div className="space-y-4">
        <Cartao
          titulo={`Negócios (${LEAD_NEGOCIOS.length})`}
          acao={
            <Link href="/pipeline" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver pipeline <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          {LEAD_NEGOCIOS.map((n) => (
            <div key={n.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-fg">{n.titulo}</p>
                <button type="button" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Ações do negócio">
                  <Icon name="dots" size={15} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[19px] font-bold tabular text-fg">{moeda(n.valor)}</span>
                <span className="pill pill-brand">{n.etapa}</span>
              </div>

              {/* Trilho de etapas do negócio */}
              <ol className="mt-4 flex items-center" aria-label="Etapas do negócio">
                {n.etapas.map((e, i) => (
                  <li key={e} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      {i > 0 && <span className={cx('h-0.5 flex-1', i <= n.etapaIndice ? 'bg-brand' : 'bg-surface3')} />}
                      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', i <= n.etapaIndice ? 'bg-brand' : 'bg-surface3')} />
                      {i < n.etapas.length - 1 && (
                        <span className={cx('h-0.5 flex-1', i < n.etapaIndice ? 'bg-brand' : 'bg-surface3')} />
                      )}
                    </div>
                    <span className={cx('mt-1.5 text-[11px]', i === n.etapaIndice ? 'font-semibold text-fg' : 'text-muted')}>
                      {e}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
                <div className="flex items-center gap-2">
                  <Icon name="calendar" size={15} className="shrink-0 text-faint" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted">Previsão de fechamento</p>
                    <p className="truncate text-[12.5px] font-medium text-fg">{dataCurta(n.previsaoFechamento)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Icon name="dollar" size={15} className="shrink-0 text-faint" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted">Valor</p>
                    <p className="truncate text-[12.5px] font-medium tabular text-fg">{moeda(n.valor)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </Cartao>

        <Cartao
          titulo={`Tarefas (${LEAD_TAREFAS.length})`}
          acao={
            <Link href="/agenda" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver todas <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          <ul className="space-y-3">
            {LEAD_TAREFAS.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5">
                <input type="checkbox" className="checkbox shrink-0" defaultChecked={t.concluida} aria-label={t.titulo} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{t.titulo}</span>
                <Quando
                  data={t.quando}
                  className={cx('shrink-0 text-[12px] font-medium', t.urgente ? 'text-danger' : 'text-muted')}
                />
                <Avatar name={t.responsavel?.nome ?? '?'} size={22} />
                <button type="button" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Ações da tarefa">
                  <Icon name="dots" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo="Campanhas e Atribuição" acao={<BotaoMais />}>
          <div className="flex items-start gap-3">
            <span className="icon-tile h-9 w-9 shrink-0">
              <Icon name="send" size={16} />
            </span>
            <dl className="min-w-0 flex-1 space-y-1.5">
              <Atribuicao rotulo="Origem do Lead">{LEAD_ATRIBUICAO.origemDoLead}</Atribuicao>
              <Atribuicao rotulo="Campanha">{LEAD_ATRIBUICAO.campanha}</Atribuicao>
              <Atribuicao rotulo="Mídia">{LEAD_ATRIBUICAO.midia}</Atribuicao>
              <Atribuicao rotulo="Primeiro toque">{dataCurta(LEAD_ATRIBUICAO.primeiroToque)}</Atribuicao>
            </dl>
          </div>
        </Cartao>

        <CartaoInsights />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CartaoInsights() {
  const i = LEAD_INSIGHTS;
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 px-5 pt-5">
        <h2 className="t-section">Insights da NICO</h2>
        <span className="pill pill-brand">Beta</span>
      </div>

      <div className="p-5">
        <div className="flex gap-4 rounded-lg border border-brand-border bg-brand-softer p-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
              <Icon name="ai" size={16} className="shrink-0 text-brand" />
              {i.titulo}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{i.descricao}</p>
            <ul className="mt-2.5 space-y-1">
              {i.sinais.map((s) => (
                <li key={s} className="flex gap-1.5 text-[12px] text-muted">
                  <span className="text-brand" aria-hidden>
                    •
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Anel de score */}
          <div className="relative shrink-0 self-start">
            <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Score de conversão: ${i.score} de 100`}>
              <circle cx="38" cy="38" r="32" fill="none" stroke="var(--border)" strokeWidth="6" />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="var(--success)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(i.score / 100) * 201} 201`}
                transform="rotate(-90 38 38)"
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-[19px] font-bold tabular text-fg">{i.score}</span>
            </div>
            <p className="mt-1 text-center text-[10px] leading-tight text-muted">
              Score de
              <br />
              conversão
            </p>
          </div>
        </div>

        <Link href="/ia" className="mt-3 flex items-center justify-end gap-1 text-[13px] font-medium text-brand hover:underline">
          Ver análise completa <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Cartao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="t-section">{titulo}</h2>
        {acao}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <dt className="w-[42%] shrink-0 text-[12.5px] text-muted">{rotulo}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-fg">{children}</dd>
    </div>
  );
}

function Atribuicao({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[38%] shrink-0 text-[11.5px] text-muted">{rotulo}</dt>
      <dd className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{children}</dd>
    </div>
  );
}

function LinkExterno({
  icone,
  titulo,
  url,
  cor,
}: {
  icone: IconName;
  titulo: string;
  url?: string | null;
  cor?: string;
}) {
  if (!url) return null;
  return (
    <li>
      <a
        href={`https://${url}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-md p-2 transition hover:bg-surface2"
      >
        <span className="icon-tile icon-tile-neutral h-9 w-9 shrink-0">
          <Icon name={icone} size={17} style={cor ? { color: cor } : undefined} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-fg">{titulo}</span>
          <span className="block truncate text-[12px] text-brand">{url}</span>
        </span>
        <Icon name="external" size={15} className="shrink-0 text-faint" />
      </a>
    </li>
  );
}

function BotaoEditar() {
  return (
    <button type="button" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
      Editar <Icon name="edit" size={13} />
    </button>
  );
}

function BotaoMais() {
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Mais opções">
      <Icon name="dots" size={16} />
    </button>
  );
}

function AbaPendente({ rotulo }: { rotulo: string }) {
  return (
    <div className="card">
      <EmptyState
        icon="info"
        title={`${rotulo} deste lead`}
        description="Esta aba ainda não tem conteúdo carregado. O conteúdo aparece aqui assim que houver registros."
      />
    </div>
  );
}

function iconeTimeline(tipo: string): IconName {
  const mapa: Record<string, IconName> = {
    mensagem: 'whatsapp',
    reuniao: 'calendar',
    email: 'mail',
    campanha: 'send',
    visita: 'eye',
    lead_criado: 'chat',
    nota: 'note',
    tarefa: 'check2',
    etapa: 'chart',
  };
  return mapa[tipo] ?? 'info';
}

function tomTimeline(tipo: string): string {
  const mapa: Record<string, string> = {
    mensagem: 'icon-tile-success',
    email: 'icon-tile-info',
    reuniao: '',
    campanha: '',
    visita: 'icon-tile-neutral',
    lead_criado: 'icon-tile-neutral',
  };
  return mapa[tipo] ?? 'icon-tile-neutral';
}
