import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { GerenciarReserva } from '@/components/publico/GerenciarReserva';
import { IndisponivelPublico } from '@/components/publico/IndisponivelPublico';
import { buscarPublico } from '@/lib/publico/proxy';
import type { BookingPublico, ReservaPublica } from '@/lib/publico/tipos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gerenciar agendamento', robots: { index: false } };

/** Remarcar/cancelar pelo link da confirmação. O token é a credencial (só o hash fica no banco). */
export default async function PaginaGerenciar({ params }: { params: { slug: string; token: string } }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.token)) notFound();
  const h = headers();
  const r = await buscarPublico<ReservaPublica>(`reservas/${params.token}`, h);
  if (!r.ok && r.status === 404) notFound();
  // Os dias livres vêm da página atual (só se ela continua ativa).
  const pagina = r.ok && r.dados.podeAlterar && r.dados.paginaAtiva ? await buscarPublico<BookingPublico>(`booking/${r.dados.slug}`, h) : null;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      {r.ok ? (
        <div className="card p-6 sm:p-8">
          <GerenciarReserva token={params.token} reserva={r.dados} pagina={pagina?.ok ? pagina.dados : null} />
        </div>
      ) : (
        <IndisponivelPublico status={r.status} />
      )}
    </main>
  );
}
