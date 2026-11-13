import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../integrations/crypto.service';
import type { StoredCredentials } from '../integrations/ads-connector';
import { lerAtribuicao, mesclarAtribuicao, origemAtualizada, toqueInferido, type Toque } from './atribuicao';

interface AnuncioMeta { anuncio?: string; campanhaId?: string; campanha?: string; conjunto?: string; criativoId?: string; criativo?: string; criativoThumb?: string }

/**
 * Grava a origem do lead (db/066) e, quando o toque traz um anúncio da Meta,
 * resolve campanha/conjunto/criativo pela Graph API com o token da conta de
 * anúncios JÁ conectada na subconta (Marketing API, nó Ad:
 * https://developers.facebook.com/docs/marketing-api/reference/adgroup —
 * campos `name`, `campaign`, `adset`, `creative`).
 *
 * Falha na Meta nunca impede a entrada do lead: o toque fica com o ad_id e a
 * confiança 'confirmada' (o id veio do próprio evento); só o nome fica faltando.
 */
@Injectable()
export class AtribuicaoService {
  private readonly log = new Logger('Atribuicao');
  private readonly cache = new Map<string, { em: number; v: AnuncioMeta | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Registra um toque no contato (primeiro toque preservado). Nunca lança. */
  async registrar(tenantId: string, contactId: string, toque: Toque): Promise<void> {
    try {
      const anuncio = toque.fonte === 'meta_ads' && toque.adId && !toque.campanha ? await this.resolverAnuncio(tenantId, toque.adId) : null;
      const enriquecido: Toque = anuncio ? { ...toque, ...Object.fromEntries(Object.entries(anuncio).filter(([, v]) => v)) } : toque;
      await this.prisma.withTenant(tenantId, async (tx) => {
        const c = await tx.contact.findUnique({ where: { id: contactId }, select: { atribuicao: true, origem: true, adCampaignId: true, adCreativeId: true } });
        if (!c) return;
        const atual = lerAtribuicao(c.atribuicao);
        // Mensagem comum (sem anúncio) de quem já tem origem não é "novo toque".
        if (atual && enriquecido.confianca === 'desconhecida') return;
        const nova = mesclarAtribuicao(atual, enriquecido);
        const [camp, cria] = await Promise.all([
          !c.adCampaignId && nova.campanhaId ? tx.adCampaign.findFirst({ where: { externalId: nova.campanhaId }, select: { id: true } }) : null,
          !c.adCreativeId && nova.criativoId ? tx.adCreative.findFirst({ where: { externalId: nova.criativoId }, select: { id: true } }) : null,
        ]);
        await tx.contact.update({
          where: { id: contactId },
          data: {
            atribuicao: nova as unknown as Prisma.InputJsonValue,
            origem: origemAtualizada(c.origem, nova),
            adCampaignId: camp?.id ?? undefined,
            adCreativeId: cria?.id ?? undefined,
          },
        });
      });
    } catch (e) {
      this.log.warn(`atribuição do contato ${contactId.slice(0, 8)}… não gravada: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  /** Anúncio → campanha/conjunto/criativo (cache de 6 h por anúncio). */
  async resolverAnuncio(tenantId: string, adId: string): Promise<AnuncioMeta | null> {
    if (!/^\d{5,30}$/.test(adId)) return null;
    const chave = `${tenantId}:${adId}`;
    const hit = this.cache.get(chave);
    if (hit && Date.now() - hit.em < 6 * 3600_000) return hit.v;
    const cred = await this.prisma.withTenant(tenantId, (tx) => tx.integration.findFirst({ where: { provider: 'meta', status: 'connected' }, select: { credentialsEncrypted: true } }));
    if (!cred?.credentialsEncrypted) return null;
    let v: AnuncioMeta | null = null;
    try {
      const token = this.crypto.decryptJson<StoredCredentials>(cred.credentialsEncrypted).accessToken;
      const url = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v21.0'}/${adId}`);
      url.searchParams.set('fields', 'name,campaign{id,name},adset{id,name},creative{id,name,thumbnail_url}');
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      const j = (await r.json().catch(() => ({}))) as { name?: string; campaign?: { id?: string; name?: string }; adset?: { name?: string }; creative?: { id?: string; name?: string; thumbnail_url?: string }; error?: { message?: string } };
      if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      v = { anuncio: j.name, campanhaId: j.campaign?.id, campanha: j.campaign?.name, conjunto: j.adset?.name, criativoId: j.creative?.id, criativo: j.creative?.name, criativoThumb: j.creative?.thumbnail_url };
    } catch (e) {
      // Anúncio de outra conta/BM ou token sem permissão: fica só o ad_id.
      this.log.warn(`anúncio ${adId} não resolvido na Meta: ${(e as Error).message.slice(0, 160)}`);
    }
    this.cache.set(chave, { em: Date.now(), v });
    return v;
  }

  /**
   * Backfill: contatos sem atribuição recebem a origem INFERIDA do que o CRM já
   * sabe (tag importada, Lead Ads, canal da 1ª conversa), com a confiança
   * correspondente. Idempotente: só toca quem está vazio.
   */
  async backfill(tenantId: string, lote = 500): Promise<{ atualizados: number; porFonte: Record<string, number> }> {
    const contatos = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ id: string; origem: string | null; tags: string[]; ad_campaign_id: string | null; created_at: Date; canal: string | null }[]>`
      SELECT c.id, c.origem, c.tags, c.ad_campaign_id, c.created_at,
             (SELECT cv.canal FROM conversations cv WHERE cv.contact_id = c.id ORDER BY cv.created_at ASC LIMIT 1) AS canal
      FROM contacts c WHERE c.atribuicao = '{}'::jsonb ORDER BY c.created_at LIMIT ${lote}::int`);
    const porFonte: Record<string, number> = {};
    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const c of contatos) {
        const t = toqueInferido({ origem: c.origem, tags: c.tags ?? [], adCampaignId: c.ad_campaign_id, canal: c.canal, criadoEm: c.created_at });
        await tx.contact.update({ where: { id: c.id }, data: { atribuicao: { ...t, primeiroToqueEm: t.em, toques: 1 } as unknown as Prisma.InputJsonValue } });
        porFonte[t.fonte] = (porFonte[t.fonte] ?? 0) + 1;
      }
    }, { timeout: 120_000 });
    return { atualizados: contatos.length, porFonte };
  }
}
