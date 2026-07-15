'use client';

import { useState } from 'react';
import { Icon } from '../icons';

export function SocialAuth({ label }: { label: string }) {
  const [msg, setMsg] = useState('');

  const handle = async (provider: 'google' | 'github') => {
    // OAuth plugável: sem credenciais, o endpoint responde 501 explicando.
    const r = await fetch(`/api/auth/oauth/${provider}`);
    const d = await r.json().catch(() => ({}));
    setMsg(d.detail || `Login com ${provider} indisponível.`);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => handle('google')} className="btn btn-ghost" aria-label={`${label} com Google`}>
          <Icon name="google" size={18} /> Google
        </button>
        <button type="button" onClick={() => handle('github')} className="btn btn-ghost" aria-label={`${label} com GitHub`}>
          <Icon name="github" size={18} /> GitHub
        </button>
      </div>
      {msg && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{msg}</p>}
    </div>
  );
}
