/**
 * Escopos OAuth da Presença Google (Tag Manager, Search Console, Perfil da Empresa).
 *
 * Fontes (verificadas em 2026-11):
 * - Tag Manager API v2: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2
 *   (leitura aceita `tagmanager.readonly`; criar tag/acionador exige `tagmanager.edit.containers`;
 *   `create_version` exige `tagmanager.edit.containerversions`; `versions.publish` exige `tagmanager.publish`)
 * - Search Console API: https://developers.google.com/webmaster-tools/v1/api_reference_index
 *   (sites.list, searchAnalytics.query e urlInspection.index.inspect aceitam `webmasters.readonly`)
 * - Business Profile APIs: https://developers.google.com/my-business/content/basic-setup
 *   (escopo único `business.manage`; não existe escopo só de leitura)
 *
 * Dois pacotes, no mesmo espírito das capabilities da Meta: a conexão padrão
 * pede só leitura; a escrita no Tag Manager é pedida à parte (autorização
 * incremental, `include_granted_scopes=true`) quando um admin quer criar tag
 * ou publicar. Assim quem só quer olhar nunca concede poder de publicar.
 */
export const PROVIDER_GOOGLE_PRESENCA = 'google_presenca';

export const ESCOPO = {
  gtmLeitura: 'https://www.googleapis.com/auth/tagmanager.readonly',
  gtmEditar: 'https://www.googleapis.com/auth/tagmanager.edit.containers',
  gtmVersoes: 'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  gtmPublicar: 'https://www.googleapis.com/auth/tagmanager.publish',
  searchConsoleLeitura: 'https://www.googleapis.com/auth/webmasters.readonly',
  perfilEmpresa: 'https://www.googleapis.com/auth/business.manage',
} as const;

export type CapacidadeGoogle = 'leitura' | 'gtm_escrita';

export const ESCOPOS_POR_CAPACIDADE: Record<CapacidadeGoogle, string[]> = {
  leitura: [ESCOPO.gtmLeitura, ESCOPO.searchConsoleLeitura, ESCOPO.perfilEmpresa],
  gtm_escrita: [ESCOPO.gtmEditar, ESCOPO.gtmVersoes, ESCOPO.gtmPublicar],
};

export function capacidadeValida(v: unknown): v is CapacidadeGoogle {
  return v === 'leitura' || v === 'gtm_escrita';
}

/** O que cada produto consegue fazer com os escopos concedidos de verdade. */
export interface CapacidadesConcedidas {
  tagManager: boolean;
  tagManagerEscrita: boolean;
  tagManagerPublicar: boolean;
  searchConsole: boolean;
  meuNegocio: boolean;
}

export function capacidadesDe(escopos: readonly string[]): CapacidadesConcedidas {
  const tem = (s: string) => escopos.includes(s);
  // `webmasters` (sem .readonly) também lê, segundo a mesma doc.
  const searchConsole = tem(ESCOPO.searchConsoleLeitura) || tem('https://www.googleapis.com/auth/webmasters');
  return {
    tagManager: tem(ESCOPO.gtmLeitura) || tem(ESCOPO.gtmEditar),
    tagManagerEscrita: tem(ESCOPO.gtmEditar),
    tagManagerPublicar: tem(ESCOPO.gtmVersoes) && tem(ESCOPO.gtmPublicar),
    searchConsole,
    meuNegocio: tem(ESCOPO.perfilEmpresa),
  };
}
