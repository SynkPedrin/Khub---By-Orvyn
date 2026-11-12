import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { FormularioPublico } from '@/components/publico/FormularioPublico';
import { IndisponivelPublico } from '@/components/publico/IndisponivelPublico';
import { buscarPublico } from '@/lib/publico/proxy';
import type { FormPublico } from '@/lib/publico/tipos';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

/** Versão para iframe: sem margens nem cartão; a altura vai ao site pai por postMessage. */
export default async function EmbedFormulario({ params }: { params: { slug: string } }) {
  if (!/^[a-z0-9-]{4,64}$/.test(params.slug)) notFound();
  const r = await buscarPublico<FormPublico>(`forms/${params.slug}`, headers());
  if (!r.ok && r.status === 404) notFound();
  return (
    <main className="m-0 w-full p-0">
      {r.ok ? (
        <FormularioPublico slug={params.slug} nome={r.dados.nome} campos={r.dados.campos} estilo={r.dados.estilo} marca={r.dados.marca.nome} carimbo={r.dados.carimbo} modo="embed" />
      ) : (
        <IndisponivelPublico status={r.status} compacto />
      )}
    </main>
  );
}
