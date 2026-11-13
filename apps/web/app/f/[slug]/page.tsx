import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { FormularioPublico } from '@/components/publico/FormularioPublico';
import { IndisponivelPublico } from '@/components/publico/IndisponivelPublico';
import { buscarPublico } from '@/lib/publico/proxy';
import type { FormPublico } from '@/lib/publico/tipos';

export const dynamic = 'force-dynamic';

async function carregar(slug: string) {
  if (!/^[a-z0-9-]{4,64}$/.test(slug)) return { ok: false as const, status: 404 };
  return buscarPublico<FormPublico>(`forms/${slug}`, headers());
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await carregar(params.slug);
  if (!r.ok) return { title: 'Formulário', robots: { index: false } };
  return { title: `${r.dados.estilo.titulo || r.dados.nome} · ${r.dados.marca.nome}`, description: r.dados.estilo.descricao, robots: { index: false } };
}

export default async function PaginaFormulario({ params }: { params: { slug: string } }) {
  const r = await carregar(params.slug);
  if (!r.ok && r.status === 404) notFound();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10 sm:py-16">
      {r.ok ? (
        <div className="card p-6 sm:p-8">
          <FormularioPublico slug={params.slug} nome={r.dados.nome} campos={r.dados.campos} estilo={r.dados.estilo} marca={r.dados.marca.nome} carimbo={r.dados.carimbo} modo="pagina" />
        </div>
      ) : (
        <IndisponivelPublico status={r.status} />
      )}
    </main>
  );
}
