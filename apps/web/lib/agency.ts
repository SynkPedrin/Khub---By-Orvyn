'use client';

import { clienteApi } from './session-fetch';

// Prefixo sem o segmento final "agency" — mesma convenção de `lib/ads.ts`
// (`req('ads/overview')`), evita a ambiguidade de barra final que uma chamada
// com caminho vazio (`req('')`) teria contra o proxy catch-all `[...path]`.
const req = clienteApi('/api/v1/');

export interface MeuContextoAgencia {
  agencyId: string;
  nome: string;
  slug: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  isDemo: boolean;
}

export interface ClienteAgencia {
  id: string;
  tenantId: string;
  nome: string;
  status: 'active' | 'paused' | 'archived';
  isDemo: boolean;
  createdAt: string;
  contatos: number;
  negocios: number;
  receitaFechada: number;
  ultimaAtividadeEm: string | null;
}

export interface DetalheClienteAgencia extends ClienteAgencia {
  tenant: { id: string; nome: string; nicho: string | null; status: string; createdAt: string } | null;
  overview: unknown;
}

export interface AgenciaOverview {
  totalClientes: number;
  negociosAbertosTotal: number;
  clientes: ClienteAgencia[];
}

export interface MembroAgencia {
  id: string;
  identityId: string;
  email: string;
  role: string;
  createdAt: string;
  /** Restrições de subconta. [] = acesso global (todas as subcontas). */
  clientIds: string[];
}

export const agency = {
  settings: () => req<{nome:string;slug:string;settings:import('@/components/app/AccountPreferencesForm').AccountPreferences;role:string;email:import('@/components/app/EmailDeliveryStatus').EmailStatus}>('agency/settings'),
  updateSettings: (nome:string,settings:import('@/components/app/AccountPreferencesForm').AccountPreferences) => req('agency/settings',{method:'PATCH',body:JSON.stringify({nome,settings})}),
  invites: () => req<{id:string;email:string;role:string;expiresAt:string;acceptedAt:string|null;revokedAt:string|null}[]>('agency/invites'),
  invite: (email:string,role:string,clientIds:string[]) => req<{acceptUrl:string;emailSent:boolean;erro?:string}>('agency/invites',{method:'POST',body:JSON.stringify({email,role,clientIds})}),
  revokeInvite: (id:string) => req(`agency/invites/${id}`,{method:'DELETE'}),
  /** `null` se a identidade não pertence a nenhuma agência — caminho normal pra cliente direto (seção 28). */
  meuContexto: () => req<MeuContextoAgencia | null>('agency'),
  listarClientes: () => req<ClienteAgencia[]>('agency/clients'),
  overview: () => req<AgenciaOverview>('agency/overview'),
  listarMembros: () => req<MembroAgencia[]>('agency/members'),
  /** Edita papel e/ou visibilidade de subcontas do membro (estilo GHL). */
  atualizarMembro: (id: string, input: { role?: 'admin' | 'member' | 'viewer'; clientIds?: string[] }) =>
    req<{ ok: true }>(`agency/members/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removerMembro: (id: string) => req<{ ok: true }>(`agency/members/${id}`, { method: 'DELETE' }),
  detalheCliente: (id: string) => req<DetalheClienteAgencia>(`agency/clients/${id}`),
  criarCliente: (input: { nome: string; nicho?: string }) =>
    req<{ id: string; tenantId: string }>('agency/clients', { method: 'POST', body: JSON.stringify(input) }),
  /** Rota dedicada (não o proxy genérico) — troca os cookies de sessão pro tenant do cliente. */
  ativarCliente: async (id: string): Promise<{ user: { tenantId: string; nome: string } }> => {
    const r = await fetch(`/api/agency/clients/${id}/activate`, { method: 'POST' });
    if (!r.ok) throw new Error('não foi possível entrar na operação deste cliente');
    return r.json();
  },
};
