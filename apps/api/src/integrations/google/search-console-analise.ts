import { arr, num, obj, str } from './google-json';

/**
 * Análise do Search Console (funções puras, testadas).
 *
 * searchAnalytics.query (https://developers.google.com/webmaster-tools/v1/searchanalytics/query):
 * - startDate/endDate em YYYY-MM-DD no fuso do Pacífico (PT), inclusivos;
 * - sem `dataState`, o padrão é `final`: só dados consolidados;
 * - rows[]: keys[], clicks, impressions, ctr (0 a 1), position.
 *
 * Os dias mais recentes ainda não têm dado final; por isso a janela termina
 * em `hoje - ATRASO_DIAS` (PT). Comparar 28 dias com dias vazios no fim
 * daria uma queda falsa contra o período anterior.
 */
export const ATRASO_DIAS = 3;
export const JANELA_DIAS = 28;

export interface Periodo { inicio: string; fim: string }

function dataPt(agora: Date): Date {
  // Data civil em America/Los_Angeles, como a API interpreta as datas.
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  return new Date(`${partes}T00:00:00Z`);
}

function menosDias(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function periodos(agora: Date = new Date()): { atual: Periodo; anterior: Periodo } {
  const fim = menosDias(dataPt(agora), ATRASO_DIAS);
  const inicio = menosDias(fim, JANELA_DIAS - 1);
  const fimAnt = menosDias(inicio, 1);
  const inicioAnt = menosDias(fimAnt, JANELA_DIAS - 1);
  return { atual: { inicio: iso(inicio), fim: iso(fim) }, anterior: { inicio: iso(inicioAnt), fim: iso(fimAnt) } };
}

export interface Metricas { cliques: number; impressoes: number; ctr: number; posicao: number }
export interface Linha extends Metricas { chave: string }

export function parseLinhas(resposta: unknown): Linha[] {
  return arr(obj(resposta).rows).map((v) => {
    const r = obj(v);
    const keys = arr(r.keys);
    return { chave: str(keys[0]) ?? '', cliques: num(r.clicks), impressoes: num(r.impressions), ctr: num(r.ctr), posicao: num(r.position) };
  });
}

/** Total do período: consulta sem `dimensions` devolve uma única linha (ou nenhuma, sem dados). */
export function totais(resposta: unknown): Metricas {
  const l = parseLinhas(resposta)[0];
  return l ? { cliques: l.cliques, impressoes: l.impressoes, ctr: l.ctr, posicao: l.posicao } : { cliques: 0, impressoes: 0, ctr: 0, posicao: 0 };
}

/** Variação percentual; `null` quando o período anterior é zero (sem base). */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

export interface Comparativo {
  atual: Metricas;
  anterior: Metricas;
  variacao: { cliques: number | null; impressoes: number | null; ctr: number | null; posicao: number | null };
}

export function comparar(atual: Metricas, anterior: Metricas): Comparativo {
  return {
    atual,
    anterior,
    variacao: {
      cliques: variacao(atual.cliques, anterior.cliques),
      impressoes: variacao(atual.impressoes, anterior.impressoes),
      ctr: variacao(atual.ctr, anterior.ctr),
      // Posição: número menor é melhor; a UI interpreta o sinal.
      posicao: variacao(atual.posicao, anterior.posicao),
    },
  };
}

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface Oportunidade extends Linha {
  /** Cliques a mais se a consulta atingisse o CTR médio (ponderado) do próprio site. */
  cliquesPotenciais: number;
}

export interface CriteriosOportunidade { posicaoMin: number; posicaoMax: number; impressoesMin: number; ctrReferencia: number }

/**
 * Oportunidades: consultas com muitas impressões, CTR baixo e posição de 4
 * a 15 (página 1 baixa ou começo da página 2). "Muitas" = acima da mediana
 * de impressões das consultas; "baixo" = abaixo do CTR ponderado do site.
 * Tudo relativo ao próprio site, sem benchmark inventado.
 */
export function oportunidades(consultas: Linha[], limite = 20): { itens: Oportunidade[]; criterios: CriteriosOportunidade } {
  const comImpressao = consultas.filter((c) => c.impressoes > 0);
  const impressoesMin = Math.max(10, mediana(comImpressao.map((c) => c.impressoes)));
  const relevantes = comImpressao.filter((c) => c.impressoes >= impressoesMin);
  // CTR de referência = CTR ponderado do próprio site (cliques / impressões de
  // todas as consultas). A mediana das consultas seria puxada para baixo pelas
  // próprias consultas fracas que queremos achar.
  const totalImpressoes = comImpressao.reduce((s, c) => s + c.impressoes, 0);
  const ctrReferencia = totalImpressoes ? comImpressao.reduce((s, c) => s + c.cliques, 0) / totalImpressoes : 0;
  const itens = relevantes
    .filter((c) => c.posicao >= 4 && c.posicao <= 15 && c.ctr < ctrReferencia)
    .map((c) => ({ ...c, cliquesPotenciais: Math.round(c.impressoes * (ctrReferencia - c.ctr)) }))
    .sort((a, b) => b.cliquesPotenciais - a.cliquesPotenciais || b.impressoes - a.impressoes)
    .slice(0, limite);
  return { itens, criterios: { posicaoMin: 4, posicaoMax: 15, impressoesMin, ctrReferencia } };
}

export interface ResultadoInspecao {
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

/**
 * urlInspection.index.inspect → inspectionResult (UrlInspectionResult):
 * https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult
 */
export function parseInspecao(resposta: unknown): ResultadoInspecao {
  const r = obj(obj(resposta).inspectionResult);
  const ix = obj(r.indexStatusResult);
  const rich = obj(r.richResultsResult);
  const strs = (v: unknown) => arr(v).filter((x): x is string => typeof x === 'string');
  return {
    link: str(r.inspectionResultLink),
    veredito: str(ix.verdict),
    cobertura: str(ix.coverageState),
    robots: str(ix.robotsTxtState),
    indexacao: str(ix.indexingState),
    ultimoRastreio: str(ix.lastCrawlTime),
    busca: str(ix.pageFetchState),
    canonicoGoogle: str(ix.googleCanonical),
    canonicoUsuario: str(ix.userCanonical),
    rastreadoComo: str(ix.crawledAs),
    sitemaps: strs(ix.sitemap),
    referencias: strs(ix.referringUrls),
    resultadosAvancados: Object.keys(rich).length
      ? {
          veredito: str(rich.verdict),
          tipos: arr(rich.detectedItems).map((d) => {
            const det = obj(d);
            return {
              tipo: str(det.richResultType) ?? '',
              problemas: arr(det.items).flatMap((it) =>
                arr(obj(it).issues).map((i) => ({ mensagem: str(obj(i).issueMessage) ?? '', severidade: str(obj(i).severity) })),
              ),
            };
          }),
        }
      : null,
  };
}
