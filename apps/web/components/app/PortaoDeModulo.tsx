'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { MODULOS, moduloDaRota, podeVer, telaInicial } from '@/lib/modulos';

/**
 * Portão de módulo (ADR-0045). A API já recusa (403) o que a pessoa não pode
 * ver; aqui a tela some de forma limpa em vez de abrir quebrada. Quem cai no
 * Dashboard sem ter o módulo (é a tela pós-login) vai direto para a primeira
 * tela liberada.
 */
export function PortaoDeModulo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const { user, ready } = useAuth();
  const modulos = user?.modulos;
  const liberado = !ready || podeVer(modulos, pathname);
  const inicio = telaInicial(modulos);

  useEffect(() => {
    if (!liberado && pathname === '/dashboard' && inicio !== '/dashboard') router.replace(inicio);
  }, [liberado, pathname, inicio, router]);

  if (liberado) return <>{children}</>;

  const nome = MODULOS.find((m) => m.chave === moduloDaRota(pathname))?.nome ?? 'esta área';
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center" role="alert">
      <span className="icon-tile mb-4 grid h-12 w-12 place-items-center rounded-2xl">
        <Icon name="lock" size={22} />
      </span>
      <h1 className="text-lg font-bold text-fg">Sem acesso a {nome}</h1>
      <p className="mt-1.5 text-sm text-muted">O administrador da conta ainda não liberou este módulo para você. Peça para ele em Configurações › Equipe.</p>
      <Link href={inicio} className="btn btn-primary mt-5">
        Ir para o que você pode ver <Icon name="arrowRight" size={16} />
      </Link>
    </div>
  );
}
