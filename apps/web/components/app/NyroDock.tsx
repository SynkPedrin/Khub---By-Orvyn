'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { NyroMensagens } from './NyroMensagens';
import { NICO, NicoAvatar, NicoStatus, type EstadoNico } from '../nico/Nico';
import { useNyroChat } from '@/lib/use-nyro-chat';

const SUGESTOES = [
  'Como está meu funil?',
  'Quem são meus leads quentes?',
  'Crie uma tarefa de follow-up para amanhã',
  'Qual é o gargalo do meu funil?',
];

/**
 * A NICO sempre à mão, em qualquer tela (ADR-0040): um balão com o rosto
 * dela, como chamar uma colega. A lógica do chat é a mesma da página cheia
 * (`useNyroChat` + `NyroMensagens`); aqui é só o invólucro. Some na própria
 * página da NICO para não aparecer duas vezes.
 * (Nomes internos de arquivo/rota/API seguem "nyro"; a marca exibida é NICO.)
 */
export function NyroDock() {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir, aoVivo, plano } = useNyroChat(open);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolar = useCallback(() => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: 'smooth' }), 40), []);
  useEffect(() => {
    rolar();
  }, [bolhas, passos, aoVivo, plano, rolar]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  if (pathname.startsWith('/nyro')) return null;
  const estado: EstadoNico = status?.configurada === false ? 'configurar' : pensando ? 'pensando' : 'online';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Fechar a NICO' : 'Chamar a NICO'}
        aria-expanded={open}
        title="NICO, sua agente interna de marketing"
        className="fixed bottom-5 right-5 z-40 rounded-full transition-transform duration-200 hover:-translate-y-0.5"
      >
        <NicoAvatar tamanho={56} estado={open ? estado : 'online'} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Conversa com a NICO"
          className="lg-sheet fixed bottom-24 right-5 z-40 flex max-h-[76vh] w-[390px] max-w-[92vw] animate-scale-in flex-col overflow-hidden rounded-3xl"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <NicoAvatar tamanho={38} estado={estado} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-fg" title={NICO.papel}>
                {NICO.nome} <span className="font-normal text-muted">· marketing</span>
              </p>
              <NicoStatus estado={estado} />
            </div>
            <Link href="/nyro" className="btn btn-ghost btn-icon btn-sm" aria-label="Abrir a mesa da NICO" title="Abrir em tela cheia" onClick={() => setOpen(false)}>
              <Icon name="expand" size={15} />
            </Link>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar">
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
            {bolhas.length === 0 && status?.configurada !== false && (
              <p className="text-[13.5px] text-muted">Oi! Sou a NICO, da sua equipe de marketing. Me peça algo e eu faço por aqui mesmo.</p>
            )}
            <NyroMensagens status={status} bolhas={bolhas} passos={passos} pensando={pensando} erro={erro} sugestoes={SUGESTOES} onSugestao={enviar} onDecidir={decidir} aoVivo={aoVivo} plano={plano} />
            <div ref={fimRef} />
          </div>

          {status?.configurada !== false && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
              className="border-t border-line p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  disabled={pensando}
                  placeholder="Peça algo para a NICO"
                  aria-label="Mensagem para a NICO"
                  className="input min-w-0 flex-1"
                />
                <button type="submit" disabled={!texto.trim() || pensando} aria-label="Enviar" className="btn btn-primary btn-icon">
                  <Icon name="send" size={16} />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
