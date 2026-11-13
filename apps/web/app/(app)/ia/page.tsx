'use client';

import { useRouter } from 'next/navigation';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { EmptyState } from '@/components/revenue/States';
import { useAuth } from '@/lib/auth';
import { moeda, percentual, primeiroNome } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import {
  AUTOMACOES_SUGERIDAS,
  LEADS_SEM_RESPOSTA,
  NEGOCIOS_EM_RISCO,
  RECOMENDACOES_COPILOTO,
  RESUMO_ANALISE_IA,
  SUGESTOES_COPILOTO,
  TOP_OPORTUNIDADES,
} from '@/lib/demo/dataset';

/**
 * IA COPILOTO — o cérebro único do KHUB.
 *
 * Um agente, não uma frota. A conversa à esquerda faz o RACIOCÍNIO; os
 * painéis à direita mostram o que ele já apurou e oferecem a EXECUÇÃO.
 *
 * Essa separação é a regra de segurança central: o modelo sugere, o humano
 * executa. Nenhum botão desta tela dispara ação irreversível sem passar pelo
 * executor de tools do backend, que valida schema, permissão, tenant e grava
 * auditoria. O modelo nunca toca o banco.
 */
export default function IaPage() {
  const { user } = useAuth();
  const demo = modoDemo();
  const [aba, setAba] = useState<'conversar' | 'analises' | 'acoes' | 'automacoes' | 'config'>('conversar');
  const router = useRouter();
  // Modo real: a NICO de verdade mora em /nyro (ADR-0040); esta página só tinha
  // estado vazio e abas sem conteúdo. Links antigos para /ia caem lá.
  useEffect(() => {
    if (!demo) router.replace('/nyro');
  }, [demo, router]);
  if (!demo) return null;

  return (
    <PageShell className="max-w-none">
      <PageHeader
        icon={<Image src="/nico-logo.png" alt="NICO" width={217} height={72} unoptimized priority className="h-16 w-auto object-contain" />}
        title=""
        subtitle="Seu parceiro de IA para acelerar receita."
        quote={'"Dados viram insights.\nInsights viram receita."'}
        actions={<SeloDemo />}
      />

      {/* Abas + estado do provedor */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div className="flex flex-wrap gap-5" role="tablist" aria-label="Seções do Copiloto">
          {(
            [
              { chave: 'conversar', rotulo: 'Conversar', icone: 'chat' },
              { chave: 'analises', rotulo: 'Análises', icone: 'chart' },
              { chave: 'acoes', rotulo: 'Ações', icone: 'users' },
              { chave: 'automacoes', rotulo: 'Automações', icone: 'zap' },
              { chave: 'config', rotulo: 'Configurações', icone: 'settings' },
            ] as const
          ).map((a) => (
            <button key={a.chave} type="button" role="tab" className="tab" aria-selected={aba === a.chave} onClick={() => setAba(a.chave)}>
              <Icon name={a.icone as IconName} size={16} />
              {a.rotulo}
            </button>
          ))}
        </div>

        <EstadoProvedor />
      </div>

      {!demo ? (
        <IaVazia />
      ) : aba === 'conversar' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_368px]">
          <Conversa nome={primeiroNome(user?.name) || 'você'} />
          <aside className="min-w-0 space-y-4">
            <TopOportunidades />
            <NegociosEmRisco />
            <SemResposta />
            <AutomacoesParaDisparar />
          </aside>
        </div>
      ) : (
        <div className="card">
          <EmptyState icon="ai" title={`Aba ${aba}`} description="Esta seção ainda não tem conteúdo nesta versão." />
        </div>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Estado do provedor de IA.
 *
 * Mostra QUAL provedor está ativo. Com a abstração `AIProvider`, isso muda
 * por variável de ambiente — e o operador precisa saber qual modelo está
 * respondendo, porque custo e comportamento dependem disso.
 */
function EstadoProvedor() {
  const demo = modoDemo();
  return (
    <p className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-[12.5px]">
      <span className={cx('h-2 w-2 rounded-full', demo ? 'bg-success' : 'bg-text-3')} style={!demo ? { background: 'var(--text-3)' } : undefined} aria-hidden />
      <span className="font-medium text-fg">{demo ? 'IA online' : 'IA não configurada'}</span>
      <span className="text-faint" aria-hidden>
        ·
      </span>
      <span className="text-muted">{demo ? 'Contexto em tempo real' : 'Configure uma credencial'}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */

function Conversa({ nome }: { nome: string }) {
  const [rascunho, setRascunho] = useState('');
  const [enviou, setEnviou] = useState(true);

  return (
    <section className="card flex min-w-0 flex-col" aria-label="Conversa com o Copiloto">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-5">
        {/* Saudação */}
        <div className="flex gap-3">
          <span className="icon-tile h-9 w-9 shrink-0">
            <Icon name="ai" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="rounded-lg bg-surface2 p-4">
              <p className="text-[14px] font-semibold text-fg">Oi, {nome}! 👋</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg">
                Sou a NICO e estou aqui para transformar seus dados em ações que geram receita.
              </p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg">
                Posso analisar seu pipeline, leads, campanhas, follow-ups e automações e sugerir os próximos
                melhores passos. O que você gostaria de fazer hoje?
              </p>
            </div>
            <p className="mt-1 text-[11px] text-muted">09:41</p>

            {/* Sugestões de partida */}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SUGESTOES_COPILOTO.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setRascunho(s.titulo)}
                  className="flex items-center gap-2.5 rounded-md border border-brand-border bg-brand-softer p-3 text-left transition hover:bg-brand-soft"
                >
                  <span className="icon-tile h-8 w-8 shrink-0 rounded-sm">
                    <Icon name={s.icone as IconName} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-fg">{s.titulo}</span>
                    <span className="block truncate text-[11.5px] text-muted">{s.descricao}</span>
                  </span>
                  <Icon name="arrowRight" size={15} className="shrink-0 text-brand" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {enviou && (
          <>
            {/* Pergunta do usuário */}
            <div className="flex flex-row-reverse gap-3">
              <Avatar name={nome} size={32} />
              <div className="max-w-[76%]">
                <div className="rounded-lg bg-brand-soft px-4 py-2.5 text-[13.5px] text-fg">
                  Analise meu pipeline e me diga onde devo focar esta semana.
                </div>
                <p className="mt-1 text-right text-[11px] text-muted">09:42</p>
              </div>
            </div>

            {/* Resposta com resumo estruturado */}
            <div className="flex gap-3">
              <span className="icon-tile h-9 w-9 shrink-0">
                <Icon name="ai" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="rounded-lg bg-surface2 p-4">
                  <p className="text-[13.5px] leading-relaxed text-fg">
                    Claro, {nome}! Analisei seu pipeline e identifiquei os principais pontos de foco para esta
                    semana.
                  </p>
                </div>

                <div className="mt-2.5 rounded-lg border border-line bg-surface p-4">
                  <p className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold text-fg">
                    <span className="flex items-center gap-1.5">
                      <Icon name="chart" size={15} className="text-brand" />
                      Resumo da Análise
                    </span>
                    <Link href="/analytics" className="flex items-center gap-1 text-[12.5px] font-normal text-brand hover:underline">
                      Ver análise completa <Icon name="arrowRight" size={12} />
                    </Link>
                  </p>

                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {RESUMO_ANALISE_IA.map((r) => (
                      <div key={r.rotulo} className="rounded-md bg-surface2 p-3">
                        <dd className="text-[19px] font-bold tabular leading-none text-fg">{r.valor}</dd>
                        <dt className="mt-1.5 text-[11.5px] leading-snug text-muted">
                          {r.rotulo}
                          <br />
                          {r.detalhe}
                        </dt>
                      </div>
                    ))}
                  </dl>
                </div>

                <p className="mt-1 text-[11px] text-muted">09:42</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Compositor */}
      <div className="border-t border-line p-4">
        <form
          className="flex items-center gap-2 rounded-md border border-line bg-surface p-1.5 focus-within:border-brand focus-within:ring-[3px] focus-within:ring-[var(--ring)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (rascunho.trim()) {
              setEnviou(true);
              setRascunho('');
            }
          }}
        >
          <span className="icon-tile h-8 w-8 shrink-0 rounded-sm">
            <Icon name="ai" size={15} />
          </span>
          <label htmlFor="pergunta" className="sr-only">
            Pergunta para o Copiloto
          </label>
          <input
            id="pergunta"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-faint"
            placeholder="Digite sua mensagem para o Copiloto..."
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-icon btn-sm shrink-0" aria-label="Anexar arquivo">
            <Icon name="paperclip" size={16} />
          </button>
          <button type="submit" className="btn btn-primary btn-icon btn-sm shrink-0" aria-label="Enviar pergunta" disabled={!rascunho.trim()}>
            <Icon name="send" size={15} />
          </button>
        </form>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {[
            { rotulo: 'Sugerir ações para hoje', icone: 'info' },
            { rotulo: 'Analisar campanhas', icone: 'chart' },
            { rotulo: 'Criar relatório', icone: 'file' },
            { rotulo: 'Comparar períodos', icone: 'calendar' },
          ].map((a) => (
            <button key={a.rotulo} type="button" className="btn btn-sm" onClick={() => setRascunho(a.rotulo)}>
              <Icon name={a.icone as IconName} size={14} />
              {a.rotulo}
            </button>
          ))}
          <button type="button" className="btn btn-icon btn-sm" aria-label="Mais atalhos">
            <Icon name="dots" size={15} />
          </button>
        </div>

        {/* Recomendações acionáveis */}
        <div className="mt-4 rounded-lg border border-line bg-surface2 p-4">
          <p className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold text-fg">
            <span className="flex items-center gap-1.5">
              <Icon name="ai" size={15} className="text-brand" />
              Recomendações da IA para você
            </span>
            <button type="button" className="flex items-center gap-1 text-[12.5px] font-normal text-brand hover:underline">
              Ver todas as recomendações <Icon name="arrowRight" size={12} />
            </button>
          </p>

          <ol className="grid gap-2.5 lg:grid-cols-3">
            {RECOMENDACOES_COPILOTO.map((r, i) => (
              <li key={r.id} className="rounded-md border border-line bg-surface p-3">
                <p className="flex items-start gap-2 text-[12.5px] font-semibold text-fg">
                  <span className="icon-tile h-7 w-7 shrink-0 rounded-sm">
                    <Icon name={(['target', 'users', 'zap'] as IconName[])[i]} size={13} />
                  </span>
                  <span className="min-w-0">
                    {i + 1}. {r.titulo}
                  </span>
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{r.descricao}</p>
                <button type="button" className="btn btn-soft btn-sm mt-2.5 w-full">
                  {r.acao}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Painel({
  titulo,
  icone,
  tom,
  href,
  children,
}: {
  titulo: string;
  icone: IconName;
  tom?: 'danger';
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
          <Icon name={icone} size={16} className={tom === 'danger' ? 'text-danger' : 'text-brand'} />
          {titulo}
        </h2>
        <Link href={href} className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
          Ver todas <Icon name="arrowRight" size={13} />
        </Link>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

function TopOportunidades() {
  return (
    <Painel titulo="Top Oportunidades" icone="trophy" href="/pipeline">
      {TOP_OPORTUNIDADES.map((o) => (
        <li key={o.id} className="flex items-center gap-2.5 px-4 py-2.5">
          <span className="icon-tile h-8 w-8 shrink-0 rounded-sm">
            <Icon name="building" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-fg">{o.empresa}</p>
            <p className="truncate text-[11.5px] text-muted">
              {o.segmento} · {moeda(o.valor)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="pill pill-success h-[20px] px-2 text-[11px]">{o.probabilidade}%</span>
            <p className="mt-0.5 text-2xs text-muted">{o.nota}</p>
          </div>
        </li>
      ))}
    </Painel>
  );
}

function NegociosEmRisco() {
  return (
    <Painel titulo="Negócios em Risco" icone="alert" tom="danger" href="/pipeline">
      {NEGOCIOS_EM_RISCO.map((n) => (
        <li key={n.id} className="flex items-center gap-2.5 px-4 py-2.5">
          <span className="icon-tile icon-tile-danger h-8 w-8 shrink-0 rounded-sm">
            <Icon name="building" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-fg">{n.empresa}</p>
            <p className="truncate text-[11.5px] text-muted">
              {moeda(n.valor)} · {n.etapa}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="pill pill-danger h-[20px] px-2 text-[11px]">{n.risco}%</span>
            <p className="mt-0.5 text-2xs text-muted">{n.motivo}</p>
          </div>
        </li>
      ))}
    </Painel>
  );
}

function SemResposta() {
  return (
    <Painel titulo="Leads sem Resposta" icone="chat" href="/leads">
      {LEADS_SEM_RESPOSTA.map((l) => (
        <li key={l.id} className="flex items-center gap-2.5 px-4 py-2.5">
          <Avatar name={l.nome} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-fg">{l.nome}</p>
            <p className="truncate text-[11.5px] text-muted">
              {l.cargo} · {l.empresa}
            </p>
          </div>
          <span className="shrink-0 text-[11.5px] font-medium text-warning" style={{ color: 'var(--warning)' }}>
            {l.dias} dias
          </span>
        </li>
      ))}
    </Painel>
  );
}

function AutomacoesParaDisparar() {
  return (
    <Painel titulo="Automações para Disparar" icone="zap" href="/automacoes">
      {AUTOMACOES_SUGERIDAS.map((a) => (
        <li key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
          <span className="icon-tile h-8 w-8 shrink-0 rounded-sm">
            <Icon name="zap" size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-fg">{a.titulo}</p>
            <p className="truncate text-[11.5px] text-muted">{a.detalhe}</p>
          </div>
          {/* "Executar" NÃO dispara daqui: leva ao fluxo, que exige confirmação
              humana antes de qualquer ação sensível. */}
          <Link href="/automacoes" className="btn btn-soft btn-sm shrink-0">
            Executar
          </Link>
        </li>
      ))}
    </Painel>
  );
}

function IaVazia() {
  return (
    <div className="card">
      <EmptyState
        premium
        icon="ai"
        title="O Copiloto precisa de uma credencial de IA"
        description="Sem provedor configurado, o Copiloto não responde, e preferimos não responder a inventar uma análise. Configure uma chave em Configurações › IA para ativá-lo."
        action={
          <Link href="/configuracoes?aba=ia" className="btn btn-primary btn-sm">
            <Icon name="settings" size={15} />
            Configurar IA
          </Link>
        }
      />
    </div>
  );
}
