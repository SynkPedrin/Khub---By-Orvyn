'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';

const NICHOS = ['Clínica médica / estética', 'Advocacia', 'Contabilidade', 'Agência de marketing', 'Outro'];

export function SignupForm() {
  const { signInWith } = useAuth();
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [nicho, setNicho] = useState(NICHOS[0]);
  const [senha, setSenha] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    signInWith('email', { name: nome || 'Você', email: email || 'demo@orvyn.app', empresa, nicho });
    router.push('/');
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-fg">Crie sua conta</h1>
      <p className="mt-1 text-sm text-muted">Seu CRM pronto em minutos, configurado para o seu nicho.</p>

      <div className="mt-6">
        <SocialAuth label="Cadastrar" />
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> ou com e-mail <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Nome">
          <Input placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="E-mail">
          <Input type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Empresa">
            <Input placeholder="Sua empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
          </Field>
          <Field label="Nicho">
            <select className="input" value={nicho} onChange={(e) => setNicho(e.target.value)}>
              {NICHOS.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Senha">
          <Input type="password" placeholder="Crie uma senha" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" className="w-full">Criar conta grátis</Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Já tem conta?{' '}
        <Link href="/login" className="font-semibold text-brand hover:underline">Entrar</Link>
      </p>
      <p className="mt-3 text-center text-[11px] text-muted">Ao criar conta você concorda com os Termos e a Política de Privacidade (LGPD).</p>
    </div>
  );
}
