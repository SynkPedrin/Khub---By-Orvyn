'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { Quando } from '@/components/revenue/Quando';
import { EmptyState } from '@/components/revenue/States';
import { InboxAtendimento } from '@/components/inbox/InboxAtendimento';
import { CanalBadge, canalRotulo } from '@/components/revenue/lead-ui';
import { hora, telefone as fmtTelefone } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import { CONTAGEM_CANAIS, CONVERSAS, MENSAGENS, SUGESTOES_IA_CONVERSA } from '@/lib/demo/dataset';
import type { Canal, ResumoConversa } from '@/lib/revenue/types';

/**
 * CONVERSAS — inbox omnichannel.
 *
 * Quatro colunas: filtros (canais/status/etiquetas) · lista · thread ·
 * dados do lead. O operador precisa do contexto comercial do lead enquanto
 * responde — sem isso ele abre o CRM em outra aba e perde a conversa.
 *
 * Os canais listados refletem a arquitetura de `MessagingProvider`: hoje só
 * WhatsApp tem provedor implementado; os demais aparecem porque a abstração
 * já os contempla, e ficam explicitamente vazios até serem conectados.
 */
export default function ConversasPage() {
  const demo = modoDemo();

  return (
    <PageShell className="max-w-none">
      <PageHeader
        title="Conversas"
        subtitle="Centralize todas as suas conversas em um só lugar."
        quote={'"Mais conversas. Mais oportunidades.\nMais receita."'}
        actions={
          demo ? (
            <>
              <SeloDemo />
              <button type="button" className="btn btn-primary">
                <Icon name="plus" size={16} />
                Nova conversa
              </button>
            </>
          ) : undefined
        }
      />

      {/* Real: inbox ligado à API (antes: sempre "Nenhuma conversa ainda" fora do demo). */}
      {demo ? <Inbox /> : <InboxAtendimento />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

const STATUS_FILTROS: { chave: ResumoConversa['status'] | 'todas'; rotulo: string; icone: IconName }[] = [
  { chave: 'todas', rotulo: 'Todas', icone: 'grid' },
  { chave: 'nao_lida', rotulo: 'Não lidas', icone: 'chat' },
  { chave: 'em_atendimento', rotulo: 'Em atendimento', icone: 'refresh' },
  { chave: 'aguardando', rotulo: 'Aguardando resposta', icone: 'clock' },
  { chave: 'resolvida', rotulo: 'Resolvidas', icone: 'check2' },
];

function Inbox() {
  const [canal, setCanal] = useState<Canal | 'todos'>('todos');
  const [status, setStatus] = useState<ResumoConversa['status'] | 'todas'>('todas');
  // Mobile: lista ↔ thread alternam em tela cheia; desktop mostra tudo junto
  // (quando nada está selecionado a thread cai na primeira conversa da lista).
  const [selecionada, setSelecionada] = useState<string>('');
  const [rascunho, setRascunho] = useState('');

  const lista = useMemo(
    () =>
      CONVERSAS.filter((c) => (canal === 'todos' || c.canal === canal) && (status === 'todas' || c.status === status)),
    [canal, status],
  );

  const conversa = CONVERSAS.find((c) => c.id === selecionada) ?? lista[0];
  const naoLidas = CONVERSAS.filter((c) => c.status === 'nao_lida').length;
  // Abaixo de xl vira navegação de uma coluna: abriu conversa → esconde
  // filtros e lista; voltou (setSelecionada('')) → mostra a lista de novo.
  const threadAberta = Boolean(selecionada);

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[186px_296px_minmax(0,1fr)] 2xl:grid-cols-[186px_296px_minmax(0,1fr)_292px]">
      {/* 1 — filtros */}
      <aside className={cx('card min-w-0 p-3', threadAberta && 'max-xl:hidden')}>
        <Grupo titulo="Canais" extra={`Todos ${CONVERSAS.length}`}>
          <ItemFiltro ativo={canal === 'todos'} onClick={() => setCanal('todos')} icone="users" contagem={CONVERSAS.length}>
            Todos os canais
          </ItemFiltro>
          {(Object.keys(CONTAGEM_CANAIS) as (keyof typeof CONTAGEM_CANAIS)[]).map((c) => (
            <ItemFiltro
              key={c}
              ativo={canal === c}
              onClick={() => setCanal(c as Canal)}
              contagem={CONTAGEM_CANAIS[c]}
              conteudoIcone={<CanalBadge canal={c as Canal} comRotulo={false} />}
            >
              {canalRotulo(c as Canal)}
            </ItemFiltro>
          ))}
        </Grupo>

        <Grupo titulo="Status">
          {STATUS_FILTROS.map((s) => (
            <ItemFiltro
              key={s.chave}
              ativo={status === s.chave}
              onClick={() => setStatus(s.chave)}
              icone={s.icone}
              contagem={
                s.chave === 'todas' ? CONVERSAS.length : CONVERSAS.filter((c) => c.status === s.chave).length
              }
            >
              {s.rotulo}
            </ItemFiltro>
          ))}
        </Grupo>

        <Grupo titulo="Etiquetas" acao>
          {['Urgente', 'Qualificado', 'Proposta', 'Cliente', 'Sem resposta', 'Follow-up'].map((e, i) => (
            <ItemFiltro
              key={e}
              ativo={false}
              onClick={() => undefined}
              contagem={[3, 5, 4, 2, 3, 1][i]}
              conteudoIcone={
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: ['#dc2626', '#047857', '#6c2bff', '#0284c7', '#d97706', '#8a8c9e'][i] }}
                  aria-hidden
                />
              }
            >
              {e}
            </ItemFiltro>
          ))}
        </Grupo>
      </aside>

      {/* 2 — lista */}
      <section className={cx('card flex min-w-0 flex-col', threadAberta && 'max-xl:hidden')} aria-label="Lista de conversas">
        <div className="border-b border-line p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="search" className="input h-9 pl-9" placeholder="Buscar conversas..." aria-label="Buscar conversas" />
            </div>
            <button type="button" className="btn btn-icon btn-sm h-9 w-9" aria-label="Filtros avançados">
              <Icon name="filter" size={15} />
            </button>
          </div>

          <div className="mt-2.5 flex gap-4 border-b border-line" role="tablist">
            <button type="button" role="tab" className="tab py-2 text-[13px]" aria-selected={status === 'todas'} onClick={() => setStatus('todas')}>
              Todas ({CONVERSAS.length})
            </button>
            <button type="button" role="tab" className="tab py-2 text-[13px]" aria-selected={status === 'nao_lida'} onClick={() => setStatus('nao_lida')}>
              Não lidas ({naoLidas})
            </button>
            <button
              type="button"
              role="tab"
              className="tab py-2 text-[13px]"
              aria-selected={status === 'em_atendimento'}
              onClick={() => setStatus('em_atendimento')}
            >
              Em atendimento
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto scrollbar-thin">
          {lista.length === 0 ? (
            <li>
              <EmptyState icon="chat" title="Nenhuma conversa" description="Nenhuma conversa corresponde a estes filtros." />
            </li>
          ) : (
            lista.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelecionada(c.id)}
                  aria-current={c.id === conversa?.id ? 'true' : undefined}
                  className={cx(
                    'flex w-full gap-2.5 p-3 text-left transition',
                    c.id === conversa?.id ? 'bg-brand-softer' : 'hover:bg-surface2',
                  )}
                >
                  <span className="relative shrink-0">
                    <Avatar name={c.nome} size={38} />
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface ring-1 ring-line">
                      <CanalBadge canal={c.canal} comRotulo={false} />
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cx('truncate text-[13.5px]', c.naoLidas ? 'font-bold text-fg' : 'font-semibold text-fg')}>
                        {c.nome}
                      </span>
                      <Quando
                        data={c.quando}
                        formato={ehHoje(c.quando) ? 'hora' : 'data'}
                        className="shrink-0 text-[11.5px] text-muted"
                      />
                    </span>
                    <span className="block truncate text-[12px] text-brand">{c.empresa}</span>
                    <span className={cx('block truncate text-[12.5px]', c.naoLidas ? 'font-medium text-fg' : 'text-muted')}>
                      {c.previa}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      {c.etiquetas.map((e) => (
                        <span key={e} className="pill h-[20px] px-2 text-[10.5px]">
                          {e}
                        </span>
                      ))}
                      {c.naoLidas > 0 && (
                        <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-white">
                          {c.naoLidas}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* 3 — thread */}
      {conversa ? <Thread conversa={conversa} rascunho={rascunho} setRascunho={setRascunho} ocultaMobile={!threadAberta} onVoltar={() => setSelecionada('')} /> : null}

      {/* 4 — dados do lead */}
      {conversa ? <PainelDadosLead conversa={conversa} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Thread({
  conversa,
  rascunho,
  setRascunho,
  ocultaMobile = false,
  onVoltar,
}: {
  conversa: ResumoConversa;
  rascunho: string;
  setRascunho: (v: string) => void;
  /** Mobile: escondida até a pessoa escolher uma conversa na lista. */
  ocultaMobile?: boolean;
  /** Mobile: volta para a lista de conversas. */
  onVoltar?: () => void;
}) {
  return (
    <section className={cx('card flex min-w-0 flex-col', ocultaMobile && 'max-xl:hidden')} aria-label={`Conversa com ${conversa.nome}`}>
      {/* Cabeçalho */}
      <header className="flex items-center gap-3 border-b border-line p-3">
        {onVoltar && (
          <button type="button" onClick={onVoltar} className="btn btn-ghost btn-icon btn-sm -ml-1 xl:hidden" aria-label="Voltar para a lista de conversas">
            <Icon name="arrowLeft" size={18} />
          </button>
        )}
        <Avatar name={conversa.nome} size={38} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[14.5px] font-bold text-fg">
            {conversa.nome}
            <button type="button" aria-label="Favoritar conversa">
              <Icon name="star" size={15} className="text-faint" />
            </button>
          </p>
          <p className="flex items-center gap-2 truncate text-[12px] text-muted">
            {conversa.empresa}
            <CanalBadge canal={conversa.canal} />
          </p>
        </div>

        {/* Em telas estreitas as ações secundárias somem antes do nome:
            saber COM QUEM se está falando vence um botão de vídeo. */}
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon btn-sm hidden 2xl:inline-flex" aria-label="Mais opções">
            <Icon name="dots" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm hidden 2xl:inline-flex" aria-label="Ligar">
            <Icon name="phone" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm hidden 2xl:inline-flex" aria-label="Iniciar chamada de vídeo">
            <Icon name="video" size={16} />
          </button>
          <button type="button" className="btn btn-sm">
            <span className="hidden xl:inline">Marcar como</span>
            <Icon name="chevronDown" size={14} />
          </button>
        </div>
      </header>

      {/* Mensagens */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin p-4">
        <p className="text-center">
          <span className="pill">Hoje, {hora(MENSAGENS[0].quando)}</span>
        </p>

        {MENSAGENS.map((m) => (
          <div key={m.id} className={cx('flex gap-2.5', m.de === 'equipe' && 'flex-row-reverse')}>
            {m.de === 'lead' && <Avatar name={conversa.nome} size={30} />}
            <div className={cx('max-w-[78%] min-w-0')}>
              <div
                className={cx(
                  'whitespace-pre-line rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed',
                  m.de === 'equipe' ? 'bg-brand-soft text-fg' : 'bg-surface2 text-fg',
                )}
              >
                {m.texto}
              </div>
              <p className={cx('mt-1 flex items-center gap-1 text-[11px] text-muted', m.de === 'equipe' && 'justify-end')}>
                {hora(m.quando)}
                {m.de === 'equipe' && m.lida && <Icon name="check" size={12} className="text-brand" />}
              </p>
            </div>
          </div>
        ))}

        {/* Indicador de digitação */}
        <div className="flex gap-2.5">
          <Avatar name={conversa.nome} size={30} />
          <div className="flex items-center gap-1 rounded-lg bg-surface2 px-3.5 py-3" aria-label="Digitando">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full bg-text-3" style={{ background: 'var(--text-3)' }} aria-hidden />
            ))}
          </div>
        </div>
      </div>

      {/* Sugestões da IA — separadas do compositor: sugerir ≠ enviar */}
      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
            <Icon name="ai" size={14} className="text-brand" />
            Sugestões da IA
            <span className="pill pill-brand h-[18px] px-1.5 text-[10px]">Beta</span>
          </p>
          <button type="button" className="flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            Ver mais <Icon name="arrowRight" size={12} />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {SUGESTOES_IA_CONVERSA.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setRascunho(s.titulo)}
              className="rounded-md border border-brand-border bg-brand-softer p-2.5 text-left transition hover:bg-brand-soft"
            >
              <span className="block text-[12.5px] font-semibold text-brand">{s.titulo}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{s.descricao}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Compositor */}
      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-4">
          <div className="flex gap-1" role="tablist" aria-label="Tipo de conteúdo">
            <button type="button" role="tab" className="seg h-7 px-2.5 text-[12.5px]" aria-selected="true">
              Mensagem
            </button>
            <button type="button" role="tab" className="seg h-7 px-2.5 text-[12.5px]" aria-selected="false">
              Modelos
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm ml-auto text-brand">
            <Icon name="ai" size={14} />
            Aprimorar com IA
          </button>
        </div>

        <label htmlFor="msg" className="sr-only">
          Escrever mensagem para {conversa.nome}
        </label>
        <textarea
          id="msg"
          className="textarea min-h-[64px]"
          placeholder="Digite sua mensagem..."
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
        />

        <div className="mt-2 flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Anexar arquivo">
            <Icon name="paperclip" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Inserir emoji">
            <Icon name="check2" size={16} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Gerar com IA">
            <Icon name="ai" size={16} />
          </button>

          <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={!rascunho.trim()}>
            <Icon name="send" size={15} />
            Enviar
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PainelDadosLead({ conversa }: { conversa: ResumoConversa }) {
  return (
    <aside className="card hidden min-w-0 flex-col overflow-y-auto scrollbar-thin 2xl:flex" aria-label="Dados do lead">
      <div className="flex items-center justify-between gap-2 border-b border-line p-3">
        <h2 className="t-section">Dados do Lead</h2>
        <button type="button" className="text-[12.5px] font-medium text-brand hover:underline">
          Editar
        </button>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={conversa.nome} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold text-fg">{conversa.nome}</p>
            <p className="truncate text-[12px] text-muted">{conversa.empresa}</p>
          </div>
        </div>
        <span className="pill pill-success mt-2">Qualificado</span>

        <ul className="mt-4 space-y-2">
          <Linha icone="phone">{fmtTelefone('+5511987654321')}</Linha>
          <Linha icone="mail">mariana@techsolutions.com.br</Linha>
          <Linha icone="building">{conversa.empresa}</Linha>
          <Linha icone="users">51 - 200 colaboradores</Linha>
          <Linha icone="link">
            <a href="https://techsolutions.com.br" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
              techsolutions.com.br
            </a>
          </Linha>
        </ul>

        <h3 className="mb-2 mt-5 flex items-center justify-between text-[12.5px] font-semibold text-fg">
          Etiquetas
          <button type="button" aria-label="Adicionar etiqueta">
            <Icon name="plus" size={14} className="text-brand" />
          </button>
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="pill pill-success">Qualificado</span>
          <span className="pill pill-brand">SaaS</span>
          <span className="pill pill-info">Inbound</span>
          <button type="button" className="pill border border-dashed border-line-strong">
            <Icon name="plus" size={11} />
            Nova etiqueta
          </button>
        </div>

        <h3 className="mb-1.5 mt-5 text-[12.5px] font-semibold text-fg">Pipeline</h3>
        <select className="select h-9" aria-label="Pipeline do lead" defaultValue="oportunidade">
          <option value="oportunidade">Oportunidade</option>
        </select>

        <h3 className="mb-1.5 mt-3 text-[12.5px] font-semibold text-fg">Etapa</h3>
        <select className="select h-9" aria-label="Etapa do lead" defaultValue="qualificacao">
          <option value="qualificacao">Qualificação</option>
        </select>

        <h3 className="mb-2 mt-5 flex items-center justify-between text-[12.5px] font-semibold text-fg">
          Observações
          <button type="button" className="text-[12px] font-normal text-brand hover:underline">
            + Adicionar
          </button>
        </h3>
        <p className="rounded-md bg-surface2 p-2.5 text-[12.5px] leading-relaxed text-fg">
          Lead chegou via LinkedIn Ads. Demonstrou interesse no plano Pro e tem equipe comercial ativa.
        </p>

        <h3 className="mb-2 mt-5 flex items-center justify-between text-[12.5px] font-semibold text-fg">
          Atividades recentes
          <Link href="/leads/l1" className="text-[12px] font-normal text-brand hover:underline">
            Ver todas
          </Link>
        </h3>
        <ul className="space-y-2.5">
          {[
            { icone: 'whatsapp' as IconName, texto: 'Conversa iniciada', quando: 'Hoje, 10:02' },
            { icone: 'users' as IconName, texto: 'Lead atribuído a você', quando: 'Hoje, 10:03' },
            { icone: 'tag' as IconName, texto: 'Etiqueta adicionada', quando: 'Hoje, 10:04' },
          ].map((a) => (
            <li key={a.texto} className="flex items-start gap-2">
              <Icon name={a.icone} size={14} className="mt-0.5 shrink-0 text-faint" />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-fg">{a.texto}</p>
                <p className="text-[11px] text-muted">{a.quando}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A lista mostra HORA para conversas de hoje e DATA para as anteriores.
 * Sem isso, uma conversa de três dias atrás exibiria "22:48" e pareceria
 * recente.
 */
function ehHoje(quando: string): boolean {
  return new Date(quando).toDateString() === new Date().toDateString();
}

/** Linha de contato do painel do lead: ícone + valor. */
function Linha({ icone, children }: { icone: IconName; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon name={icone} size={15} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{children}</span>
    </li>
  );
}

function Grupo({ titulo, extra, acao, children }: { titulo: string; extra?: string; acao?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 flex items-center justify-between px-1.5 text-[12px] font-semibold text-fg">
        {titulo}
        {extra && <span className="font-normal text-muted">{extra}</span>}
        {acao && (
          <button type="button" aria-label={`Adicionar ${titulo.toLowerCase()}`}>
            <Icon name="plus" size={13} className="text-brand" />
          </button>
        )}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function ItemFiltro({
  ativo,
  onClick,
  icone,
  conteudoIcone,
  contagem,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  icone?: IconName;
  conteudoIcone?: React.ReactNode;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ativo}
        className={cx(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition',
          ativo ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-surface2 hover:text-fg',
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {conteudoIcone ?? (icone && <Icon name={icone} size={14} />)}
        </span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {typeof contagem === 'number' && <span className="shrink-0 tabular text-[11.5px] text-muted">{contagem}</span>}
      </button>
    </li>
  );
}
