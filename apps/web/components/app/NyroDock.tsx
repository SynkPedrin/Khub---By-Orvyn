'use client';

import { useState } from 'react';
import { Icon } from '../icons';

const SUGESTOES = [
  'Criar um funil para plano anual',
  'Responder os leads não lidos do inbox',
  'Analisar minhas campanhas do Meta',
  'Reativar pacientes inativos',
];

export function NyroDock() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Abrir a Nyro"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-brand transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}
      >
        <Icon name="sparkles" size={24} />
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-40 flex max-h-[70vh] w-[360px] max-w-[92vw] animate-scale-in flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3" style={{ background: 'color-mix(in srgb, var(--brand) 8%, var(--surface))' }}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white">
                <Icon name="sparkles" size={17} />
              </span>
              <div>
                <p className="text-sm font-bold text-fg">Nyro</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">● online</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface3">
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface2 px-3.5 py-2.5 text-sm text-fg">
              Oi! 👋 Sou a Nyro, sua camada de inteligência. Posso configurar o CRM, conversar com leads e analisar suas métricas. Por onde começamos?
            </div>
            <div className="space-y-1.5">
              {SUGESTOES.map((s) => (
                <button key={s} className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left text-[13px] text-fg transition-colors hover:border-brand/50 hover:bg-brand/5">
                  <Icon name="chevronRight" size={15} className="text-brand" />
                  {s}
                </button>
              ))}
            </div>
            <p className="pt-1 text-center text-[11px] text-muted">Protótipo — a Nyro entra em operação na F3.</p>
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
              <input placeholder="Escreva para a Nyro…" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
              <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
