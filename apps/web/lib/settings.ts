'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/');

export interface Profile { id: string; nome: string; email: string; role: string; idioma: string; prefs: Record<string, unknown> }
export interface Business { nome: string; endereco: string | null; telefone: string | null; website: string | null; idioma: string; nicho: string | null; plano: string; status: string; settings: import('@/components/app/AccountPreferencesForm').AccountPreferences }
export interface Member { identityId: string; role: string; isDefault: boolean; email: string; nome: string | null; idioma: string | null; /** ADR-0045: null = vê tudo que o papel permite. */ modulos: string[] | null }
/** Resultado de criar/reenviar convite (ADR-0042). */
export interface ConviteEntregue {
  ok: boolean; inviteId: string; email: string; acceptUrl: string;
  emailSent: boolean; missing?: string[]; erro?: string;
  whatsappTexto: string; whatsappUrl: string; linkPublico: boolean;
}
export interface Invite { id: string; email: string; role: string; modulos: string[] | null; expiresAt: string; createdAt: string }
export interface AuditRow { id: string; actorType: string; actorId: string | null; acao: string; entidade: string | null; entidadeId: string | null; ts: string }

export interface NotificationItem { id: string; tipo: 'mensagem' | 'integracao' | 'mencao' | 'disparo_aprovacao' | 'avaliacao_negativa' | 'nico'; titulo: string; detalhe: string; url: string; ts: string; novo: boolean }
export interface Tag { id: string; name: string; color: string; descricao: string; usos: number; createdAt: string }
export interface ApiKey { id: string; name: string; keyPrefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
/** A chave em claro (`key`) só existe na resposta da criação. */
export interface ApiKeyCreated extends ApiKey { key: string }

export const settingsApi = {
  emailStatus: () => req<import('@/components/app/EmailDeliveryStatus').EmailStatus>('settings/email-status'),
  notifications: () => req<{ items: NotificationItem[]; naoLidas: number }>('settings/notifications'),
  markNotificationsRead: () => req<{ ok: boolean }>('settings/notifications/read', { method: 'POST' }),
  /** Marca UMA como lida (Q2.6). `id` no formato `men:`/`conv:`/`int:` + uuid. */
  markNotificationRead: (id: string) => req<{ ok: boolean }>(`settings/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  profile: () => req<Profile>('settings/profile'),
  updateProfile: (d: Partial<{ nome: string; idioma: string; prefs: Record<string, unknown> }>) => req<{ ok: boolean }>('settings/profile', { method: 'PATCH', body: JSON.stringify(d) }),
  business: () => req<Business>('settings/business'),
  updateBusiness: (d: Partial<Business>) => req<{ ok: boolean }>('settings/business', { method: 'PATCH', body: JSON.stringify(d) }),
  members: () => req<{ members: Member[]; invites: Invite[] }>('settings/members'),
  invite: (email: string, role: string, extra: { nome?: string; mensagem?: string; telefone?: string; modulos?: string[] } = {}) =>
    req<ConviteEntregue>('settings/invites', { method: 'POST', body: JSON.stringify({ email, role, ...extra }) }),
  resendInvite: (id: string, extra: { nome?: string; mensagem?: string; telefone?: string } = {}) =>
    req<ConviteEntregue>(`settings/invites/${id}/resend`, { method: 'POST', body: JSON.stringify(extra) }),
  revokeInvite: (id: string) => req<{ ok: boolean }>(`settings/invites/${id}`, { method: 'DELETE' }),
  changeRole: (identityId: string, role: string) => req<{ ok: boolean }>(`settings/members/${identityId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  changeModulos: (identityId: string, modulos: string[] | null) => req<{ ok: boolean; modulos: string[] | null }>(`settings/members/${identityId}/modulos`, { method: 'PATCH', body: JSON.stringify({ modulos }) }),
  removeMember: (identityId: string) => req<{ ok: boolean; sessoesRevogadas: number; conversasLiberadas: number }>(`settings/members/${identityId}`, { method: 'DELETE' }),
  revokeAllSessions: () => req<{ ok: boolean; sessoesRevogadas: number }>('settings/sessions/revoke-all', { method: 'POST' }),
  audit: () => req<AuditRow[]>('settings/audit'),
  integrations: () => req<{ id: string; provider: string; status: string; health: string; lastSyncAt: string | null }[]>('integrations'),

  // Tags do CRM
  tags: () => req<Tag[]>('settings/tags'),
  createTag: (d: { name: string; color?: string; descricao?: string }) => req<Tag>('settings/tags', { method: 'POST', body: JSON.stringify(d) }),
  updateTag: (id: string, d: Partial<{ name: string; color: string; descricao: string }>) => req<Tag>(`settings/tags/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteTag: (id: string) => req<{ ok: boolean }>(`settings/tags/${id}`, { method: 'DELETE' }),

  // Private Integrations (API keys) — a chave em claro só volta na criação
  apiKeys: () => req<ApiKey[]>('settings/api-keys'),
  createApiKey: (name: string, scopes: string[]) => req<ApiKeyCreated>('settings/api-keys', { method: 'POST', body: JSON.stringify({ name, scopes }) }),
  revokeApiKey: (id: string) => req<{ ok: boolean }>(`settings/api-keys/${id}`, { method: 'DELETE' }),
};
