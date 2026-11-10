'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/marketplace/');

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
