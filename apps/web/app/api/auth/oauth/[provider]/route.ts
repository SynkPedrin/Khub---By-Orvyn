import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// OAuth plugável: sem credenciais, responde de forma EXPLÍCITA (nunca mock silencioso).
export function GET(_req: Request, { params }: { params: { provider: string } }) {
  return NextResponse.json(
    {
      title: `Login com ${params.provider} ainda não configurado`,
      status: 501,
      detail: 'Defina GOOGLE_CLIENT_ID/SECRET, GITHUB_ID/SECRET e AUTH_SECRET para habilitar OAuth (via NextAuth). Por enquanto, use e-mail e senha.',
    },
    { status: 501 },
  );
}
