'use client';

import { clienteApi } from './session-fetch';

/** Notificações no celular (Web Push, API `/v1/push`). */
const req = clienteApi('/api/v1/push/');

export interface ConfigPush { ligado: boolean; chavePublica: string | null; aparelhos: number }

export type EstadoPush =
  | 'sem-suporte' // navegador não tem Push (ex.: Safari do iPhone fora do app instalado)
  | 'instalar-primeiro' // iPhone: só funciona com o app na tela inicial
  | 'servidor-desligado'
  | 'bloqueado' // a pessoa negou a permissão
  | 'desativado'
  | 'ativado';

export const ehIOS = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const ehAppInstalado = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function chaveParaBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const bruto = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const atual = await navigator.serviceWorker.getRegistration('/');
  return atual ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function estadoPush(): Promise<EstadoPush> {
  if (typeof window === 'undefined') return 'sem-suporte';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return ehIOS() && !ehAppInstalado() ? 'instalar-primeiro' : 'sem-suporte';
  }
  const cfg = await req<ConfigPush>('config').catch(() => null);
  if (!cfg?.ligado) return 'servidor-desligado';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await registro();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'ativado' : 'desativado';
}

/** Pede permissão, inscreve o aparelho e guarda no servidor. Precisa vir de um toque da pessoa. */
export async function ativarPush(): Promise<EstadoPush> {
  const cfg = await req<ConfigPush>('config');
  if (!cfg.ligado || !cfg.chavePublica) return 'servidor-desligado';
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return permissao === 'denied' ? 'bloqueado' : 'desativado';
  const reg = await registro();
  if (!reg) return 'sem-suporte';
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const chave = chaveParaBytes(cfg.chavePublica);
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave.buffer.slice(chave.byteOffset, chave.byteOffset + chave.byteLength) as ArrayBuffer });
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await req('inscrever', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
  return 'ativado';
}

export async function desativarPush(): Promise<void> {
  const reg = await registro();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await req('cancelar', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

export const testarPush = () => req<{ enviados: number }>('teste', { method: 'POST' });
