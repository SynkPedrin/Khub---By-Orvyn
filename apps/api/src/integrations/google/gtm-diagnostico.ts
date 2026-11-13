import { arr, bool, obj, str, type Obj } from './google-json';

/**
 * Parsers e diagnóstico do Google Tag Manager (funções puras, testadas).
 *
 * Campos conforme a referência REST v2:
 * https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2
 * - Tag: path, tagId, name, type, parameter[], firingTriggerId[], paused, tagManagerUrl
 * - Parameter: type, key, value, list[], map[]
 * - Trigger: path, triggerId, name, type (EventType: pageview, click, formSubmission, ...)
 * - workspaces.getStatus: workspaceChange[] (Entity: changeStatus + tag|trigger|variable|folder|client)
 *
 * IDs de tipo de tag (tabela oficial em
 * https://developers.google.com/tag-platform/tag-manager/restrict):
 * gaawc = Google tag (antiga configuração do GA4), gaawe = evento GA4,
 * awct = conversão do Google Ads, gclidw = vinculador de conversões,
 * sp = remarketing do Google Ads, flc/fls = Floodlight, html = HTML personalizado.
 * `googtag` é o tipo usado pelo guia oficial da API para criar a Google tag
 * (https://developers.google.com/tag-platform/tag-manager/api/v2/devguide).
 */

export interface ParametroGtm {
  type: string | null;
  key: string | null;
  value: string | null;
  list: ParametroGtm[];
  map: ParametroGtm[];
}

export interface TagGtm {
  path: string;
  tagId: string;
  nome: string;
  tipo: string;
  pausada: boolean;
  acionadores: string[];
  parametros: ParametroGtm[];
  url: string | null;
}

export interface AcionadorGtm {
  path: string;
  triggerId: string;
  nome: string;
  tipo: string;
}

export interface AlteracaoGtm {
  status: string;
  entidade: 'tag' | 'trigger' | 'variable' | 'folder' | 'client' | 'outro';
  nome: string;
}

function parametro(v: unknown): ParametroGtm {
  const p = obj(v);
  return { type: str(p.type), key: str(p.key), value: typeof p.value === 'string' ? p.value : null, list: arr(p.list).map(parametro), map: arr(p.map).map(parametro) };
}

export function parseTag(v: unknown): TagGtm {
  const t = obj(v);
  return {
    path: str(t.path) ?? '',
    tagId: str(t.tagId) ?? '',
    nome: str(t.name) ?? '(sem nome)',
    tipo: str(t.type) ?? '',
    pausada: bool(t.paused),
    acionadores: arr(t.firingTriggerId).filter((x): x is string => typeof x === 'string'),
    parametros: arr(t.parameter).map(parametro),
    url: str(t.tagManagerUrl),
  };
}

export function parseAcionador(v: unknown): AcionadorGtm {
  const t = obj(v);
  return { path: str(t.path) ?? '', triggerId: str(t.triggerId) ?? '', nome: str(t.name) ?? '(sem nome)', tipo: str(t.type) ?? '' };
}

export function parseAlteracao(v: unknown): AlteracaoGtm {
  const e = obj(v);
  const status = str(e.changeStatus) ?? 'changeStatusUnspecified';
  for (const chave of ['tag', 'trigger', 'variable', 'folder', 'client'] as const) {
    const x: Obj = obj(e[chave]);
    if (Object.keys(x).length) return { status, entidade: chave, nome: str(x.name) ?? '(sem nome)' };
  }
  return { status, entidade: 'outro', nome: '(sem nome)' };
}

/** Todos os valores de texto de um parâmetro, inclusive dentro de list/map. */
export function valoresDe(params: ParametroGtm[]): string[] {
  const saida: string[] = [];
  const visitar = (p: ParametroGtm) => {
    if (p.value) saida.push(p.value);
    p.list.forEach(visitar);
    p.map.forEach(visitar);
  };
  params.forEach(visitar);
  return saida;
}

