import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { AgendamentoPublico } from '@/components/publico/AgendamentoPublico';
import { IndisponivelPublico } from '@/components/publico/IndisponivelPublico';
import { buscarPublico } from '@/lib/publico/proxy';
import type { BookingPublico } from '@/lib/publico/tipos';

export const dynamic = 'force-dynamic';

async function carregar(slug: string) {
  if (!/^[a-z0-9-]{4,64}$/.test(slug)) return { ok: false as const, status: 404 };
  return buscarPublico<BookingPublico>(`booking/${slug}`, headers());
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await carregar(params.slug);
  if (!r.ok) return { title: 'Agendamento', robots: { index: false } };
  return { title: `${r.dados.titulo} · ${r.dados.marca.nome}`, description: r.dados.descricao ?? undefined, robots: { index: false } };
}

export default async function PaginaAgendamento({ params }: { params: { slug: string } }) {
  const r = await carregar(params.slug);
  if (!r.ok && r.status === 404) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      {r.ok ? (
        <div className="card p-6 sm:p-8">
          <AgendamentoPublico slug={params.slug} dados={r.dados} />
        </div>
      ) : (
        <IndisponivelPublico status={r.status} />
      )}
    </main>
  );
}
