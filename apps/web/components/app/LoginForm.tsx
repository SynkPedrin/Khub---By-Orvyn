'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';

export function LoginForm() {
  const { signInWith } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = email.split('@')[0]?.replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Você';
    signInWith('email', { email: email || 'demo@orvyn.app', name });
    router.push(params.get('next') || '/');
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-fg">Bem-vindo de volta</h1>
      <p className="mt-1 text-sm text-muted">Entre para acessar seu CRM.</p>

      <div className="mt-6">
        <SocialAuth label="Entrar" />
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> ou com e-mail <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail">
          <Input type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Senha">
          <Input type="password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" className="accent-brand" /> Lembrar de mim
          </label>
          <a href="#" className="font-medium text-brand hover:underline">Esqueci a senha</a>
        </div>
        <Button type="submit" className="w-full">Entrar</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Ainda não tem conta?{' '}
        <Link href="/signup" className="font-semibold text-brand hover:underline">Criar conta</Link>
      </p>
      <p className="mt-4 text-center text-[11px] text-muted">Protótipo — sessão demo. Auth real (OAuth Google/GitHub) pluga no NextAuth.</p>
    </div>
  );
}
