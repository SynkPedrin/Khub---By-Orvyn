/**
 * Atribuição de origem do lead (db/066) — regras PURAS, testáveis.
 *
 * Princípios (margem de erro explícita, nunca chute disfarçado de fato):
 *  - `confianca`:
 *      'confirmada'  → o próprio evento trouxe o anúncio (referral da Meta com
 *                      ad_id, Lead Ads, gclid de formulário);
 *      'provavel'    → inferida de sinal indireto (tag de importação, UTM sem id
 *                      de clique, texto do anúncio);
 *      'desconhecida'→ só o canal é conhecido (contato direto).
 *  - PRIMEIRO TOQUE é preservado: um contato que voltou por outro anúncio não
 *    perde a origem; o novo toque vai para `ultimoToque`.
 *  - Nada é inventado: sem dado, fica 'organico'/'desconhecida'.
 */
export type FonteLead = 'meta_ads' | 'google_ads' | 'tiktok_ads' | 'whatsapp_direto' | 'instagram_direto' | 'messenger_direto' | 'formulario' | 'indicacao' | 'importacao' | 'manual' | 'desconhecida';
export type Confianca = 'confirmada' | 'provavel' | 'desconhecida';

export interface Toque {
  fonte: FonteLead;
  canal: string;
  confianca: Confianca;
  em: string;
  adId?: string;
  anuncio?: string;
  campanhaId?: string;
  campanha?: string;
  conjunto?: string;
  criativoId?: string;
  criativo?: string;
  criativoThumb?: string;
  ref?: string;
  /** Id de clique (ctwa_clid / gclid / ttclid / fbclid): base para conversão offline. */
  cliqueId?: string;
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>;
  sinal?: string;
}

export interface Atribuicao extends Toque {
  primeiroToqueEm: string;
  ultimoToque?: Toque;
  toques?: number;
}

const ORDEM: Record<Confianca, number> = { desconhecida: 0, provavel: 1, confirmada: 2 };

export function lerAtribuicao(v: unknown): Atribuicao | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Partial<Atribuicao>;
  return o.fonte && o.canal && o.confianca && o.primeiroToqueEm ? (o as Atribuicao) : null;
}

/**
 * Junta um toque novo à atribuição atual. Primeiro toque fica; exceção: se o
 * primeiro era 'desconhecida' e o novo é melhor (ex.: o contato chegou direto e
 * DEPOIS o mesmo número clica num anúncio na mesma conversa), promove.
 */
export function mesclarAtribuicao(atual: Atribuicao | null, novo: Toque): Atribuicao {
  if (!atual) return { ...novo, primeiroToqueEm: novo.em, toques: 1 };
  const toques = (atual.toques ?? 1) + 1;
  if (ORDEM[novo.confianca] > ORDEM[atual.confianca] && atual.confianca === 'desconhecida') {
    return { ...novo, primeiroToqueEm: atual.primeiroToqueEm, ultimoToque: novo, toques };
  }
  return { ...atual, ultimoToque: novo, toques };
}

/** Referral de DM da Meta (Click-to-Messenger/Instagram): doc oficial `message.referral`. */
export function toqueDeReferralMeta(canal: 'Instagram' | 'Messenger', r: { adId?: string; ref?: string; titulo?: string; postId?: string } | null | undefined, em = new Date()): Toque {
  if (r?.adId) {
    return { fonte: 'meta_ads', canal, confianca: 'confirmada', em: em.toISOString(), adId: r.adId, anuncio: r.titulo, ref: r.ref, sinal: 'referral do anúncio no direct' };
  }
  return { fonte: canal === 'Instagram' ? 'instagram_direto' : 'messenger_direto', canal, confianca: 'desconhecida', em: em.toISOString(), ...(r?.ref ? { ref: r.ref } : {}) };
}

/** Referral do WhatsApp (Click-to-WhatsApp): campos da Cloud API (`source_id`, `ctwa_clid`, `headline`). */
export function toqueDeReferralWhatsApp(r: { adId?: string; cliqueId?: string; titulo?: string; url?: string } | null | undefined, em = new Date()): Toque {
  if (r?.adId || r?.cliqueId) {
    return { fonte: 'meta_ads', canal: 'WhatsApp', confianca: r.adId ? 'confirmada' : 'provavel', em: em.toISOString(), adId: r.adId, cliqueId: r.cliqueId, anuncio: r.titulo, sinal: 'clique em anúncio para WhatsApp' };
  }
  return { fonte: 'whatsapp_direto', canal: 'WhatsApp', confianca: 'desconhecida', em: em.toISOString() };
}

