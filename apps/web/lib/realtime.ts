'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeEnvelope, RealtimeEvent, RealtimeEvents } from '@khub/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

let socket: Socket | null = null;
let refs = 0;

/** Busca um ticket novo. Curto de propósito — ver ADR-0011. */
async function pegarTicket(): Promise<string> {
  const r = await fetch('/api/auth/ws-ticket', { method: 'POST' });
  if (!r.ok) throw new Error('sem ticket');
  const d = (await r.json()) as { ticket: string };
  return d.ticket;
}

/**
 * Socket único da aba (D2). Detalhe que importa: o ticket vale 60s, então a
 * reconexão NÃO pode reusar o mesmo — `auth` é uma função, e o Socket.IO a chama
 * a cada tentativa, buscando um ticket fresco. Com `auth` estático, o socket
 * voltaria com credencial morta e seria recusado para sempre.
 */
function obterSocket(): Socket {
  if (socket) return socket;
  socket = io(`${API}/rt`, {
    transports: ['websocket'],
    auth: (cb) => {
      pegarTicket()
        .then((ticket) => cb({ ticket }))
        .catch(() => cb({})); // sem ticket: o servidor recusa e o cliente tenta de novo
    },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 8_000,
  });
  return socket;
}

export type Handlers = { [E in RealtimeEvent]?: (dados: RealtimeEvents[E]) => void };

/**
 * Assina eventos do tenant. Devolve `conectado` para a tela decidir se precisa
 * do plano B (polling) — a UI nunca deve depender só do socket.
 */
export function useRealtime(handlers: Handlers): { conectado: boolean } {
  const [conectado, setConectado] = useState(false);
  // handlers mudam a cada render; o ref evita re-assinar o socket toda vez
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const s = obterSocket();
    refs++;

    const onConnect = () => setConectado(true);
    const onDisconnect = () => setConectado(false);
    const onErro = () => setConectado(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onErro);
    s.on('nao_autorizado', onErro);
    if (s.connected) setConectado(true);

    // um listener por evento, despachando para o handler mais recente
    const eventos = Object.keys(ref.current) as RealtimeEvent[];
    const inscritos = eventos.map((evento) => {
      const fn = (env: RealtimeEnvelope) => {
        const h = ref.current[evento] as ((d: unknown) => void) | undefined;
        h?.(env?.dados);
      };
      s.on(evento, fn);
      return { evento, fn };
    });

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onErro);
      s.off('nao_autorizado', onErro);
      for (const { evento, fn } of inscritos) s.off(evento, fn);
      // última tela a sair fecha o socket (evita conexão órfã após logout)
      if (--refs <= 0) {
        s.close();
        socket = null;
        refs = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { conectado };
}
