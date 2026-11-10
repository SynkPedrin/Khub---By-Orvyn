import { redirect } from 'next/navigation';

/**
 * O inbox real mora em /conversas (ADR-0039). Esta rota antiga só redireciona,
 * preservando o deep link da busca ⌘K (`?c=<id da conversa>`).
 */
export default function InboxRedirect({ searchParams }: { searchParams: { c?: string } }) {
  redirect(searchParams.c ? `/conversas?c=${encodeURIComponent(searchParams.c)}` : '/conversas');
}
