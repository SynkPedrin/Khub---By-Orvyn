'use client';

import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { SEM_PERMISSAO, type FalhaCarga } from './fin-utils';

/** Estado de falha de carregamento: sem permissão (403) ou erro com nova tentativa. */
export function FinFalha({ falha, onTentar }: { falha: FalhaCarga; onTentar: () => void }) {
  if (falha.tipo === 'permissao') {
    return (
      <div role="status" className="flex flex-col items-center gap-2 px-5 py-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-muted"><Icon name="shield" size={18} /></span>
        <p className="max-w-md text-sm text-muted">{SEM_PERMISSAO}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <p className="max-w-md text-sm text-muted">{falha.mensagem}</p>
      <Button variant="ghost" onClick={onTentar}>Tentar de novo</Button>
    </div>
  );
}

/** Aviso de erro de uma ação (salvar, excluir...). */
export function FinAviso({ texto, tom = 'erro' }: { texto: string; tom?: 'erro' | 'ok' }) {
  return (
    <p
      role={tom === 'erro' ? 'alert' : 'status'}
      className={
        tom === 'erro'
          ? 'rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400'
          : 'rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400'
      }
    >
      {texto}
    </p>
  );
}
