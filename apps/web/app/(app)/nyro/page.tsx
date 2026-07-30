'use client';

import { useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Icon } from '@/components/icons';
import { NyroMensagens } from '@/components/app/NyroMensagens';
import { useNyroChat } from '@/lib/use-nyro-chat';
import { useAuth } from '@/lib/auth';

const SUGESTOES = [
  'Monte meu funil pelo meu nicho',
  'Como está meu funil hoje?',
  'Quem são meus leads quentes?',
  'Crie uma automação de follow-up',
  'Qual é o gargalo do meu funil?',
  'Traga uma automação de boas-vindas',
];

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function NyroPage() {
  const { user } = useAuth();
  const { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir } = useNyroChat(true);
  const fimRef = useRef<HTMLDivElement>(null);
  const rolar = useCallback(() => setTimeout(() => fimRef.current?.scrollIntoView({ behavior: 'smooth' }), 40), []);
  useEffect(() => { rolar(); }, [bolhas, passos, rolar]);

  // Mensagem pronta vinda da Biblioteca ("Como usar isso na minha empresa?"):
  // dispara sozinha uma vez, quando o chat está pronto e configurado.
  const autoRef = useRef(false);
  useEffect(() => {
    if (autoRef.current || status == null || status.configurada === false) return;
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    autoRef.current = true;
    void enviar(q);
  }, [status, enviar]);

  const vazio = bolhas.length === 0 && status?.configurada !== false;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      {vazio ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-4 text-center">
          <Image src="/logo.png" alt="" width={72} height={72} unoptimized className="crystal-logo h-16 w-16 object-contain" />
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-fg">{saudacao()}, {user?.name?.split(' ')[0] ?? 'Você'}</h1>
          <p className="mt-1.5 max-w-md text-sm text-muted">
            Sou a <b className="text-brand">Nyro</b> — arquiteta do CRM, operadora de leads, estrategista de growth e consultora do seu nicho. Peça algo abaixo.
          </p>
          <div className="mt-6 w-full max-w-xl text-left">
            <NyroMensagens status={status} bolhas={bolhas} passos={passos} pensando={pensando} erro={erro} sugestoes={SUGESTOES} onSugestao={enviar} onDecidir={decidir} />
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto py-6 scrollbar-thin">
          <div className="mx-auto max-w-2xl space-y-4">
            <NyroMensagens status={status} bolhas={bolhas} passos={passos} pensando={pensando} erro={erro} sugestoes={SUGESTOES} onSugestao={enviar} onDecidir={decidir} />
            <div ref={fimRef} />
          </div>
        </div>
      )}

      {status?.configurada !== false && (
        <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="mx-auto w-full max-w-2xl pb-5">
          <div className="glass crystal-edge flex items-end gap-2 rounded-[1.4rem] p-2.5">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
              disabled={pensando}
              rows={1}
              placeholder="Como posso ajudar você hoje?"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg outline-none placeholder:text-muted disabled:opacity-60"
            />
            <button type="submit" disabled={!texto.trim() || pensando} aria-label="Enviar" className="btn btn-primary !h-10 !w-10 !rounded-full !p-0">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">A Nyro age pelo CRM com as suas permissões — ações sensíveis pedem sua aprovação.</p>
        </form>
      )}
    </div>
  );
}
