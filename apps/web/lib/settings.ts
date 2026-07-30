'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface Profile { id: string; nome: string; email: string; role: string; idioma: string; prefs: Record<string, unknown> }
export interface Business { nome: string; endereco: string | null; telefone: string | null; website: string | null; idioma: string; nicho: string | null; plano: string; status: string }
export interface Member { identityId: string; role: string; isDefault: boolean; email: string; nome: string | null; idioma: string | null }
export interface Invite { id: string; email: string; role: string; expiresAt: string; createdAt: string }
export interface AuditRow { id: string; actorType: string; actorId: string | null; acao: string; entidade: string | null; entidadeId: string | null; ts: string }

export interface NotificationItem { id: string; tipo: 'mensagem' | 'integracao'; titulo: string; detalhe: string; url: string; ts: string; novo: boolean }
export interface Tag { id: string; name: string; color: string; descricao: string; usos: number; createdAt: string }
export interface ApiKey { id: string; name: string; keyPrefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
/** A chave em claro (`key`) só existe na resposta da criação. */
export interface ApiKeyCreated extends ApiKey { key: string }

export const settingsApi = {
  notifications: () => req<{ items: NotificationItem[]; naoLidas: number }>('settings/notifications'),
  markNotificationsRead: () => req<{ ok: boolean }>('settings/notifications/read', { method: 'POST' }),
  profile: () => req<Profile>('settings/profile'),
  updateProfile: (d: Partial<{ nome: string; idioma: string; prefs: Record<string, unknown> }>) => req<{ ok: boolean }>('settings/profile', { method: 'PATCH', body: JSON.stringify(d) }),
  business: () => req<Business>('settings/business'),
  updateBusiness: (d: Partial<Business>) => req<{ ok: boolean }>('settings/business', { method: 'PATCH', body: JSON.stringify(d) }),
  members: () => req<{ members: Member[]; invites: Invite[] }>('settings/members'),
  invite: (email: string, role: string) =>
    req<{ ok: boolean; acceptUrl: string; emailSent: boolean; missing?: string[]; erro?: string }>('settings/invites', { method: 'POST', body: JSON.stringify({ email, role }) }),
  revokeInvite: (id: string) => req<{ ok: boolean }>(`settings/invites/${id}`, { method: 'DELETE' }),
  changeRole: (identityId: string, role: string) => req<{ ok: boolean }>(`settings/members/${identityId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  audit: () => req<AuditRow[]>('settings/audit'),
  integrations: () => req<{ id: string; provider: string; status: string; health: string; lastSyncAt: string | null }[]>('integrations'),

  // Tags do CRM
  tags: () => req<Tag[]>('settings/tags'),
  createTag: (d: { name: string; color?: string; descricao?: string }) => req<Tag>('settings/tags', { method: 'POST', body: JSON.stringify(d) }),
  updateTag: (id: string, d: Partial<{ name: string; color: string; descricao: string }>) => req<Tag>(`settings/tags/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteTag: (id: string) => req<{ ok: boolean }>(`settings/tags/${id}`, { method: 'DELETE' }),

  // Private Integrations (API keys) — a chave em claro só volta na criação
  apiKeys: () => req<ApiKey[]>('settings/api-keys'),
  createApiKey: (name: string) => req<ApiKeyCreated>('settings/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeApiKey: (id: string) => req<{ ok: boolean }>(`settings/api-keys/${id}`, { method: 'DELETE' }),
};