const GOOGLE_TAG = new Set(['googtag', 'gaawc']);
const CONVERSAO_GOOGLE = new Set(['awct', 'flc', 'fls']);
const ID_GA4 = /^G-[A-Z0-9]+$/i;
const VARIAVEL = /^\{\{.+\}\}$/;
const META_NO_CODIGO = /fbq\(|connect\.facebook\.net|fbevents\.js/i;
const META_NO_NOME = /(meta|facebook|fb)[\s_-]*(pixel|ads)|pixel[\s_-]*(do|da|de)?[\s_-]*(meta|facebook)/i;

export function ehGa4(t: TagGtm): boolean {
  if (t.tipo === 'gaawc') return true;
  if (t.tipo !== 'googtag') return false;
  // A Google tag também serve ao Google Ads (ID "AW-"); só conta como GA4
  // quando o ID é de medição ("G-") ou vem de variável (não dá para saber).
  const id = t.parametros.find((p) => p.key === 'tagId')?.value ?? '';
  return ID_GA4.test(id) || VARIAVEL.test(id);
}

export function ehPixelMeta(t: TagGtm): boolean {
  if (t.tipo === 'html') return valoresDe(t.parametros).some((v) => META_NO_CODIGO.test(v));
  // Modelos da galeria da comunidade chegam como "cvt_<id>": só o nome identifica.
  if (t.tipo.startsWith('cvt_')) return META_NO_NOME.test(t.nome);
  return false;
}

export function ehConversao(t: TagGtm): boolean {
  return CONVERSAO_GOOGLE.has(t.tipo);
}

export type Severidade = 'alta' | 'media' | 'baixa';

export interface ProblemaGtm {
  codigo: string;
  severidade: Severidade;
  titulo: string;
  detalhe: string;
}

export interface DiagnosticoGtm {
  resumo: { totalTags: number; ativas: number; pausadas: number; ga4: boolean; pixelMeta: boolean; conversao: boolean; alteracoesPendentes: number };
  problemas: ProblemaGtm[];
}

/**
 * `publicado`: true/false quando sabemos se o contêiner tem versão publicada
 * (versions:live), null quando não deu para verificar.
 */
export function diagnosticarGtm(entrada: { tags: TagGtm[]; alteracoes: AlteracaoGtm[]; publicado: boolean | null }): DiagnosticoGtm {
  const ativas = entrada.tags.filter((t) => !t.pausada);
  const pausadas = entrada.tags.filter((t) => t.pausada);
  const ga4 = ativas.some(ehGa4);
  const pixelMeta = ativas.some(ehPixelMeta);
  const conversao = ativas.some(ehConversao);
  const temAwct = ativas.some((t) => t.tipo === 'awct');
  const temLinker = ativas.some((t) => t.tipo === 'gclidw');
  const semAcionador = ativas.filter((t) => t.acionadores.length === 0);
  const pendentes = entrada.alteracoes.filter((a) => a.status !== 'none' && a.status !== 'changeStatusUnspecified');

  const problemas: ProblemaGtm[] = [];
  if (entrada.publicado === false) {
    problemas.push({ codigo: 'nunca_publicado', severidade: 'alta', titulo: 'Contêiner nunca foi publicado', detalhe: 'Nenhuma tag deste contêiner roda no site até a primeira publicação.' });
  }
  if (!ga4) {
    problemas.push({ codigo: 'sem_ga4', severidade: 'alta', titulo: 'Sem Google tag do GA4', detalhe: 'Nenhuma Google tag ativa com ID de medição "G-". Sem ela o Google Analytics 4 não recebe visitas.' });
  }
  if (!pixelMeta) {
    problemas.push({ codigo: 'sem_pixel_meta', severidade: 'media', titulo: 'Sem pixel da Meta', detalhe: 'Nenhuma tag ativa carrega o pixel da Meta (fbq). Campanhas de Facebook e Instagram ficam sem dados de conversão do site.' });
  }
  if (!conversao) {
    problemas.push({ codigo: 'sem_conversao', severidade: 'media', titulo: 'Sem tag de conversão', detalhe: 'Nenhuma tag ativa de conversão do Google Ads ou Floodlight. Leads e vendas do site não voltam para as campanhas.' });
  }
  if (temAwct && !temLinker) {
    problemas.push({ codigo: 'sem_vinculador', severidade: 'media', titulo: 'Conversão sem vinculador', detalhe: 'Há tag de conversão do Google Ads mas nenhum "Vinculador de conversões" (gclidw). Parte das conversões pode se perder.' });
  }
  if (semAcionador.length) {
    problemas.push({ codigo: 'tag_sem_acionador', severidade: 'media', titulo: `${semAcionador.length} tag(s) sem acionador`, detalhe: `Nunca disparam: ${semAcionador.map((t) => t.nome).slice(0, 5).join(', ')}.` });
  }
  if (pendentes.length) {
    problemas.push({ codigo: 'alteracoes_pendentes', severidade: 'media', titulo: `${pendentes.length} alteração(ões) não publicada(s)`, detalhe: 'O espaço de trabalho tem mudanças que ainda não estão no site. Publique para valerem.' });
  }
  if (pausadas.length) {
    problemas.push({ codigo: 'tags_pausadas', severidade: 'baixa', titulo: `${pausadas.length} tag(s) pausada(s)`, detalhe: `Pausadas: ${pausadas.map((t) => t.nome).slice(0, 5).join(', ')}.` });
  }

  return {
    resumo: { totalTags: entrada.tags.length, ativas: ativas.length, pausadas: pausadas.length, ga4, pixelMeta, conversao, alteracoesPendentes: pendentes.length },
    problemas,
  };
}

/** Caminhos aceitos (anti path-injection: o caminho vai direto na URL do Google). */
export const RE_CONTA_GTM = /^accounts\/\d+$/;
export const RE_CONTAINER_GTM = /^accounts\/\d+\/containers\/\d+$/;
export const RE_WORKSPACE_GTM = /^accounts\/\d+\/containers\/\d+\/workspaces\/\d+$/;
export const RE_ID_GA4 = ID_GA4;
