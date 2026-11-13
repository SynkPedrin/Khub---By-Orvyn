'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field } from '../ui';
import { Icon } from '../icons';
import { IconInput } from './IconInput';
import { PasswordInput } from './PasswordInput';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';
import { agency } from '@/lib/agency';

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
      const next = params.get('next');
      if (next) {
        router.replace(next);
      } else {
        // identidade de agência (Pedro etc.) entra pela Agency Home, não
        // por um tenant "de bootstrap" escondido — cliente direto (contexto
        // null) segue pro dashboard normal, sem nenhuma mudança de rota.
        const contexto = await agency.meuContexto().catch(() => null);
        router.replace(contexto ? '/agency' : '/dashboard');
      }
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-fg" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.035em' }}>
        Bem-vindo <span className="whitespace-nowrap text-brand">de volta.</span>
      </h1>
      <p className="mt-1.5 text-[13.5px] text-muted">Entre para continuar sua operação.</p>

      <div className="mt-6">
        <SocialAuth label="Entrar" />
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> ou entre com e-mail <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail">
          <IconInput icon="mail" type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Senha">
          <PasswordInput placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
        </Field>
        {erro && (
          <p className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            {erro}
          </p>
        )}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-muted"><input type="checkbox" className="accent-brand" /> Lembrar de mim</label>
          <Link href={`/esqueci-senha${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="font-medium text-brand hover:underline">Esqueci a senha</Link>
        </div>
        <Button type="submit" className="btn-auth-primary w-full" disabled={loading}>
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
          {loading ? 'Entrando…' : 'Entrar no KHUB'}
          {!loading && <Icon name="arrowRight" size={16} />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Novo no KHUB? <Link href="/signup" className="font-semibold text-brand hover:underline">Criar conta</Link>
      </p>
    </div>
  );
}
