'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Doc { slug: string; title: string; excerpt: string; words: number }

const MK = 'RAG/conhecimento/global/marketing/';
const OP = 'RAG/conhecimento/global/operacao/';
const href = (slug: string) => '/conhecimento/' + slug.split('/').map(encodeURIComponent).join('/');

export default function MarketingPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);

  useEffect(() => {
    fetch('/api/cerebro').then((r) => r.json()).then((d) => setDocs(d.docs ?? [])).catch(() => setDocs([]));
  }, []);

  const marketing = docs?.filter((d) => d.slug.startsWith(MK)) ?? [];
  const operacao = docs?.filter((d) => d.slug.startsWith(OP)) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      {/* Hero */}
      <section className="overflow-hidden rounded-3xl border border-line p-8" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand) 16%, var(--surface)), var(--surface) 60%)' }}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand">
          <Icon name="sparkles" size={15} /> Inteligência da Nyro
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-fg">Central de Marketing</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted sm:text-base">
          Como <strong>Estrategista de Growth</strong>, a Nyro raciocina sobre estes frameworks para posicionar sua marca,
          gerar demanda, lançar ofertas e medir o que funciona — sempre ancorada no seu funil e nos seus dados.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/nyro" className="btn btn-primary"><Icon name="sparkles" size={16} /> Perguntar à Nyro</Link>
          <Link href="/conhecimento" className="btn btn-ghost">Ver base de conhecimento</Link>
        </div>
      </section>

      {/* Frameworks de marketing */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="marketing" size={18} /></span>
          <h2 className="text-lg font-bold text-fg">Frameworks de marketing</h2>
          <span className="rounded-full bg-surface3 px-2 py-0.5 text-[11px] font-semibold text-muted">{marketing.length}</span>
        </div>
        {!docs && <p className="text-sm text-muted">Carregando a inteligência da Nyro…</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {marketing.map((d) => (
            <Link key={d.slug} href={href(d.slug)}>
              <Card className="flex h-full flex-col p-4 transition-transform hover:-translate-y-0.5">
                <p className="font-bold text-fg">{d.title}</p>
                <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted">{d.excerpt}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">Abrir framework <Icon name="chevronRight" size={13} /></span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Operação (mesma inteligência C-level) */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="dashboard" size={18} /></span>
          <h2 className="text-lg font-bold text-fg">Operação &amp; growth</h2>
          <span className="rounded-full bg-surface3 px-2 py-0.5 text-[11px] font-semibold text-muted">{operacao.length}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {operacao.map((d) => (
            <Link key={d.slug} href={href(d.slug)}>
              <Card className="flex h-full flex-col p-4 transition-transform hover:-translate-y-0.5">
                <p className="font-bold text-fg">{d.title}</p>
                <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted">{d.excerpt}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">Abrir framework <Icon name="chevronRight" size={13} /></span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <p className="pb-2 text-center text-[11px] text-muted">
        Estes {marketing.length + operacao.length} frameworks estão ingeridos no RAG (escopo global) — a Nyro os recupera ao raciocinar sobre estratégia.
        Campanhas conectadas (Meta/Google) chegam na F5.
      </p>
    </div>
  );
}
