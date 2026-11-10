'use client';

import { Icon } from '../icons';

export function SocialAuth({ label }: { label: string }) {
  // Navegação de página inteira (OAuth exige redirect real, não fetch): o
  // endpoint gera o state, seta o cookie e manda o navegador ao provedor.
  const ir = (provider: 'google' | 'github') => {
    window.location.href = `/api/auth/oauth/${provider}`;
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => ir('google')} className="btn btn-ghost" aria-label={`${label} com Google`}>
        <Icon name="google" size={18} /> Google
      </button>
      <button type="button" onClick={() => ir('github')} className="btn btn-ghost" aria-label={`${label} com GitHub`}>
        <Icon name="github" size={18} /> GitHub
      </button>
    </div>
  );
}
