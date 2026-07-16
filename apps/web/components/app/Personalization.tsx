'use client';

import { useEffect } from 'react';
import { settingsApi } from '@/lib/settings';
import { applyPrefs, type Prefs } from '@/lib/personalization';

/** Carrega as preferências do usuário (cor/fundo/tema) e aplica no documento. */
export function Personalization() {
  useEffect(() => {
    settingsApi.profile().then((p) => applyPrefs(p.prefs as Prefs)).catch(() => undefined);
  }, []);
  return null;
}
