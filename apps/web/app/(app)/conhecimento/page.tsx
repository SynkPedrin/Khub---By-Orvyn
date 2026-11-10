import Link from 'next/link';
import { listDocs } from '@/lib/cerebro';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';

export const dynamic = 'force-dynamic';

export default function ConhecimentoPage() {
  const docs = listDocs();
  const cats = new Map<string, typeof docs>();
  for (const d of docs) {
    const a = cats.get(d.category) ?? [];
    a.push(d);
    cats.set(d.category, a);
  }

  return (
    <div className="page-shell mx-auto min-w-0 w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/12 text-brand"><Icon name="knowledge" /></span>
        <div className="min-w-0">
          <h1 className="t-display">Base de conhecimento</h1>
          <p className="text-sm text-muted">O cérebro que alimenta a NICO (RAG) · {docs.length} documentos.</p>
        </div>
      </div>

      {[...cats.entries()].map(([cat, list]) => (
        <div key={cat}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((d) => (
              <Link className="min-w-0 break-words" key={d.slug} href={`/conhecimento/${d.slug.split('/').map(encodeURIComponent).join('/')}`}>
                <Card className="h-full p-4 transition-transform hover:-translate-y-0.5">
                  <p className="font-bold text-fg">{d.title}</p>
                  <p className="mt-1.5 line-clamp-2 text-sm text-muted">{d.excerpt}</p>
                  <p className="mt-3 text-[11px] text-muted">{d.words.toLocaleString('pt-BR')} palavras</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
