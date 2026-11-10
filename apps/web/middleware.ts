import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ACCESS, API, REFRESH, clearSession, setSession } from './lib/server-auth';

// Guard de rotas por sessão real (cookie httpOnly de refresh). O access é
// curto e renovado silenciosamente pelo cliente; a presença do refresh é a
// fonte de verdade de "logado". Logout limpa os cookies no servidor.
//
// "/" é a landing page pública (marketing) — não é mais o dashboard, então
// entra em PUBLIC como qualquer visitante anônimo pode ver. O dashboard real
// mora em "/dashboard" (protegido, como qualquer outra rota fora de PUBLIC).
const PUBLIC = ['/', '/login', '/signup', '/agency-invite', '/esqueci-senha', '/redefinir-senha', '/termos', '/privacidade'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')));
  // A cookie's presence does not authenticate its bearer. Public login must
  // remain reachable even with expired or fabricated cookies.
  if (isPublic) return NextResponse.next();
  const access = req.cookies.get(ACCESS)?.value;
  const refresh = req.cookies.get(REFRESH)?.value;
  const login = () => {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    const res = NextResponse.redirect(url);
    clearSession(res);
    return res;
  };
  if (!access && !refresh) return login();
  try {
    if (access) {
      const me = await fetch(`${API}/v1/auth/me`, {headers:{authorization:`Bearer ${access}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
      if (me.ok) return NextResponse.next();
      // 429 = limite de requisições do tenant. O JwtAuthGuard roda ANTES do RateLimitGuard, então a
      // sessão é válida: bloquear a navegação aqui derrubava o app inteiro do tenant por até 60s.
      if (me.status === 429) return NextResponse.next();
      if (me.status !== 401) return new NextResponse('Não foi possível verificar sua sessão. Tente novamente.',{status:503});
    }
    if (!refresh) return login();
    const renewed = await fetch(`${API}/v1/auth/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh}),cache:'no-store',signal:AbortSignal.timeout(8000)});
    if (renewed.status === 401 || renewed.status === 403) return login();
    if (!renewed.ok) return new NextResponse('Não foi possível renovar sua sessão. Tente novamente.',{status:503});
    const session = await renewed.json();
    if (typeof session.access !== 'string' || typeof session.refresh !== 'string') return login();
    req.cookies.set(ACCESS,session.access);
    req.cookies.set(REFRESH,session.refresh);
    const res = NextResponse.next({request:{headers:req.headers}});
    setSession(res,session.access,session.refresh);
    return res;
  } catch {
    return new NextResponse('Serviço de autenticação indisponível. Tente novamente.',{status:503});
  }
}

export const config = {
  // exclui API, assets internos e arquivos estáticos (imagem, VÍDEO, fonte).
  // Sem o vídeo aqui, o middleware de auth redireciona /fundo-animado.mp4 (307)
  // e o plano de fundo nunca carrega — mesma armadilha que a logo já teve.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|avif|mp4|webm|mov|woff2?|ttf)$).*)'],
};
