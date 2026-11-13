'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface KhubUser {
  name: string;
  email: string;
  role?: string;
  empresa?: string;
  tenantId?: string;
  /** identities.id (Inbox: filtro "Minhas", menções). */
  identityId?: string;
  /** Módulos que a pessoa vê (ADR-0045). null = sem restrição. */
  modulos?: string[] | null;
}

interface AuthCtx {
  user: KhubUser | null;
  ready: boolean;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<KhubUser | null>(null);
  const [ready, setReady] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        setUser({ name: d.nome || d.email || 'Você', email: d.email, role: d.role, empresa: d.tenant?.nome, tenantId: d.tenant?.id, identityId: d.identityId, modulos: Array.isArray(d.modulos) ? d.modulos : null });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshMe().finally(() => setReady(true));
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, refreshMe, signOut }), [user, ready, refreshMe, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
