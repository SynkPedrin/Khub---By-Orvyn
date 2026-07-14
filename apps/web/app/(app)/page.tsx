'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, Avatar } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Funnel } from '@/components/charts';
import { useAuth } from '@/lib/auth';
import { crm, brl, type Overview } from '@/lib/crm';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    crm.overview().then(setData).catch(() => setErr(true));
  }, []);

  const k = data?.kpis;
  const kpis = [
    { label: 'Contatos', valor: k ? String(k.contatos) : '—', icon: 'contacts' as const },
    { label: 'Negócios abertos', valor: k ? String(k.negocios) : '—', icon: 'pipeline' as const },
    { label: 'Valor no funil', valor: k ? brl(k.valorFunil) : '—', icon: 'finance' as const },
    { label: 'Fechado / Ganho', valor: k ? brl(k.ganho) : '—', icon: 'trend' as const },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">Olá, {user?.name?.split(' ')[0] ?? 'Você'} 👋</h1>
          <p className="mt-1 text-sm text-muted">Resumo do seu negócio · dados ao vivo do seu CRM.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/contatos" className="btn btn-ghost"><Icon name="contacts" size={16} /> Contatos</Link>
          <Link href="/pipeline" className="btn btn-primary"><Icon name="plus" size={16} /> Pipeline</Link>
        </div>
      </div>

      {err && <Card className="p-4 text-sm text-amber-600 dark:text-amber-400">Não consegui carregar os dados. A API (apps/api) está rodando na porta 3333?</Card>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kp) => (
          <Card key={kp.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">{kp.label}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name={kp.icon} size={17} /></span>
            </div>
            <p className="mt-2 text-2xl font-extrabold text-fg">{kp.valor}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-fg">Funil de vendas</h2>
              <p className="text-xs text-muted">{k ? `${k.negocios} negócios · ${brl(k.valorFunil)}` : 'carregando…'}</p>
            </div>
            <Link href="/pipeline" className="text-xs font-semibold text-brand hover:underline">Ver pipeline →</Link>
          </div>
          <Funnel data={(data?.funil ?? []).map((f) => ({ nome: f.nome, total: f.total }))} />
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(data?.funil ?? []).map((f) => (
              <div key={f.id} className="rounded-xl border border-line bg-surface2 p-3 text-center">
                <div className="mx-auto mb-1 h-2 w-2 rounded-full" style={{ background: f.cor }} />
                <p className="text-lg font-extrabold text-fg">{f.total}</p>
                <p className="truncate text-[11px] text-muted">{f.nome}</p>
                <p className="text-[11px] font-semibold text-brand">{brl(f.valor)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="p-5" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand) 16%, var(--surface)), var(--surface))' }}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white"><Icon name="sparkles" size={17} /></span>
              <h2 className="font-bold text-fg">Insights da Nyro</h2>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { t: 'Leads respondidos em menos de 5 min convertem 3× mais. Quer ativar a resposta automática?', cta: 'Ativar' },
                { t: `Você tem ${k?.contatos ?? 0} contatos e ${brl(k?.valorFunil ?? 0)} no funil. Posso priorizar os quentes.`, cta: 'Priorizar leads' },
              ].map((i) => (
                <div key={i.t} className="rounded-xl border border-line bg-surface p-3">
                  <p className="text-[13px] text-fg">{i.t}</p>
                  <button className="mt-2 text-xs font-semibold text-brand hover:underline">{i.cta} →</button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-4 font-bold text-fg">Atividade recente</h2>
          <div className="space-y-4">
            {(data?.atividades ?? []).map((a, i) => (
              <div key={i} className="flex gap-3">
                <Avatar name={a.actor} size={30} />
                <p className="text-[13px] leading-snug text-fg"><span className="font-semibold">{a.actor}</span> {a.acao}</p>
              </div>
            ))}
            {!data && <p className="text-sm text-muted">Carregando…</p>}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-fg">Contatos recentes</h2>
            <Link href="/contatos" className="text-xs font-semibold text-brand hover:underline">Ver todos →</Link>
          </div>
          <div className="space-y-2">
            {(data?.contatosRecentes ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-surface2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Avatar name={c.nome} size={34} />
                  <span className="font-medium text-fg">{c.nome}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="neutral">{c.tag}</Badge>
                  <span className="text-sm font-semibold text-fg">{brl(c.valor)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
