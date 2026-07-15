'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';

export function LoginForm() {
  const { refreshMe } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: senha }) });
      if (!r.ok) {
        setErro(r.status === 401 ? 'E-mail ou senha inválidos.' : 'Não foi possível entrar. Tente novamente.');
        return;
      }
      await refreshMe();
      router.replace(params.get('next') || '/');
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
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
          <Input type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Senha">
          <Input type="password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
        </Field>
        {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{erro}</p>}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" className="accent-brand" /> Lembrar de mim</label>
          <a href="#" className="font-medium text-brand hover:underline">Esqueci a senha</a>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Ainda não tem conta? <Link href="/signup" className="font-semibold text-brand hover:underline">Criar conta</Link>
      </p>
    </div>
  );
}
