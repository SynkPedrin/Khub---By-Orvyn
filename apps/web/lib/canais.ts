'use client';

import { clienteApi } from './session-fetch';

/**
 * Canais conectados de Conversas (db/063): `/api/v1/integrations/canais/*`
 * → `/v1/integrations/canais/*`. O WhatsApp segue no fluxo próprio
 * (`/integrations/whatsapp`), reaproveitado aqui sem reescrita.
 */
const req = clienteApi('/api/v1/');

export type EstadoCartao = 'conectado' | 'nao_conectado' | 'precisa_credencial' | 'indisponivel';

export interface CartaoCanal {
  rede: 'whatsapp' | 'instagram' | 'messenger' | 'youtube' | 'tiktok';
  titulo: string;
  descricao: string;
  estado: EstadoCartao;
  gate: { provider: string; missing: string[] } | null;
  conectarVia: 'whatsapp' | 'meta' | 'youtube' | 'tiktok' | null;
  recursos: { rotulo: string; disponivel: boolean; motivo?: string }[];
  contas: { id: string; nome: string; externalId: string; status: string; erro: string | null; ultimaSyncAt: string | null }[];
  motivo?: string;
  docs: string[];
}

export const canaisApi = {
  cartoes: () => req<CartaoCanal[]>('integrations/canais'),
  urlConexao: (provedor: 'meta' | 'youtube' | 'tiktok') => req<{ url: string }>(`integrations/canais/${provedor}/auth-url`),
  desconectar: (id: string) => req<{ ok: boolean }>(`integrations/canais/conexoes/${id}`, { method: 'DELETE' }),
  sincronizar: (id: string) => req<{ novos: number; lidos: number }>(`integrations/canais/conexoes/${id}/sincronizar`, { method: 'POST' }),
};
