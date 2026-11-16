'use client';

import { clienteApi } from './session-fetch';
import type { SecaoStatus } from './redes';

/** Público e descoberta do Instagram (`GET /v1/redes/instagram/publico`). */
const req = clienteApi('/api/v1/redes/instagram/');

export interface FatiaRotulada {
  chave: string;
  rotulo: string;
  valor: number;
}

export interface PublicoInstagram {
  conectado: boolean;
  conexaoId: string | null;
  periodoDias: number;
  publico: { idade: FatiaRotulada[]; genero: FatiaRotulada[]; cidades: FatiaRotulada[]; paises: FatiaRotulada[]; status: SecaoStatus };
  seguidores: { ganhos: number | null; perdidos: number | null; status: SecaoStatus };
  cliquesPerfil: { total: number | null; botoes: FatiaRotulada[]; status: SecaoStatus };
  alcancePorFormato: { fatias: FatiaRotulada[]; status: SecaoStatus };
  alcancePorRelacao: { fatias: FatiaRotulada[]; status: SecaoStatus };
}

export const instagramApi = {
  publico: (conexaoId?: string, dias = 28) => {
    const q = new URLSearchParams({ dias: String(dias) });
    if (conexaoId) q.set('conexaoId', conexaoId);
    return req<PublicoInstagram>(`publico?${q}`);
  },
};

/** "BR" → "Brasil" (nome do país no idioma da tela). */
export function nomePais(codigo: string): string {
  try {
    return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/** "Araçatuba, São Paulo (state)" → "Araçatuba, São Paulo". */
export const nomeCidade = (c: string) => c.replace(/\s*\((state|estado)\)\s*$/i, '');
