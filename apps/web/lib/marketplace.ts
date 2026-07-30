'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/marketplace/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface TemplateResumo {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  tags: string[];
  isOfficial: boolean;
  isPremium: boolean;
  featured: boolean;
  installs: number;
  requirements: string[];
}

export interface TemplateVar {
  chave: string;
  label: string;
  tipo: 'texto' | 'tag' | 'etapa' | 'numero';
  obrigatorio?: boolean;
  default?: string;
}
export interface TemplateDetalhe extends TemplateResumo {
  variables: TemplateVar[];
}

export const marketplace = {
  listar: (q?: { categoria?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (q?.categoria) p.set('categoria', q.categoria);
    if (q?.q) p.set('q', q.q);
    const qs = p.toString();
    return req<TemplateResumo[]>(`templates${qs ? `?${qs}` : ''}`);
  },
  obter: (id: string) => req<TemplateDetalhe>(`templates/${id}`),
  categorias: () => req<{ categoria: string; total: number }[]>('categorias'),
  instalar: (id: string, valores?: Record<string, string>) =>
    req<{ workflowId: string; nome: string }>(`templates/${id}/instalar`, { method: 'POST', body: JSON.stringify({ valores: valores ?? {} }) }),
};
