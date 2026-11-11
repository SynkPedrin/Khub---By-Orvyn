'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { Icon } from '../icons';
import { IconInput } from './IconInput';
import { PasswordInput } from './PasswordInput';
import { SocialAuth } from './SocialAuth';
import { useAuth } from '@/lib/auth';
import { AceiteConviteForm } from './AceiteConviteForm';

const NICHOS = ['Clínica médica / estética', 'Advocacia', 'Contabilidade', 'Agência de marketing', 'Outro'];

export function SignupForm() {
  const { refreshMe } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('invite');
  const [f, setF] = useState({ nome: '', email: '', empresa: '', nicho: NICHOS[0], senha: '', confirmarSenha: '' });
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!invite && f.senha !== f.confirmarSenha) {
      setErro('As senhas não coincidem.');
      return;
    }
    if (!invite && !aceite) {
      setErro('Você precisa aceitar os Termos de uso e a Política de Privacidade.');
      return;
    }
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
      router.replace('/dashboard');
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  // Convite de subaccount: fluxo próprio (pré-visualização, confirmação de senha e popup de credenciais).
  if (invite) return <AceiteConviteForm token={invite} />;

  return (
    <div>
      <h1 className="text-fg" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.035em' }}>
        {invite ? 'Você foi convidado 🎉' : <>Crie <span className="whitespace-nowrap text-brand">sua conta.</span></>}
      </h1>
      <p className="mt-1.5 text-[13.5px] text-muted">
        {invite ? 'Defina seu nome e uma senha para entrar na equipe.' : 'Comece sua operação com o KHUB.'}
      </p>

      {!invite && (
        <>
          <div className="mt-6"><SocialAuth label="Cadastrar" /></div>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> ou cadastre-se com e-mail <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={invite ? 'mt-6 space-y-3.5' : 'space-y-3.5'}>
        <Field label={invite ? 'Nome' : 'Nome completo'}>
          {invite ? (
            <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Seu nome" autoComplete="name" required />
          ) : (
            <IconInput icon="user" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Seu nome" autoComplete="name" required />
          )}
        </Field>

        {!invite && (
          <>
            <Field label="E-mail">
              <IconInput icon="mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@empresa.com" autoComplete="email" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Empresa"><IconInput icon="building" value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} placeholder="Sua empresa" /></Field>
              <Field label="Nicho">
                <select className="input" value={f.nicho} onChange={(e) => setF({ ...f, nicho: e.target.value })}>
                  {NICHOS.map((n) => <option key={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}

        <Field label="Senha" hint={invite ? 'Se você já tem conta neste e-mail, use a mesma senha.' : undefined}>
          <PasswordInput value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="Mínimo 8 caracteres" autoComplete="new-password" minLength={8} required />
        </Field>

        {!invite && (
          <Field label="Confirmar senha">
            <PasswordInput
              value={f.confirmarSenha}
              onChange={(e) => setF({ ...f, confirmarSenha: e.target.value })}
              placeholder="Repita a senha"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
        )}

        {erro && (
          <p className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            {erro}
          </p>
        )}

        {!invite && (
          <label className="flex items-start gap-2.5 text-[13px] text-muted">
            {/* Sem `required` de propósito: a validação nativa do navegador
                bloquearia o submit ANTES do handler rodar, escondendo esse
                caso atrás de um tooltip nativo em vez da mensagem de erro
                do próprio card — o mesmo padrão usado para "senhas não
                coincidem", logo abaixo. */}
            <input type="checkbox" className="accent-brand mt-0.5" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
            <span>
              Li e concordo com os{' '}
              <Link href="/termos" target="_blank" className="font-medium text-brand hover:underline">Termos de uso</Link>{' '}
              e a{' '}
              <Link href="/privacidade" target="_blank" className="font-medium text-brand hover:underline">Política de Privacidade</Link>{' '}
              (LGPD).
            </span>
          </label>
        )}

        <Button type="submit" className="btn-auth-primary w-full" disabled={loading}>
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
          {loading ? (invite ? 'Entrando…' : 'Criando…') : invite ? 'Aceitar convite e entrar' : 'Criar conta'}
          {!loading && <Icon name="arrowRight" size={16} />}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Já possui conta? <Link href="/login" className="font-semibold text-brand hover:underline">Entrar</Link>
      </p>
    </div>
  );
}
