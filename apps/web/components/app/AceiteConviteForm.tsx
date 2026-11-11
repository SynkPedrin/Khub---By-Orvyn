'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '../ui';
import { Icon } from '../icons';
import { Modal } from '@/components/kit';
import { PasswordInput } from './PasswordInput';
import { useAuth } from '@/lib/auth';

interface Preview { email: string; empresa: string; papel: string; contaExistente: boolean; expiraEm: string }

const titulo = { fontSize: 30, fontWeight: 650, letterSpacing: '-0.035em' } as const;

/** Copia texto com fallback (navegadores antigos / contexto sem clipboard API). */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * Aceite do convite da subaccount (ADR-0042). A pessoa vê para qual empresa e
 * com qual e-mail vai entrar, escolhe e confirma a senha, e recebe um popup com
 * o login e a senha escolhida para guardar. Ela entra direto nessa subaccount,
 * que é a única que ela acessa.
 */
export function AceiteConviteForm({ token }: { token: string }) {
  const { refreshMe } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalido, setInvalido] = useState(false);
  const [f, setF] = useState({ nome: '', senha: '', confirmar: '' });
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [credenciais, setCredenciais] = useState<{ email: string; senha: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    fetch('/api/auth/invites/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (r) => { if (!r.ok) throw new Error(); setPreview(await r.json()); })
      .catch(() => setInvalido(true));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    setErro('');
    if (f.senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (!preview.contaExistente && f.senha !== f.confirmar) { setErro('As duas senhas não são iguais. Digite de novo.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/invites/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, nome: f.nome.trim() || undefined, password: f.senha }),
      });
      const d = await r.json().catch(() => ({})) as { title?: string; detail?: string };
      if (!r.ok) {
        setErro(r.status === 401
          ? 'Senha incorreta. Este e-mail já tem conta no KHUB: use a senha que você já usa.'
          : r.status === 400 ? (d.detail || d.title || 'Convite inválido, expirado ou já utilizado.') : 'Não foi possível entrar agora. Tente novamente.');
        return;
      }
      await refreshMe();
      setCredenciais({ email: preview.email, senha: f.senha });
    } catch {
      setErro('Falha de conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const entrar = () => { setCredenciais(null); router.replace('/dashboard'); };

  if (invalido) {
    return (
      <div>
        <h1 className="text-fg" style={titulo}>Convite indisponível</h1>
        <p className="mt-2 text-[13.5px] text-muted">Este link é inválido, expirou ou já foi usado. Peça a quem te convidou para gerar um novo link.</p>
        <p className="mt-6 text-sm text-muted">Já criou sua senha? <Link href="/login" className="font-semibold text-brand hover:underline">Entrar</Link></p>
      </div>
    );
  }
  if (!preview) {
    return <p className="text-sm text-muted" role="status">Carregando seu convite…</p>;
  }

  return (
    <div>
      <h1 className="text-fg" style={titulo}>Você foi <span className="text-brand">convidado.</span></h1>
      <p className="mt-1.5 text-[13.5px] text-muted">
        Acesso à <strong className="text-fg">{preview.empresa}</strong> no KHUB.{' '}
        {preview.contaExistente ? 'Este e-mail já tem conta: confirme a sua senha atual.' : 'Escolha a sua senha para entrar.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3.5">
        <Field label="Seu login (e-mail)">
          <div className="flex items-start gap-2 rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm text-fg">
            <Icon name="mail" size={15} className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0 break-all" data-testid="convite-email">{preview.email}</span>
          </div>
        </Field>
        {!preview.contaExistente && (
          <Field label="Seu nome">
            <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Como você quer ser chamado" autoComplete="name" maxLength={160} autoFocus />
          </Field>
        )}
        <Field label={preview.contaExistente ? 'Sua senha atual' : 'Crie uma senha'} hint={preview.contaExistente ? undefined : 'Pelo menos 8 caracteres.'}>
          <PasswordInput value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="••••••••" autoComplete={preview.contaExistente ? 'current-password' : 'new-password'} minLength={8} required autoFocus={preview.contaExistente} />
        </Field>
        {!preview.contaExistente && (
          <Field label="Confirme a senha">
            <PasswordInput value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} placeholder="Repita a senha" autoComplete="new-password" minLength={8} required />
          </Field>
        )}
        {erro && (
          <p className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600" role="alert">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            {erro}
          </p>
        )}
        <Button type="submit" className="btn-auth-primary w-full" disabled={loading}>
          {loading ? 'Entrando…' : preview.contaExistente ? 'Confirmar e entrar' : 'Criar senha e entrar'}
          {!loading && <Icon name="arrowRight" size={16} />}
        </Button>
      </form>

      <Modal
        open={!!credenciais}
        onClose={entrar}
        closeOnBackdrop={false}
        title="Guarde o seu acesso"
        description="Anote ou salve num lugar seguro. Você vai usar estes dados para entrar no KHUB."
        footer={<Button onClick={entrar}>Entendi, entrar no sistema <Icon name="arrowRight" size={16} /></Button>}
      >
        {credenciais && (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-surface2 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Login</p>
              <p className="mt-0.5 break-all font-semibold text-fg" data-testid="credencial-email">{credenciais.email}</p>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Senha</p>
              <p className="mt-0.5 break-all font-mono font-semibold text-fg" data-testid="credencial-senha">{credenciais.senha}</p>
            </div>
            <button
              type="button"
              onClick={async () => { setCopiado(await copiar(`Login KHUB: ${credenciais.email}\nSenha: ${credenciais.senha}`)); }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
            >
              <Icon name={copiado ? 'check' : 'file'} size={15} /> {copiado ? 'Copiado' : 'Copiar login e senha'}
            </button>
            <p className="text-xs text-muted">Esqueceu depois? Na tela de login, use &quot;Esqueci a senha&quot;.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
