'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field } from '../ui';
import { Icon } from '../icons';
import { IconInput } from './IconInput';
import { PasswordInput } from './PasswordInput';

const titulo = { fontSize: 30, fontWeight: 650, letterSpacing: '-0.035em' } as const;

function Erro({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600" role="alert">
      <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}

/** "Esqueci minha senha": pede o e-mail. A resposta é sempre a mesma (não revela se a conta existe). */
export function EsqueciSenhaForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/password/status').then((r) => r.json()).then((d: { disponivel?: boolean }) => setDisponivel(!!d.disponivel)).catch(() => setDisponivel(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      if (r.status === 429) { setErro('Muitas tentativas. Espere um minuto e tente de novo.'); return; }
      if (!r.ok) { setErro(r.status === 400 ? 'Confira o e-mail digitado.' : 'Não foi possível enviar agora. Tente novamente.'); return; }
      setEnviado(true);
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-fg" style={titulo}>Esqueceu a <span className="text-brand">senha?</span></h1>
      <p className="mt-1.5 text-[13.5px] text-muted">Informe o e-mail da sua conta. Enviamos um link para você criar uma senha nova.</p>

      {enviado ? (
        <div className="mt-6 space-y-4">
          <p className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">
            <Icon name="mail" size={16} className="mt-0.5 shrink-0" />
            <span>Se existir uma conta com <strong>{email.trim()}</strong>, o link chega em alguns minutos. Ele vale por 60 minutos e só pode ser usado uma vez. Confira também o spam.</span>
          </p>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setEnviado(false)}>Enviar de novo</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {disponivel === false && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400" role="status">
              O envio de e-mail ainda não está configurado nesta instalação. Peça ao administrador da sua conta para redefinir a sua senha.
            </p>
          )}
          <Field label="E-mail">
            <IconInput icon="mail" type="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </Field>
          {erro && <Erro>{erro}</Erro>}
          <Button type="submit" className="btn-auth-primary w-full" disabled={loading || disponivel === false}>
            {loading ? 'Enviando…' : 'Enviar link'}
            {!loading && <Icon name="arrowRight" size={16} />}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        Lembrou? <Link href="/login" className="font-semibold text-brand hover:underline">Voltar para o login</Link>
      </p>
    </div>
  );
}

/** Página do link do e-mail: define a senha nova e encerra as sessões abertas. */
export function RedefinirSenhaForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (senha !== confirma) { setErro('As duas senhas não são iguais.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/password/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: senha }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { detail?: string; message?: string | string[] };
        setErro(r.status === 400 ? 'Este link é inválido ou expirou. Peça um novo.' : (typeof d.detail === 'string' ? d.detail : 'Não foi possível redefinir agora.'));
        return;
      }
      setOk(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div>
        <h1 className="text-fg" style={titulo}>Link incompleto</h1>
        <p className="mt-2 text-[13.5px] text-muted">Abra o link exatamente como chegou no e-mail, ou peça um novo.</p>
        <Link href="/esqueci-senha" className="mt-6 inline-block font-semibold text-brand hover:underline">Pedir um novo link</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-fg" style={titulo}>Crie sua <span className="text-brand">nova senha.</span></h1>
      <p className="mt-1.5 text-[13.5px] text-muted">Ao salvar, todas as sessões abertas da sua conta são encerradas por segurança.</p>

      {ok ? (
        <p className="mt-6 flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">
          <Icon name="check" size={16} className="mt-0.5 shrink-0" />
          Senha alterada. Levando você para o login…
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
            <PasswordInput placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" required autoFocus />
          </Field>
          <Field label="Repita a nova senha">
            <PasswordInput placeholder="••••••••" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" required />
          </Field>
          {erro && <Erro>{erro}{erro.includes('expirou') && <> <Link href="/esqueci-senha" className="font-semibold underline">Pedir novo link</Link></>}</Erro>}
          <Button type="submit" className="btn-auth-primary w-full" disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </form>
      )}
    </div>
  );
}
