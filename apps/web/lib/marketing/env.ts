/**
 * URLs de auth usadas pelos CTAs da landing page ("/").
 *
 * A LP e o app autenticado agora são o MESMO app Next.js (mesma porta,
 * mesmo domínio) — os CTAs usam paths relativos, sem env var de domínio
 * externo (ver `Nyro IA/LP REVENUE/site/lib/env.ts` para o histórico de
 * quando a LP era um projeto standalone separado).
 */
export const LOGIN_URL = '/login';
export const SIGNUP_URL = '/signup';
