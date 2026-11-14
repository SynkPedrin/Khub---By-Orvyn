'use client';

import { clienteApi } from './session-fetch';
import { ApiError } from './api-error';

/**
 * Presença Google da subconta: `/api/v1/google/*` → `/v1/google/*`.
 * Tag Manager, Search Console e Perfil da Empresa (Google Meu Negócio).
 */
const req = clienteApi('/api/v1/google/');

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const t = s.toString();
  return t ? `?${t}` : '';
};

export interface CapacidadesGoogle {
  tagManager: boolean;
  tagManagerEscrita: boolean;
  tagManagerPublicar: boolean;
  searchConsole: boolean;
  meuNegocio: boolean;
}

export interface StatusGoogle {
  configurado: boolean;
  missing: string[];
  conectado: boolean;
  status: string | null;
  erro: string | null;
  conectadoEm: string | null;
  escopos: string[];
  capacidades: CapacidadesGoogle;
}

// ---- Tag Manager ----
export interface ContaGtm { path: string; accountId: string; nome: string; url: string | null }
export interface ContainerGtm { path: string; containerId: string; nome: string; publicId: string | null; contextos: string[]; dominios: string[]; url: string | null }
export interface WorkspaceGtm { path: string; workspaceId: string; nome: string; descricao: string | null; url: string | null }
export interface TagGtm { path: string; tagId: string; nome: string; tipo: string; pausada: boolean; acionadores: string[]; url: string | null }
export interface AcionadorGtm { path: string; triggerId: string; nome: string; tipo: string }
export interface AlteracaoGtm { status: string; entidade: string; nome: string }
export interface ProblemaGtm { codigo: string; severidade: 'alta' | 'media' | 'baixa'; titulo: string; detalhe: string }
export interface DetalheWorkspace {
  tags: TagGtm[];
  acionadores: AcionadorGtm[];
  alteracoes: AlteracaoGtm[];
  conflitos: number;
  publicado: boolean | null;
  diagnostico: {
    resumo: { totalTags: number; ativas: number; pausadas: number; ga4: boolean; pixelMeta: boolean; conversao: boolean; alteracoesPendentes: number };
    problemas: ProblemaGtm[];
  };
}

// ---- Search Console ----
export interface SiteSc { siteUrl: string; permissao: string; verificado: boolean }
export interface MetricasSc { cliques: number; impressoes: number; ctr: number; posicao: number }
export interface LinhaSc extends MetricasSc { chave: string }
export interface OportunidadeSc extends LinhaSc { cliquesPotenciais: number }
export interface AnaliseSc {
  site: string;
  periodo: { atual: { inicio: string; fim: string }; anterior: { inicio: string; fim: string } };
  comparativo: { atual: MetricasSc; anterior: MetricasSc; variacao: { cliques: number | null; impressoes: number | null; ctr: number | null; posicao: number | null } };
  topConsultas: LinhaSc[];
  topPaginas: LinhaSc[];
  oportunidades: OportunidadeSc[];
  criterios: { posicaoMin: number; posicaoMax: number; impressoesMin: number; ctrReferencia: number };
}
export interface InspecaoSc {
  link: string | null;
  veredito: string | null;
  cobertura: string | null;
  robots: string | null;
  indexacao: string | null;
  ultimoRastreio: string | null;
  busca: string | null;
  canonicoGoogle: string | null;
  canonicoUsuario: string | null;
  rastreadoComo: string | null;
  sitemaps: string[];
  referencias: string[];
  resultadosAvancados: { veredito: string | null; tipos: { tipo: string; problemas: { mensagem: string; severidade: string | null }[] }[] } | null;
}