/** UTM/gclid de formulário ou link rastreado. Pura. */
export function toqueDeUtm(p: Record<string, string | undefined>, em = new Date()): Toque {
  const src = (p.utm_source ?? '').toLowerCase();
  const utm = { source: p.utm_source, medium: p.utm_medium, campaign: p.utm_campaign, content: p.utm_content, term: p.utm_term };
  const limpo = Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as Toque['utm'];
  if (p.gclid || p.gbraid || p.wbraid) return { fonte: 'google_ads', canal: 'Formulário', confianca: 'confirmada', em: em.toISOString(), cliqueId: p.gclid ?? p.gbraid ?? p.wbraid, campanha: p.utm_campaign, utm: limpo, sinal: 'gclid' };
  if (p.fbclid || /facebook|instagram|meta|fb|ig/.test(src)) return { fonte: 'meta_ads', canal: 'Formulário', confianca: p.fbclid ? 'confirmada' : 'provavel', em: em.toISOString(), cliqueId: p.fbclid, campanha: p.utm_campaign, utm: limpo, sinal: p.fbclid ? 'fbclid' : 'utm_source' };
  if (p.ttclid || /tiktok/.test(src)) return { fonte: 'tiktok_ads', canal: 'Formulário', confianca: p.ttclid ? 'confirmada' : 'provavel', em: em.toISOString(), cliqueId: p.ttclid, campanha: p.utm_campaign, utm: limpo };
  if (/google|adwords/.test(src)) return { fonte: 'google_ads', canal: 'Formulário', confianca: 'provavel', em: em.toISOString(), campanha: p.utm_campaign, utm: limpo, sinal: 'utm_source' };
  return { fonte: 'formulario', canal: 'Formulário', confianca: Object.keys(limpo ?? {}).length ? 'provavel' : 'desconhecida', em: em.toISOString(), utm: limpo };
}

/**
 * Backfill de contatos antigos (sem atribuição): usa o que já existe no CRM.
 * Tag de importação do GHL ("metaads", "kroma-ads", "googleads") vale como
 * 'provavel' (marcada por automação do GHL, não pelo anúncio em si).
 */
export function toqueInferido(c: { origem: string | null; tags: string[]; adCampaignId: string | null; canal: string | null; criadoEm: Date }): Toque {
  const em = c.criadoEm.toISOString();
  const tags = c.tags.map((t) => t.toLowerCase().replace(/[\s_]/g, '-'));
  const origem = (c.origem ?? '').toLowerCase();
  if (c.adCampaignId || /meta lead ads|lead ads/.test(origem)) return { fonte: 'meta_ads', canal: 'Formulário Meta', confianca: 'confirmada', em, sinal: 'lead ads' };
  if (tags.some((t) => /^(meta-?ads|kroma-?ads|facebook-?ads|instagram-?ads|fb-?ads)$/.test(t))) return { fonte: 'meta_ads', canal: c.canal ?? 'WhatsApp', confianca: 'provavel', em, sinal: 'tag importada' };
  if (tags.some((t) => /^(google-?ads|googleads|gads)$/.test(t)) || /google/.test(origem)) return { fonte: 'google_ads', canal: c.canal ?? 'WhatsApp', confianca: 'provavel', em, sinal: 'tag importada' };
  if (tags.some((t) => /tiktok/.test(t))) return { fonte: 'tiktok_ads', canal: c.canal ?? 'WhatsApp', confianca: 'provavel', em, sinal: 'tag importada' };
  if (/migracao_ghl|importa/.test(origem)) return { fonte: 'importacao', canal: c.canal ?? 'WhatsApp', confianca: 'desconhecida', em };
  if (/manual/.test(origem)) return { fonte: 'manual', canal: 'Manual', confianca: 'desconhecida', em };
  const canal = c.canal ?? 'WhatsApp';
  return { fonte: canal === 'Instagram' ? 'instagram_direto' : canal === 'Messenger' ? 'messenger_direto' : 'whatsapp_direto', canal, confianca: 'desconhecida', em };
}

export const ROTULO_FONTE: Record<FonteLead, string> = {
  meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads', whatsapp_direto: 'WhatsApp direto',
  instagram_direto: 'Instagram direto', messenger_direto: 'Messenger direto', formulario: 'Formulário', indicacao: 'Indicação',
  importacao: 'Importação', manual: 'Cadastro manual', desconhecida: 'Desconhecida',
};

/** Rótulos genéricos gravados na criação do contato (antes da atribuição rodar). */
const ROTULOS_GENERICOS = new Set<string>([
  'WhatsApp', 'Instagram', 'Messenger', 'YouTube', 'TikTok',
  ROTULO_FONTE.whatsapp_direto, ROTULO_FONTE.instagram_direto, ROTULO_FONTE.messenger_direto, ROTULO_FONTE.desconhecida,
]);

/**
 * Valor novo do campo `origem` depois de um toque: placeholder de canal é
 * substituído quando a atribuição é melhor que "só sei o canal"; origem já
 * específica (ex.: 'Meta Ads', 'Indicação') nunca é sobrescrita — primeiro
 * toque preservado. `undefined` = não mexe na coluna.
 */
export function origemAtualizada(atual: string | null, nova: Atribuicao): string | undefined {
  if (!atual) return ROTULO_FONTE[nova.fonte];
  return ROTULOS_GENERICOS.has(atual) && nova.confianca !== 'desconhecida' ? ROTULO_FONTE[nova.fonte] : undefined;
}
