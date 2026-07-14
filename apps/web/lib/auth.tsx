'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Provider = 'google' | 'github' | 'email';

export interface OrvynUser {
  name: string;
  email: string;
  provider: Provider;
  empresa?: string;
  nicho?: string;
}

interface AuthCtx {
  user: OrvynUser | null;
  ready: boolean;
  signInWith: (p: Provider, data?: Partial<OrvynUser>) => OrvynUser;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);
const KEY = 'orvyn.session';

function setCookie(v: string) {
  document.cookie = `orvyn_session=${v}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
}
function clearCookie() {
  document.cookie = 'orvyn_session=; path=/; max-age=0; samesite=lax';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OrvynUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* noop */
    }
    setReady(true);
  }, []);

  const signInWith = useCallback((p: Provider, data?: Partial<OrvynUser>): OrvynUser => {
    const fallbackName = p === 'google' ? 'Usuário Google' : p === 'github' ? 'Usuário GitHub' : 'Você';
    const u: OrvynUser = {
      name: data?.name || fallbackName,
      email: data?.email || (p === 'email' ? 'demo@orvyn.app' : `demo@${p}.com`),
      provider: p,
      empresa: data?.empresa,
      nicho: data?.nicho,
    };
    localStorage.setItem(KEY, JSON.stringify(u));
    setCookie('1');
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(KEY);
    clearCookie();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signInWith, signOut }), [user, ready, signInWith, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
