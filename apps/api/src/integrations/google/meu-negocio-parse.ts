import { arr, bool, num, obj, str } from './google-json';

/**
 * Parsers do Perfil da Empresa (funções puras, testadas). Campos conforme:
 * - Account (Account Management v1): https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts
 * - Location (Business Information v1): https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations
 * - Review (v4): https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews
 * - Performance v1: https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
 *   (multiDailyMetricTimeSeries[].dailyMetricTimeSeries[]: dailyMetric + timeSeries.datedValues[]: date, value string omitido quando zero)
 */

export interface ContaGbp { name: string; nome: string; tipo: string | null; papel: string | null; verificacao: string | null }

export function parseConta(v: unknown): ContaGbp {
  const a = obj(v);
  return { name: str(a.name) ?? '', nome: str(a.accountName) ?? '(sem nome)', tipo: str(a.type), papel: str(a.role), verificacao: str(a.verificationState) };
}

/** readMask pedido no locations.list (só campos documentados do recurso Location). */
export const READ_MASK_LOCAL = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,openInfo,metadata,profile';

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

function hora(v: unknown): string | null {
  const t = obj(v);
  if (!Object.keys(t).length) return null;
  // TimeOfDay (google.type): hours/minutes; ausente = 0.
  const h = num(t.hours);
  const m = num(t.minutes);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseLocal(v: unknown): LocalGbp {
  const l = obj(v);
  const fones = obj(l.phoneNumbers);
  const cats = obj(l.categories);
  const end = obj(l.storefrontAddress);
  const meta = obj(l.metadata);
  const enderecoPartes = [
    ...arr(end.addressLines).filter((x): x is string => typeof x === 'string'),
    str(end.sublocality),
    str(end.locality),
    str(end.administrativeArea),
    str(end.postalCode),
  ].filter((x): x is string => !!x);
  return {
    name: str(l.name) ?? '',
    titulo: str(l.title) ?? '(sem nome)',
    telefone: str(fones.primaryPhone),
    categoria: str(obj(cats.primaryCategory).displayName),
    categoriasExtras: arr(cats.additionalCategories).map((c) => str(obj(c).displayName)).filter((x): x is string => !!x),
    endereco: enderecoPartes.length ? enderecoPartes.join(', ') : null,
    site: str(l.websiteUri),
    situacao: str(obj(l.openInfo).status),
    descricao: str(obj(l.profile).description),
    mapsUri: str(meta.mapsUri),
    novaAvaliacaoUri: str(meta.newReviewUri),
    placeId: str(meta.placeId),
    temVozDoComerciante: bool(meta.hasVoiceOfMerchant),
    edicoesPendentes: bool(meta.hasPendingEdits),
    horarios: arr(obj(l.regularHours).periods).map((p) => {
      const x = obj(p);
      return { diaAbre: str(x.openDay), abre: hora(x.openTime), diaFecha: str(x.closeDay), fecha: hora(x.closeTime) };
    }),
  };
}

const ESTRELAS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

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

export function parseAvaliacao(v: unknown): AvaliacaoGbp {
  const r = obj(v);
  const autor = obj(r.reviewer);
  const resp = obj(r.reviewReply);
  const comentarioResp = str(resp.comment);
  return {
    name: str(r.name) ?? '',
    autor: str(autor.displayName) ?? 'Anônimo',
    foto: str(autor.profilePhotoUrl),
    anonimo: bool(autor.isAnonymous),
    estrelas: ESTRELAS[str(r.starRating) ?? ''] ?? null,
    comentario: str(r.comment),
    criadaEm: str(r.createTime),
    atualizadaEm: str(r.updateTime),
    resposta: comentarioResp ? { comentario: comentarioResp, atualizadaEm: str(resp.updateTime), estado: str(resp.reviewReplyState) } : null,
  };
}

export function parseListaAvaliacoes(v: unknown): { avaliacoes: AvaliacaoGbp[]; media: number | null; total: number; proximaPagina: string | null } {
  const j = obj(v);
  return {
    avaliacoes: arr(j.reviews).map(parseAvaliacao),
    media: typeof j.averageRating === 'number' ? j.averageRating : null,
    total: num(j.totalReviewCount),
    proximaPagina: str(j.nextPageToken),
  };
}

/** Métricas pedidas ao Performance API (enum DailyMetric). */
export const METRICAS_DIARIAS = [
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const;

export interface DesempenhoGbp {
  ligacoes: number;
  cliquesSite: number;
  rotas: number;
  impressoes: { total: number; buscaMovel: number; buscaDesktop: number; mapasMovel: number; mapasDesktop: number };
  porDia: { data: string; ligacoes: number; cliquesSite: number; rotas: number; impressoes: number }[];
}

function dataDe(v: unknown): string | null {
  const d = obj(v);
  const y = num(d.year);
  const m = num(d.month);
  const dia = num(d.day);
  if (!y || !m || !dia) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function somarDesempenho(v: unknown): DesempenhoGbp {
  const somas: Record<string, number> = {};
  const dias = new Map<string, { ligacoes: number; cliquesSite: number; rotas: number; impressoes: number }>();
  for (const multi of arr(obj(v).multiDailyMetricTimeSeries)) {
    for (const serie of arr(obj(multi).dailyMetricTimeSeries)) {
      const s = obj(serie);
      const metrica = str(s.dailyMetric);
      if (!metrica) continue;
      for (const dv of arr(obj(s.timeSeries).datedValues)) {
        const x = obj(dv);
        const valor = num(x.value); // omitido quando zero
        somas[metrica] = (somas[metrica] ?? 0) + valor;
        const data = dataDe(x.date);
        if (!data) continue;
        const dia = dias.get(data) ?? { ligacoes: 0, cliquesSite: 0, rotas: 0, impressoes: 0 };
        if (metrica === 'CALL_CLICKS') dia.ligacoes += valor;
        else if (metrica === 'WEBSITE_CLICKS') dia.cliquesSite += valor;
        else if (metrica === 'BUSINESS_DIRECTION_REQUESTS') dia.rotas += valor;
        else if (metrica.startsWith('BUSINESS_IMPRESSIONS_')) dia.impressoes += valor;
        dias.set(data, dia);
      }
    }
  }
  const g = (k: string) => somas[k] ?? 0;
  const imp = {
    buscaMovel: g('BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
    buscaDesktop: g('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'),
    mapasMovel: g('BUSINESS_IMPRESSIONS_MOBILE_MAPS'),
    mapasDesktop: g('BUSINESS_IMPRESSIONS_DESKTOP_MAPS'),
  };
  return {
    ligacoes: g('CALL_CLICKS'),
    cliquesSite: g('WEBSITE_CLICKS'),
    rotas: g('BUSINESS_DIRECTION_REQUESTS'),
    impressoes: { total: imp.buscaMovel + imp.buscaDesktop + imp.mapasMovel + imp.mapasDesktop, ...imp },
    porDia: [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, d]) => ({ data, ...d })),
  };
}

export const RE_CONTA_GBP = /^accounts\/\d+$/;
export const RE_LOCAL_GBP = /^locations\/\d+$/;
export const RE_AVALIACAO_GBP = /^accounts\/\d+\/locations\/\d+\/reviews\/[A-Za-z0-9_-]+$/;
