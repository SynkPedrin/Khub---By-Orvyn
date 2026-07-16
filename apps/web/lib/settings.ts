'use client';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new Error(`SETTINGS ${r.status}`);
  return r.json();
}

export interface Profile { id: string; nome: string; email: string; role: string; idioma: string; prefs: Record<string, unknown> }
export interface Business { nome: string; endereco: string | null; telefone: string | null; website: string | null; idioma: string; nicho: string | null; plano: string; status: string }
export interface Member { identityId: string; role: string; isDefault: boolean; email: string; nome: string | null; idioma: string | null }
export interface Invite { id: string; email: string; role: string; expiresAt: string; createdAt: string }
export interface AuditRow { id: string; actorType: string; actorId: string | null; acao: string; entidade: string | null; entidadeId: string | null; ts: string }

export const settingsApi = {
  profile: () => req<Profile>('settings/profile'),
  updateProfile: (d: Partial<{ nome: string; idioma: string; prefs: Record<string, unknown> }>) => req<{ ok: boolean }>('settings/profile', { method: 'PATCH', body: JSON.stringify(d) }),
  business: () => req<Business>('settings/business'),
  updateBusiness: (d: Partial<Business>) => req<{ ok: boolean }>('settings/business', { method: 'PATCH', body: JSON.stringify(d) }),
  members: () => req<{ members: Member[]; invites: Invite[] }>('settings/members'),
  invite: (email: string, role: string) => req<{ ok: boolean; acceptUrl: string; emailSent: boolean }>('settings/invites', { method: 'POST', body: JSON.stringify({ email, role }) }),
  revokeInvite: (id: string) => req<{ ok: boolean }>(`settings/invites/${id}`, { method: 'DELETE' }),
  changeRole: (identityId: string, role: string) => req<{ ok: boolean }>(`settings/members/${identityId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  audit: () => req<AuditRow[]>('settings/audit'),
  integrations: () => req<{ id: string; provider: string; status: string; health: string; lastSyncAt: string | null }[]>('integrations'),
};
