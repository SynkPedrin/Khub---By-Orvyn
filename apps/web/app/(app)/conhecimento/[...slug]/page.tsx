import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDoc } from '@/lib/cerebro';
import { Markdown } from '@/components/Markdown';
import { Icon } from '@/components/icons';

export const dynamic = 'force-dynamic';

export default function ConhecimentoDoc({ params }: { params: { slug: string[] } }) {
  const segments = (params.slug ?? []).map((s) => decodeURIComponent(s));
  const doc = getDoc(segments);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link href="/conhecimento" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand">
        <Icon name="chevronRight" size={15} className="rotate-180" /> Base de conhecimento
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand/12 px-2.5 py-0.5 text-[11px] font-semibold text-brand">{doc.category}</span>
        <span className="text-[11px] text-muted">
          {doc.words.toLocaleString('pt-BR')} palavras · {new Date(doc.updatedAt).toLocaleDateString('pt-BR')}
        </span>
      </div>

      <article className="card p-6 sm:p-8">
        <Markdown>{doc.markdown}</Markdown>
      </article>
    </div>
  );
}
