'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/blueprints');

export interface Blueprint {
  id: string;
  nome: string;
  familia: string;
  tier: number;
  orgaoRegulador?: string | null;
  etapas: { nome: string; cor?: string }[];
  automacoes: string[];
  versao: number;
}
export interface Sugestao {
  nicho: string | null;
  sugerido: Blueprint | null;
  jaAplicado: string | null;
}

export const blueprints = {
  listar: () => req<Blueprint[]>(''),
  sugerido: () => req<Sugestao>('/sugerido'),
  aplicar: (key: string) => req<{ jaAplicado?: boolean; blueprint?: string; funilId?: string; automacoes?: unknown[] }>(`/${key}/aplicar`, { method: 'POST' }),
};
