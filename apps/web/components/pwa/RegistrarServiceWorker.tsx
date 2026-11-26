'use client';

import { useEffect } from 'react';

/** Evento de instalação do Chrome/Android/Edge (não tipado no DOM padrão). */
export interface PedidoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window { __khubInstalar?: PedidoDeInstalacao | null }
}

/**
 * Registra o service worker do app mobile (push + offline) e guarda o pedido
 * de instalação do navegador para o botão "Baixar app" usar depois.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const guardar = (e: Event) => {
      e.preventDefault();
      window.__khubInstalar = e as PedidoDeInstalacao;
      window.dispatchEvent(new Event('khub:instalavel'));
    };
    const instalado = () => { window.__khubInstalar = null; window.dispatchEvent(new Event('khub:instalado')); };
    window.addEventListener('beforeinstallprompt', guardar);
    window.addEventListener('appinstalled', instalado);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
    return () => { window.removeEventListener('beforeinstallprompt', guardar); window.removeEventListener('appinstalled', instalado); };
  }, []);
  return null;
}
