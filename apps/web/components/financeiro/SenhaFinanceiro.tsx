'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Button, Modal } from '@/components/kit';
import { definirDesbloqueio, desbloqueado, financeiro } from '@/lib/financeiro';

interface SenhaApi {
  /** null = ainda verificando. */
  configurada: boolean | null;
  liberado: boolean;
  /** Resolve true se já está liberado ou depois que a pessoa digita a senha certa. */
  garantir: (motivo: string) => Promise<boolean>;
  trancar: () => void;
  recarregar: () => void;
  /** Chamado quando a senha foi digitada em outro lugar (cadeado da aba). */
  aoLiberar: () => void;
}

const Ctx = createContext<SenhaApi | null>(null);

export function useSenhaFinanceiro(): SenhaApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSenhaFinanceiro fora do SenhaFinanceiroProvider');
  return c;
}

/**
 * Senha do financeiro (ADR-0051): abre Visão geral e Comissões e autoriza
 * editar/cancelar venda. Digitada uma vez, vale 30 min neste navegador (só em
 * memória; recarregar a página tranca de novo).
 */
export function SenhaFinanceiroProvider({ children }: { children: ReactNode }) {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [liberado, setLiberado] = useState(desbloqueado());
  const [pedido, setPedido] = useState<{ motivo: string; resolver: (ok: boolean) => void } | null>(null);

  const recarregar = useCallback(() => {
    financeiro.senhaEstado().then((r) => setConfigurada(r.configurada)).catch(() => setConfigurada(false));
  }, []);
  useEffect(recarregar, [recarregar]);

  // O desbloqueio expira sozinho: confere de tempos em tempos.
  useEffect(() => {
    const id = setInterval(() => setLiberado(desbloqueado()), 15_000);
    return () => clearInterval(id);
  }, []);

  const garantir = useCallback(
    (motivo: string) => {
      if (configurada === false || desbloqueado()) return Promise.resolve(true);
      return new Promise<boolean>((resolver) => setPedido({ motivo, resolver }));
    },
    [configurada],
  );

  const trancar = useCallback(() => {
    definirDesbloqueio(null);
    setLiberado(false);
  }, []);

  return (
    <Ctx.Provider value={{ configurada, liberado: configurada === false || liberado, garantir, trancar, recarregar, aoLiberar: () => setLiberado(true) }}>
      {children}
      <Modal open={!!pedido} onClose={() => { pedido?.resolver(false); setPedido(null); }} title="Senha do financeiro" size="sm" description={pedido?.motivo}>
        <FormSenha
          onOk={() => {
            setLiberado(true);
            pedido?.resolver(true);
            setPedido(null);
          }}
        />
      </Modal>
    </Ctx.Provider>
  );
}

function FormSenha({ onOk, compacto }: { onOk: () => void; compacto?: boolean }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!senha) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await financeiro.verificarSenha(senha);
      if (r.token) definirDesbloqueio(r.token, r.expiraEm);
      onOk();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setErro(status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Senha incorreta.');
      setSenha('');
      ref.current?.focus();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className={compacto ? 'flex w-full max-w-sm flex-col gap-2' : 'space-y-3'}>
      <input
        ref={ref}
        type="password"
        className="input h-11 text-base"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="Digite a senha"
        autoComplete="off"
        aria-label="Senha do financeiro"
        aria-invalid={!!erro}
      />
      {erro && <p className="text-sm font-medium text-danger" role="alert">{erro}</p>}
      <Button type="submit" loading={enviando} disabled={!senha} className="w-full">
        <Icon name="lock" size={15} /> Entrar
      </Button>
    </form>
  );
}

/** Conteúdo protegido (Visão geral, Comissões): sem senha digitada, mostra o cadeado. */
export function TravaFinanceiro({ titulo, children }: { titulo: string; children: ReactNode }) {
  const s = useSenhaFinanceiro();
  if (s.configurada === null) return <div className="skeleton h-40 w-full rounded-2xl" aria-hidden />;
  if (s.liberado) return <>{children}</>;
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="icon-tile">
        <Icon name="lock" size={20} />
      </span>
      <p className="t-title">{titulo} protegido por senha</p>
      <p className="max-w-sm text-sm text-muted">Só quem tem a senha do financeiro vê esta área.</p>
      <FormSenha compacto onOk={s.aoLiberar} />
    </div>
  );
}
