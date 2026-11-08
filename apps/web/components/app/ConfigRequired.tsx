'use client';

import { providerLabel } from '@/lib/api-error';

/**
 * Aviso de credencial pendente (Brief §2). A feature está pronta: o que falta é
 * a chave. Mostra exatamente quais variáveis definir — nunca "algo deu errado".
 */
export function ConfigRequired({ provider, missing, compact }: { provider: string; missing: string[]; compact?: boolean }) {
  const label = providerLabel(provider);
  return (
    <div className={`rounded-xl border border-amber-400/40 bg-amber-400/10 ${compact ? 'px-3 py-2' : 'p-4'}`}>
      <p className={`font-semibold text-amber-700 dark:text-amber-300 ${compact ? 'text-xs' : 'text-sm'}`}>
        Configurar {label}
      </p>
      <p className={`mt-1 text-amber-700/90 dark:text-amber-200/80 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        Tudo já está implementado, falta a credencial. Defina no <code className="font-mono">.env</code> da API:
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {missing.map((v) => (
          <li key={v} className="rounded-md bg-amber-400/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:text-amber-200">{v}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-amber-700/70 dark:text-amber-200/60">Referência completa: docs/ENV.md</p>
    </div>
  );
}
