import type { Prisma } from '@prisma/client';

/**
 * Catálogo de tags (crm_tags, Configurações › Tags) × tags usadas no sistema.
 *
 * Regra: toda tag que passa a EXISTIR em algum lugar (contato, automação,
 * importação) entra no catálogo, para ser escolhida depois em qualquer tela.
 * A unicidade do catálogo é por `lower(name)` (db/018), então "MetaAds" e
 * "metaads" são a mesma tag.
 */

export const TAG_MAX = 40;

/** Normaliza o que vai para o catálogo: espaços colapsados, até 40 caracteres. */
export function normalizarTag(t: string): string {
  return t.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX);
}

/** Insere no catálogo as tags que ainda não existem (idempotente, sem mexer nas existentes). */
export async function garantirTagsNoCatalogo(tx: Prisma.TransactionClient, tenantId: string, nomes: Iterable<string>): Promise<void> {
  const vistos = new Set<string>();
  for (const bruta of nomes) {
    const tag = normalizarTag(String(bruta ?? ''));
    if (!tag || vistos.has(tag.toLowerCase())) continue;
    vistos.add(tag.toLowerCase());
    await tx.$executeRaw`INSERT INTO crm_tags (tenant_id, name) VALUES (${tenantId}::uuid, ${tag}) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`;
  }
}

/** Como uma automação usa a tag. */
export type PapelTag = 'gatilho' | 'adiciona' | 'remove' | 'condicao' | 'espera' | 'segmento';

export interface UsoTagNoGrafo {
  tag: string;
  papel: PapelTag;
  noId: string;
  tipo: string;
}

interface NoLike {
  id?: unknown;
  tipo?: unknown;
  config?: unknown;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? normalizarTag(v) : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(texto).filter((x): x is string => !!x) : []);
const CAMPO_TAG = /^contato\.tags?$/;

/**
 * Todas as tags citadas num grafo de automação, com o papel de cada uma.
 * Lê o JSON cru (sem depender do schema estrito): versões antigas também contam.
 */
export function tagsDoGrafo(grafo: unknown): UsoTagNoGrafo[] {
  const nos = (grafo && typeof grafo === 'object' && Array.isArray((grafo as { nos?: unknown }).nos) ? (grafo as { nos: NoLike[] }).nos : []);
  const usos: UsoTagNoGrafo[] = [];
  for (const no of nos) {
    const tipo = String(no.tipo ?? '');
    const noId = String(no.id ?? '');
    const cfg = (no.config && typeof no.config === 'object' ? no.config : {}) as Record<string, unknown>;
    const add = (tag: string | null, papel: PapelTag) => { if (tag) usos.push({ tag, papel, noId, tipo }); };

    switch (tipo) {
      case 'gatilho.tag_adicionada': add(texto(cfg.tag), 'gatilho'); break;
      case 'acao.adicionar_tag': add(texto(cfg.tag), 'adiciona'); break;
      case 'acao.remover_tag': add(texto(cfg.tag), 'remove'); break;
      case 'acao.atualizar_contato':
        for (const t of lista(cfg.tagsAdicionar)) add(t, 'adiciona');
        for (const t of lista(cfg.tagsRemover)) add(t, 'remove');
        break;
      case 'gatilho.agendado': for (const t of lista(cfg.tags)) add(t, 'segmento'); break;
      case 'controle.esperar_ate':
      case 'controle.meta':
        if (cfg.evento === 'tag_adicionada') add(texto(cfg.tag), 'espera');
        break;
      default: break;
    }
    // If/Else e Split: regras sobre contato.tag(s) em qualquer ramo
    const ramos = Array.isArray(cfg.ramos) ? cfg.ramos : [];
    for (const r of ramos as { regras?: { campo?: unknown; valor?: unknown }[] }[]) {
      for (const regra of r?.regras ?? []) {
        if (typeof regra?.campo === 'string' && CAMPO_TAG.test(regra.campo)) add(texto(regra.valor), 'condicao');
      }
    }
  }
  return usos;
}

/** Chave para achar variações da mesma tag: sem acento, caixa, espaço, hífen ou sublinhado. */
export function chaveParecida(tag: string): string {
  return tag.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_\-.]+/g, '');
}
