'use client';

import { clienteApi } from './session-fetch';

/** WhatsApp por QR Code próprio (open-wa, ADR-0058). */
const req = clienteApi('/api/v1/integrations/whatsapp-qr');

export type EstadoWhatsAppQr = 'nao_conectado' | 'iniciando' | 'aguardando_qr' | 'conectado' | 'desconectado' | 'erro';

export interface LinkConexaoWa {
  id: string;
  expiraEm: string;
  criadoEm: string;
  conectadoEm: string | null;
  numero: string | null;
  revogadoEm: string | null;
  acessos: number;
  situacao: 'ativo' | 'expirado' | 'revogado';
}

export interface PainelWhatsAppQr {
  configurado: boolean;
  faltando: string[];
  gatewayOk: boolean;
  vinculado: boolean;
  estado: EstadoWhatsAppQr;
  qr: string | null;
  numero: string | null;
  nome: string | null;
  fotoUrl: string | null;
  conectadoDesde: string | null;
  historico: { mensagens: number; conversas: number; sincronizadoEm: string | null };
  links: LinkConexaoWa[];
}

export const whatsappQrApi = {
  painel: () => req<PainelWhatsAppQr>(''),
  conectar: () => req<{ estado: EstadoWhatsAppQr; qr?: string }>('/conectar', { method: 'POST' }),
  desconectar: () => req<{ ok: true }>('/desconectar', { method: 'POST' }),
  historico: (dias: number) => req<{ loteId: string }>('/historico', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dias }) }),
  criarLink: () => req<{ id: string; url: string; expiraEm: string }>('/links', { method: 'POST' }),
  revogarLink: (id: string) => req<{ ok: true }>(`/links/${id}`, { method: 'DELETE' }),
};

/** Página pública `/w/<token>` (sem sessão; passa pelo proxy /api/public). */
export interface LinkPublicoWa {
  empresa: string;
  expiraEm: string;
  estado: EstadoWhatsAppQr;
  qr: string | null;
  numero: string | null;
}

async function publico<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/public/whatsapp/${caminho}`, { cache: 'no-store', ...init });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; title?: string; message?: string };
  if (!r.ok) throw Object.assign(new Error(j.detail ?? j.title ?? j.message ?? 'Não consegui carregar.'), { status: r.status });
  return j;
}

export const whatsappLinkApi = {
  ver: (token: string) => publico<LinkPublicoWa>(token),
  novoQr: (token: string) => publico<{ estado: EstadoWhatsAppQr; qr: string | null }>(`${token}/novo-qr`, { method: 'POST', body: '{}' }),
};

/** Dias restantes, para "expira em N dias". */
export function diasRestantes(iso: string, agora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - agora) / 86_400_000));
}
