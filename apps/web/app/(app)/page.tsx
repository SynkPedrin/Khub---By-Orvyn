'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Avatar } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { Funnel } from '@/components/charts';
import { useAuth } from '@/lib/auth';
import { crm, brl, type Overview } from '@/lib/crm';

/** Carregando: uma linguagem só para a tela inteira (antes eram três). */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface3 ${className}`} aria-hidden="true" />;
}

/** Estado vazio: nenhuma área da tela pode ficar em branco. */
function Vazio({ icon, titulo, texto, cta }: { icon: IconName; titulo: string; texto: string; cta?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface3 text-muted">
        <Icon name={icon} size={18} />
      </span>
      <p className="text-sm font-semibold text-fg">{titulo}</p>
      <p className="max-w-[15rem] text-xs text-muted">{texto}</p>
      {cta && <Link href={cta.href} className="btn btn-soft mt-1 text-xs">{cta.label}</Link>}
    </div>
  );
}

/** Linha do resumo — dado derivado do payload real, sem enfeite. */
function Linha({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-fg">
      <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-muted" />
      <span className="leading-snug">{children}</span>
    </li>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState(false);
  const [carregando, setCarregando] = useState(true);

  // mesma chamada de sempre (`crm.overview()`); só ganhou estado de carga e retry
  const carregar = useCallback(() => {
    setCarregando(true);
    setErr(false);
    crm
      .overview()
      .then(setData)
      .catch(() => setErr(true))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const k = data?.kpis;
  const funil = data?.funil ?? [];
  const atividades = data?.atividades ?? [];
  const contatos = data?.contatosRecentes ?? [];
  const vazio = !!data && funil.every((f) => f.total === 0);
  // etapa que concentra mais dinheiro — derivado, não inventado
  const etapaTopo = funil.length ? funil.reduce((a, b) => (b.valor > a.valor ? b : a)) : null;

  const kpis: { label: string; valor: string; icon: IconName }[] = [
    { label: 'Contatos', valor: k ? String(k.contatos) : '', icon: 'contacts' },
    { label: 'Negócios abertos', valor: k ? String(k.negocios) : '', icon: 'pipeline' },
    { label: 'Valor no funil', valor: k ? brl(k.valorFunil) : '', icon: 'finance' },
    { label: 'Fechado / Ganho', valor: k ? brl(k.ganho) : '', icon: 'trend' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      {/* Cabeçalho compacto: devolve a dobra para o conteúdo */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight text-fg sm:text-2xl">
            Olá, {user?.name?.split(' ')[0] ?? 'Você'} 👋
          </h1>
          <p className="text-sm text-muted">Resumo do seu negócio · dados ao vivo.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/contatos" className="btn btn-ghost text-sm">
            <Icon name="contacts" size={16} /> Contatos
          </Link>
          <Link href="/pipeline" className="btn btn-primary text-sm">
            <Icon name="pipeline" size={16} /> Ver pipeline
          </Link>
        </div>
      </header>

      {err && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <Icon name="close" size={17} />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">Não consegui carregar seus dados</p>
              <p className="text-xs text-muted">Verifique sua conexão e tente novamente.</p>
            </div>
          </div>
          <button onClick={carregar} className="btn btn-ghost text-sm">Tentar de novo</button>
        </Card>
      )}

      {/* KPIs — número domina, ícone discreto, grid sem quebra no lg */}
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kp) => (
          <Card key={kp.label} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-muted">{kp.label}</p>
              <Icon name={kp.icon} size={16} className="shrink-0 text-muted/70" />
            </div>
            {kp.valor ? (
              <p className="mt-2 text-2xl font-extrabold tracking-tight text-fg">{kp.valor}</p>
            ) : (
              <Skeleton className="mt-3 h-7 w-24" />
            )}
          </Card>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Funil — uma representação só; a linha de valores traz o que o gráfico não diz */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold text-fg">Funil de vendas</h2>
              <p className="text-xs text-muted">
                {k ? `${k.conversao}% de conversão até o fechamento` : 'Carregando…'}
              </p>
            </div>
            <Link href="/pipeline" className="shrink-0 text-xs font-semibold text-brand hover:underline">
              Ver pipeline →
            </Link>
          </div>

          {carregando && !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          ) : vazio || funil.length === 0 ? (
            <Vazio
              icon="pipeline"
              titulo="Seu funil está vazio"
              texto="Comece por um modelo do seu nicho: a Nyro cria o funil e as automações prontas."
              cta={{ href: '/onboarding', label: 'Montar meu Orvyn' }}
            />
          ) : (
            <>
              <Funnel data={funil.map((f) => ({ nome: f.nome, total: f.total }))} />
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
                {funil.map((f) => (
                  <li key={f.id} className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.cor }} aria-hidden="true" />
                    <span className="text-muted">{f.nome}</span>
                    <span className="font-semibold text-fg">{brl(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Resumo — números derivados dos dados reais + porta de entrada da Nyro */}
        <Card className="flex flex-col p-5">
          <h2 className="font-bold text-fg">Resumo</h2>
          <p className="text-xs text-muted">Calculado a partir dos seus dados.</p>

          {carregando && !data ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
            </div>
          ) : k ? (
            <ul className="mt-4 space-y-3">
              <Linha icon="contacts">
                <strong className="font-semibold">{k.contatos}</strong> contatos na base
              </Linha>
              <Linha icon="finance">
                <strong className="font-semibold">{brl(k.valorFunil)}</strong> em negócios abertos
              </Linha>
              <Linha icon="trend">
                <strong className="font-semibold">{k.conversao}%</strong> de conversão
              </Linha>
              {etapaTopo && etapaTopo.valor > 0 && (
                <Linha icon="pipeline">
                  Maior volume em <strong className="font-semibold">{etapaTopo.nome}</strong>
                </Linha>
              )}
            </ul>
          ) : null}

          <div className="mt-auto pt-5">
            <Link href="/nyro" className="btn btn-soft w-full text-sm">
              <Icon name="sparkles" size={15} /> Perguntar à Nyro
            </Link>
          </div>
        </Card>
      </div>

      {/* Secundários: peso visual menor que o bloco principal */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-fg">Atividade recente</h2>
          {carregando && !data ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-[30px] w-[30px] rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : atividades.length === 0 ? (
            <Vazio icon="dashboard" titulo="Nada por aqui ainda" texto="As ações da sua equipe aparecem nesta lista." />
          ) : (
            <ul className="space-y-4">
              {atividades.map((a, i) => (
                <li key={`${a.actor}-${a.acao}-${i}`} className="flex gap-3">
                  <Avatar name={a.actor} size={30} />
                  <p className="text-sm leading-snug text-fg">
                    <span className="font-semibold">{a.actor}</span> {a.acao}
                    {a.tone === 'warn' && (
                      <span className="ml-1.5 align-middle text-xs font-semibold text-amber-600 dark:text-amber-400">· atenção</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-fg">Contatos recentes</h2>
            <Link href="/contatos" className="text-xs font-semibold text-brand hover:underline">Ver todos →</Link>
          </div>
          {carregando && !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[52px] w-full rounded-xl" />)}
            </div>
          ) : contatos.length === 0 ? (
            <Vazio
              icon="contacts"
              titulo="Nenhum contato ainda"
              texto="Cadastre o primeiro contato ou conecte um canal de entrada."
              cta={{ href: '/contatos', label: 'Adicionar contato' }}
            />
          ) : (
            <ul className="space-y-2">
              {contatos.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/contatos/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface2 px-3 py-2.5 transition-colors hover:bg-surface3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={c.nome} size={34} />
                      <span className="truncate font-medium text-fg">{c.nome}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <Badge tone="neutral">{c.tag}</Badge>
                      <span className="text-sm font-semibold text-fg">{brl(c.valor)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
