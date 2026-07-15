import type { NextResponse } from 'next/server';

export const API = process.env.ORVYN_API_URL ?? 'http://localhost:3333';
export const ACCESS = 'orvyn_access';
export const REFRESH = 'orvyn_refresh';

const secure = process.env.NODE_ENV === 'production';

export function setSession(res: NextResponse, access: string, refresh: string): void {
  res.cookies.set(ACCESS, access, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 15 });
  res.cookies.set(REFRESH, refresh, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(ACCESS, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH, '', { path: '/', maxAge: 0 });
}
