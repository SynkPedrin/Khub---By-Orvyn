'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';

const NICHOS = ['Clínica médica / estética', 'Advocacia', 'Contabilidade', 'Agência de marketing', 'Outro'];

export function SignupForm() {
  const { refreshMe } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('invite');
  const [f, setF] = useState({ nome: '', email: '', empresa: '', nicho: NICHOS[0], senha: '' });
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      // Convite: o e-mail e o tenant vêm do token — só pedimos nome e senha.
      const url = invite ? '/api/auth/invites/accept' : '/api/auth/signup';
      const body = invite
        ? { token: invite, nome: f.nome, password: f.senha }
        : { email: f.email, password: f.senha, nome: f.nome, empresa: f.empresa, nicho: f.nicho };
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(
          invite
            ? d.title?.toString() || 'Convite inválido, expirado ou já utilizado.'
            : r.status === 409
              ? 'Esse e-mail já tem conta.'
              : d.message?.toString() || 'Não foi possível criar a conta.',
        );
        return;
      }
      await refreshMe();
      router.replace('/');
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-fg">{invite ? 'Você foi convidado 🎉' : 'Crie sua conta'}</h1>
      <p className="mt-1 text-sm text-muted">
        {invite ? 'Defina seu nome e uma senha para entrar na equipe.' : 'Seu CRM pronto em minutos, configurado para o seu nicho.'}
      </p>

      {!invite && (
        <>
          <div className="mt-6"><SocialAuth label="Cadastrar" /></div>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> ou com e-mail <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={invite ? 'mt-6 space-y-3.5' : 'space-y-3.5'}>
        <Field label="Nome"><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Seu nome" autoComplete="name" required /></Field>

        {!invite && (
          <>
            <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@empresa.com" autoComplete="email" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Empresa"><Input value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} placeholder="Sua empresa" /></Field>
              <Field label="Nicho">
                <select className="input" value={f.nicho} onChange={(e) => setF({ ...f, nicho: e.target.value })}>
                  {NICHOS.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}

        <Field label="Senha" hint={invite ? 'Se você já tem conta neste e-mail, use a mesma senha.' : undefined}>
          <Input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="Mínimo 8 caracteres" autoComplete="new-password" minLength={8} required />
        </Field>

        {erro && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{erro}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (invite ? 'Entrando…' : 'Criando…') : invite ? 'Aceitar convite e entrar' : 'Criar conta grátis'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Já tem conta? <Link href="/login" className="font-semibold text-brand hover:underline">Entrar</Link>
      </p>
      <p className="mt-3 text-center text-[11px] text-muted">Ao criar conta você concorda com os Termos e a Política de Privacidade (LGPD).</p>
    </div>
  );
}
