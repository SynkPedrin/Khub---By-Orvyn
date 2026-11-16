'use client';

import { clienteApi } from './session-fetch';

/**
 * Redes sociais da subconta (db/068): `/api/v1/redes/*` → `/v1/redes/*` e a
 * conexão das contas em `/v1/integrations/redes/*`. As contas são as mesmas
 * de Conversas (`channel_connections`).
 */
const req = clienteApi('/api/v1/');

export type RedeSocial = 'instagram' | 'tiktok' | 'youtube';
export const REDES: { rede: RedeSocial; nome: string }[] = [
  { rede: 'instagram', nome: 'Instagram' },
  { rede: 'tiktok', nome: 'TikTok' },
  { rede: 'youtube', nome: 'YouTube' },
];

export interface SecaoStatus {
  status: 'ok' | 'sem_permissao' | 'token' | 'limite' | 'config' | 'sem_dados' | 'erro';
  mensagem?: string;
  faltando?: string[];
  doc?: string;
}

export interface MetricasPost {
  visualizacoes: number | null;
  alcance: number | null;
  curtidas: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
  salvamentos: number | null;
  engajamento: number | null;
}

export interface PostRede {
  id: string;
  tipo: string;
  legenda: string;
  miniatura: string | null;
  link: string | null;
  publicadoEm: string | null;
  duracaoSeg: number | null;
  metricas: MetricasPost;
}

export interface Kpi {
  chave: string;
  rotulo: string;
  valor: number | null;
  variacao: number | null;
  formato: 'numero' | 'percentual' | 'minutos';
}

export interface PontoSerie {
  dia: string;
  valor: number;
}

export interface PainelRede {
  rede: RedeSocial;
  conectado: boolean;
  gate: { provider: string; missing: string[] } | null;
  contas: { id: string; nome: string; status: string; erro: string | null }[];
  conta: { conexaoId: string; nome: string; externalId: string; usuario: string | null; foto: string | null; seguidores: number | null; publicacoes: number | null } | null;
  periodoDias: number;
  kpis: Kpi[];
  kpisStatus: SecaoStatus;
  posts: PostRede[];
  postsStatus: SecaoStatus;
  metricasPostStatus: SecaoStatus;
  ranking: PostRede[];
  crescimento: { seguidores: PontoSerie[]; alcance: PontoSerie[]; fonteSeguidores: 'snapshots' | 'rede'; status: SecaoStatus };
  publicacao: { disponivel: boolean; formatos: string[]; motivo?: string; faltando?: string[]; doc: string };
  docs: string[];
}

export interface EstadoRede {
  rede: RedeSocial;
  conectado: boolean;
  gate: { provider: string; missing: string[] } | null;
  contas: { id: string; nome: string; status: string; erro: string | null }[];
}

export interface Publicacao {
  id: string;
  rede: RedeSocial;
  conexaoId: string;
  formato: 'imagem' | 'reels' | 'video';
  titulo: string | null;
  legenda: string;
  midiaUrl: string;
  privacidade: string | null;
  agendadoPara: string;
  status: 'agendado' | 'publicando' | 'processando' | 'publicado' | 'erro' | 'cancelado';
  postId: string | null;
  permalink: string | null;
  erro: string | null;
  publicadoEm: string | null;
  createdAt: string;
}

export interface NovaPublicacao {
  rede: RedeSocial;
  conexaoId: string;
  formato: 'imagem' | 'reels' | 'video';
  legenda: string;
  titulo?: string;
  midiaUrl: string;
  privacidade?: string;
  agendarPara?: string;
  confirmado: true;
  desativarComentarios?: boolean;
}

export interface CriadorTiktok {
  apelido: string | null;
  usuario: string | null;
  foto: string | null;
  privacidades: string[];
  comentariosDesativados: boolean;
  duracaoMaxSeg: number | null;
}

export const redesApi = {
  estado: () => req<EstadoRede[]>('redes/estado'),
  painel: (rede: RedeSocial, conexaoId?: string, dias = 28) => {
    const q = new URLSearchParams({ dias: String(dias), ...(conexaoId ? { conexaoId } : {}) });
    return req<PainelRede>(`redes/painel/${rede}?${q.toString()}`);
  },
  publicacoes: (rede?: RedeSocial) => req<Publicacao[]>(`redes/publicacoes${rede ? `?rede=${rede}` : ''}`),
  publicar: (dados: NovaPublicacao) => req<Publicacao>('redes/publicacoes', { method: 'POST', body: JSON.stringify(dados) }),
  cancelar: (id: string) => req<{ ok: boolean }>(`redes/publicacoes/${id}/cancelar`, { method: 'POST' }),
  criadorTiktok: (conexaoId: string) => req<CriadorTiktok>(`redes/tiktok/criador/${conexaoId}`),
  urlConexao: (rede: RedeSocial) => req<{ url: string }>(`integrations/redes/${rede}/auth-url`),
  desconectar: (id: string) => req<{ ok: boolean }>(`integrations/redes/conexoes/${id}`, { method: 'DELETE' }),
};

/** Rótulos da privacidade do TikTok (valores de DOC: privacy_level_options). */
export const PRIVACIDADE_TIKTOK: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores mútuos)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu',
};

export const VISIBILIDADE_YOUTUBE: Record<string, string> = { public: 'Público', unlisted: 'Não listado', private: 'Privado' };

/** Formata número curto em pt-BR (1,2 mil; 3,4 mi). */
export function numeroCurto(v: number | null | undefined): string {
  if (v == null) return 'sem dado';
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
