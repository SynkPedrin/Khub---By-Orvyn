'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Icon } from '../icons';
import { NyroMensagens } from './NyroMensagens';
import { useNyroChat } from '@/lib/use-nyro-chat';

const SUGESTOES = [
  'Como está meu funil?',
  'Quem são meus leads quentes?',
  'Crie uma tarefa de follow-up para amanhã',
  'Qual é o gargalo do meu funil?',
];

/**
 * Dock flutuante da NICO. A lógica do chat mora em `useNyroChat` e o corpo em
 * `NyroMensagens` — os mesmos da página cheia (`/nyro`). Aqui é só o invólucro.
 * (Nomes internos de arquivo/rota/API seguem "nyro" — ver lib/nyro.ts; só a
 * marca exibida ao usuário virou NICO.)
 */
export function NyroDock() {
  const [open, setOpen] = useState(false);
  const { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir } = useNyroChat(open);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolar = useCallback(() => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: 'smooth' }), 40), []);
  useEffect(() => { rolar(); }, [bolhas, passos, rolar]);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Abrir a NICO"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-brand transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}
      >
        <Icon name="sparkles" size={24} />
      </button>

      {open && (
        <div className="glass crystal-edge fixed bottom-24 right-5 z-40 flex max-h-[76vh] w-[380px] max-w-[92vw] animate-scale-in flex-col overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Image src="/nico-logo.png" alt="NICO" width={96} height={32} unoptimized className="h-6 w-auto object-contain" />
              <div>
                <p className="text-[11px]">
                  {status?.configurada === false
                    ? <span className="text-amber-600 dark:text-amber-400">● precisa de configuração</span>
                    : <span className="text-lime-ink dark:text-lime">● online</span>}
                </p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-white/40 dark:hover:bg-white/10" aria-label="Fechar">
              <Icon name="close" size={17} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
            <NyroMensagens status={status} bolhas={bolhas} passos={passos} pensando={pensando} erro={erro} sugestoes={SUGESTOES} onSugestao={enviar} onDecidir={decidir} />
            <div ref={fimRef} />
          </div>

          {status?.configurada !== false && (
            <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="border-t border-line p-3">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  disabled={pensando}
                  placeholder="Fale com a NICO…"
                  className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted disabled:opacity-60"
                />
                <button type="submit" disabled={!texto.trim() || pensando} aria-label="Enviar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white disabled:opacity-40">
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
