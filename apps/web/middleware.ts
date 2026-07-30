import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Guard de rotas por sessão real (cookie httpOnly de refresh). O access é
// curto e renovado silenciosamente pelo cliente; a presença do refresh é a
// fonte de verdade de "logado". Logout limpa os cookies no servidor.
const PUBLIC = ['/login', '/signup'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = req.cookies.has('orvyn_refresh');
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (!authed && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (authed && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // exclui API, assets internos e arquivos estáticos (imagem, VÍDEO, fonte).
  // Sem o vídeo aqui, o middleware de auth redireciona /fundo-animado.mp4 (307)
  // e o plano de fundo nunca carrega — mesma armadilha que a logo já teve.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|avif|mp4|webm|mov|woff2?|ttf)$).*)'],
};
