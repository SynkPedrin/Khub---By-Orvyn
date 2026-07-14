'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '../icons';
import { useAuth, type Provider } from '@/lib/auth';

export function SocialAuth({ label }: { label: string }) {
  const { signInWith } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const handle = (p: Provider) => {
    // DEMO: cria sessão local. Auth real (NextAuth) pluga aqui com Google/GitHub OAuth.
    signInWith(p);
    router.push(params.get('next') || '/');
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <button onClick={() => handle('google')} className="btn btn-ghost" aria-label={`${label} com Google`}>
        <Icon name="google" size={18} /> Google
      </button>
      <button onClick={() => handle('github')} className="btn btn-ghost" aria-label={`${label} com GitHub`}>
        <Icon name="github" size={18} /> GitHub
      </button>
    </div>
  );
}