// ---- Perfil da Empresa ----
export interface ContaGbp { name: string; nome: string; tipo: string | null; papel: string | null; verificacao: string | null }
export interface LocalGbp {
  name: string;
  titulo: string;
  telefone: string | null;
  categoria: string | null;
  categoriasExtras: string[];
  endereco: string | null;
  site: string | null;
  situacao: string | null;
  descricao: string | null;
  mapsUri: string | null;
  novaAvaliacaoUri: string | null;
  placeId: string | null;
  temVozDoComerciante: boolean;
  edicoesPendentes: boolean;
  horarios: { abre: string | null; diaAbre: string | null; fecha: string | null; diaFecha: string | null }[];
}
export interface AvaliacaoGbp {
  name: string;
  autor: string;
  foto: string | null;
  anonimo: boolean;
  estrelas: number | null;
  comentario: string | null;
  criadaEm: string | null;
  atualizadaEm: string | null;
  resposta: { comentario: string; atualizadaEm: string | null; estado: string | null } | null;
}
export interface DesempenhoGbp {
  inicio: string;
  fim: string;
  ligacoes: number;
  cliquesSite: number;
  rotas: number;
  impressoes: { total: number; buscaMovel: number; buscaDesktop: number; mapasMovel: number; mapasDesktop: number };
  porDia: { data: string; ligacoes: number; cliquesSite: number; rotas: number; impressoes: number }[];
}

const post = <T>(caminho: string, corpo: unknown) => req<T>(caminho, { method: 'POST', body: JSON.stringify(corpo) });

export const googleApi = {
  status: () => req<StatusGoogle>('status'),
  urlConexao: (capacidade: 'leitura' | 'gtm_escrita' = 'leitura') => req<{ url: string }>(`auth-url${q({ capacidade })}`),
  desconectar: () => req<{ ok: true }>('conexao', { method: 'DELETE' }),

  gtm: {
    contas: () => req<ContaGtm[]>('tag-manager/contas'),
    containers: (conta: string) => req<ContainerGtm[]>(`tag-manager/containers${q({ conta })}`),
    workspaces: (container: string) => req<WorkspaceGtm[]>(`tag-manager/workspaces${q({ container })}`),
    workspace: (workspace: string) => req<DetalheWorkspace>(`tag-manager/workspace${q({ workspace })}`),
    snippet: (container: string) => req<{ snippet: string | null; containerConfig: string | null }>(`tag-manager/snippet${q({ container })}`),
    criarGoogleTag: (d: { workspace: string; idMedicao: string; nome?: string; acionadorId?: string }) =>
      post<{ tag: TagGtm; acionadorCriado: AcionadorGtm | null }>('tag-manager/tags', { ...d, confirmar: true }),
    publicar: (d: { workspace: string; nome?: string; notas?: string }) =>
      post<{ versaoId: string | null; versaoPath: string; novoWorkspace: string | null }>('tag-manager/publicar', { ...d, confirmar: true }),
  },

  sc: {
    sites: () => req<SiteSc[]>('search-console/sites'),
    analise: (site: string) => req<AnaliseSc>(`search-console/analise${q({ site })}`),
    inspecionar: (site: string, url: string) => req<InspecaoSc>(`search-console/inspecao${q({ site, url })}`),
  },

  gbp: {
    contas: () => req<ContaGbp[]>('meu-negocio/contas'),
    locais: (conta: string) => req<LocalGbp[]>(`meu-negocio/locais${q({ conta })}`),
    avaliacoes: (conta: string, local: string, pagina?: string) =>
      req<{ avaliacoes: AvaliacaoGbp[]; media: number | null; total: number; proximaPagina: string | null }>(`meu-negocio/avaliacoes${q({ conta, local, pagina })}`),
    responder: (avaliacao: string, comentario: string) =>
      post<{ comentario: string; atualizadaEm: string | null; estado: string | null }>('meu-negocio/avaliacoes/responder', { avaliacao, comentario, confirmar: true }),
    desempenho: (local: string) => req<DesempenhoGbp>(`meu-negocio/desempenho${q({ local })}`),
  },
};

/** Código estável do erro (`code` no corpo RFC 7807) para a tela decidir o que mostrar. */
export function codigoErroGoogle(e: unknown): string | null {
  return e instanceof ApiError && typeof e.body?.code === 'string' ? e.body.code : null;
}

/** Mensagem legível: o servidor já traduziu o erro do Google em `title`. */
export function mensagemErroGoogle(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && !e.body?.code) return 'Seu papel nesta conta não tem acesso à Presença Google. Peça a um gestor ou administrador.';
    const t = e.body?.title;
    if (typeof t === 'string' && t) return t;
  }
  return padrao;
}
