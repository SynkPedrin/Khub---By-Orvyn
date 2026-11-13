import { AtribuicaoService } from '../crm/atribuicao.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { CryptoService } from './crypto.service';
import { META_GRAPH, type GraphClient } from './providers/meta-graph.client';
import { LeadsService } from '../crm/leads.service';
import type { StoredCredentials } from './ads-connector';

interface LeadgenChange {
  leadgenId: string;
  pageId: string;
  formId?: string;
  createdTime?: number;
}

/**
 * Lead Ads da Meta → contato no CRM (D1).
 * Fluxo: webhook (público, sem tenant) → `resolve_tenant_by_meta_page` (migration
 * 009, SECURITY DEFINER: só o id de roteamento atravessa) → dedupe em
 * `webhook_events` → busca o lead no Graph com a credencial DO TENANT → entrega
 * ao `LeadsService` (CRM). Sem credencial da Meta, o evento fica **registrado e
 * não processado** — reprocessável quando a chave chegar (Brief §2).
 */
@Injectable()
export class MetaLeadsService {
  private readonly log = new Logger('MetaLeads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly leads: LeadsService,
    @Inject(META_GRAPH) private readonly graph: GraphClient,
    @Optional() private readonly atribuicao?: AtribuicaoService,
  ) {}

  /** Extrai os leadgens do payload do webhook (formato `entry[].changes[]`). */
  parse(body: unknown): LeadgenChange[] {
    const b = body as { entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
    const out: LeadgenChange[] = [];
    for (const entry of Array.isArray(b?.entry) ? b.entry : []) {
      for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (ch?.field !== 'leadgen' || !ch.value) continue;
        const v = ch.value;
        const leadgenId = String(v.leadgen_id ?? '');
        const pageId = String(v.page_id ?? '');
        if (!leadgenId || !pageId) continue;
        out.push({ leadgenId, pageId, formId: v.form_id ? String(v.form_id) : undefined, createdTime: v.created_time ? Number(v.created_time) : undefined });
      }
    }
    return out;
  }

  async processar(ev: LeadgenChange): Promise<{ ok: boolean; motivo?: string }> {
    const tenantId = await this.resolverTenant(ev.pageId);
    if (!tenantId) {
      this.log.warn(`page ${ev.pageId} sem tenant — a página não está conectada em nenhuma conta`);
      return { ok: false, motivo: 'page_sem_tenant' };
    }

    // dedupe: a Meta reentrega o mesmo evento; unique(provider,event_id) decide
    const novo = await this.registrarEvento(tenantId, ev);
    if (!novo) {
      this.log.debug(`leadgen ${ev.leadgenId} já processado — ignorando reentrega`);
      return { ok: true, motivo: 'duplicado' };
    }

    if (!this.config.isConfigured('meta') || !this.config.isConfigured('integrations_crypto')) {
      // evento fica gravado com processed_at NULL: nada se perde, reprocessa depois
      this.config.warnDegraded('meta', 'lead registrado sem enriquecer (reprocessável)');
      return { ok: false, motivo: 'config_required' };
    }

    try {
      const cred = await this.credencialDoTenant(tenantId);
      if (!cred) return { ok: false, motivo: 'sem_credencial_conectada' };

      const pageToken = cred.pages?.find(p => p.pageId === ev.pageId)?.accessToken;
      if (!pageToken) return { ok: false, motivo: 'page_token_missing' };
      const lead = await this.buscarLead(ev.leadgenId, pageToken);
      const { adId, ...dadosLead } = lead;
      const r = await this.leads.upsertFromLead(tenantId, {
        ...dadosLead,
        origem: 'Meta Lead Ads',
        externalId: ev.leadgenId,
        criadoEm: ev.createdTime ? new Date(ev.createdTime * 1000) : undefined,
      });
      // Origem confirmada: o próprio lead traz o anúncio (db/066).
      await this.atribuicao?.registrar(tenantId, r.contactId, { fonte: 'meta_ads', canal: 'Formulário Meta', confianca: 'confirmada', em: new Date((ev.createdTime ?? Date.now() / 1000) * 1000).toISOString(), adId, sinal: 'Lead Ads' });
      await this.marcarProcessado(tenantId, ev.leadgenId);
      return { ok: true };
    } catch (e) {
      this.log.error(`falha ao processar leadgen ${ev.leadgenId}: ${(e as Error).message}`);
      return { ok: false, motivo: 'erro' };
    }
  }

  private async resolverTenant(pageId: string): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`
        SELECT resolve_tenant_by_meta_page(${pageId}) AS tenant_id`;
      return rows[0]?.tenant_id ?? null;
    } catch (e) {
      this.log.warn(`resolução de página falhou: ${(e as Error).message}`);
      return null;
    }
  }

  /** true = evento novo; false = reentrega. */
  private async registrarEvento(tenantId: string, ev: LeadgenChange): Promise<boolean> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.webhookEvent.findFirst({ where: { provider: 'meta', eventId: ev.leadgenId }, select: { id: true, processedAt: true } });
      if (existe) return !existe.processedAt;
      await tx.webhookEvent.create({
        data: { tenantId, provider: 'meta', eventId: ev.leadgenId, payload: { pageId: ev.pageId, formId: ev.formId ?? null } },
      });
      return true;
    });
  }

  private async marcarProcessado(tenantId: string, leadgenId: string): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.webhookEvent.updateMany({ where: { provider: 'meta', eventId: leadgenId }, data: { processedAt: new Date() } }),
    );
  }

  private async credencialDoTenant(tenantId: string): Promise<StoredCredentials | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const i = await tx.integration.findFirst({ where: { provider: 'meta', status: 'connected' }, select: { credentialsEncrypted: true } });
      if (!i?.credentialsEncrypted) return null;
      return this.crypto.decryptJson<StoredCredentials>(i.credentialsEncrypted);
    });
  }

  /** `field_data` da Meta vem como lista de {name, values[]} — normaliza. */
  private async buscarLead(leadgenId: string, accessToken: string) {
    const j = await this.graph.get(leadgenId, { fields: 'id,created_time,field_data,form_id,ad_id' }, accessToken);
    if (!j || String(j.id) !== leadgenId || !Array.isArray(j.field_data)) throw new Error('invalid_lead_payload');
    const campos: Record<string, string> = {};
    for (const f of (j.field_data ?? []) as { name: string; values: string[] }[]) {
      campos[f.name] = (f.values ?? [])[0] ?? '';
    }
    const achar = (...chaves: string[]) => {
      for (const k of chaves) {
        const hit = Object.keys(campos).find((c) => c.toLowerCase().includes(k));
        if (hit && campos[hit]) return campos[hit];
      }
      return undefined;
    };
    return {
      nome: achar('full_name', 'nome', 'name'),
      email: achar('email', 'e-mail'),
      telefone: achar('phone', 'telefone', 'celular'),
      campos,
      adId: typeof j.ad_id === 'string' ? j.ad_id : j.ad_id != null ? String(j.ad_id) : undefined,
    };
  }
}
