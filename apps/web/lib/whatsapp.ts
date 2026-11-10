'use client';

import { clienteApi } from './session-fetch';

const req = clienteApi('/api/v1/integrations/whatsapp/');

export type EstadoWhatsApp =
  | 'desconectado'
  | 'aguardando_qr'
  | 'conectando'
  | 'conectado'
  | 'erro'
  | 'nao_configurado';

export interface QrWhatsApp {
  qrImageDataUrl?: string;
  qrText?: string;
  pairingCode?: string;
  expiresAt: string;
}

export interface ConexaoWhatsApp {
  estado: EstadoWhatsApp;
  numero?: string;
  qr?: QrWhatsApp;
  atualizadoEm: string;
}

export const whatsappApi = {
  connect: () => req<ConexaoWhatsApp>('connect', { method: 'POST' }),
  status: (incluirQr = false) => req<ConexaoWhatsApp>(incluirQr ? 'status?qr=true' : 'status'),
  disconnect: () => req<{ ok: boolean }>('disconnect', { method: 'DELETE' }),
};
