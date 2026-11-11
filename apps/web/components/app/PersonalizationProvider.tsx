'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { settingsApi } from '@/lib/settings';
import { applyPrefs, type Prefs } from '@/lib/personalization';
import { modoDemo } from '@/lib/demo/flag';

interface Ctx {
  prefs: Prefs;
  /** Logo da marca do cliente (ou vazio = padrão KHUB). */
  logo: string;
  /** Aplica na hora + persiste no perfil (`users.prefs`). */
  update: (patch: Prefs) => void;
  ready: boolean;
}

const PersonalizationContext = createContext<Ctx | null>(null);

/**
 * Fonte única da personalização do cliente (cor, fundo, tema, logo).
 *
 * Carrega as prefs do perfil uma vez, aplica no documento (CSS vars) e mantém em
 * estado para que a ilha (logo) e a tela de Configurações leiam o MESMO valor —
 * trocar a logo em Configurações reflete na hora no canto superior esquerdo.
 */
export function PersonalizationProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // O modo demo é uma vitrine AUTOCONTIDA: não consulta o backend.
    // Sem isto, esta chamada recebe 401 com a API fora do ar, dispara o
    // encerramento de sessão e o operador nunca consegue ver a interface —
    // que é justamente o propósito do modo demo.
    if (modoDemo()) {
      setReady(true);
      return;
    }

    settingsApi
      .profile()
      .then((p) => {
        const loaded = (p.prefs ?? {}) as Prefs;
        setPrefs(loaded);
        applyPrefs(loaded);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  // O tema claro vale só para a área logada: ao sair do shell (logout, LP)
  // o documento volta ao escuro, que é a identidade do login e da landing.
  useEffect(() => () => document.documentElement.setAttribute('data-theme', 'dark'), []);

  // "Sistema": acompanha a troca claro/escuro do SO sem recarregar.
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const seguir = () => document.documentElement.setAttribute('data-theme', mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', seguir);
    return () => mq.removeEventListener('change', seguir);
  }, [prefs.theme]);

  const update = useCallback((patch: Prefs) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      applyPrefs(next);
      // persiste best-effort: falhar aqui não pode travar a UI
      settingsApi.updateProfile({ prefs: next as Record<string, unknown> }).catch(() => undefined);
      return next;
    });
  }, []);

  return (
    <PersonalizationContext.Provider value={{ prefs, logo: prefs.logo ?? '', update, ready }}>
      {children}
    </PersonalizationContext.Provider>
  );
}

export function usePersonalization(): Ctx {
  const ctx = useContext(PersonalizationContext);
  if (!ctx) throw new Error('usePersonalization precisa do <PersonalizationProvider>');
  return ctx;
}
