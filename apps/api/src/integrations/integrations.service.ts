import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { ConfigService } from '../config/config.service';
import { ADS_CONNECTORS, type AdsConnector, type StoredCredentials } from './ads-connector';
import { MetaAdsConnector } from './providers/meta-ads.connector';

interface StatePayload {
  tenantId: string;
  provider: string;
  nonce: string;
  ts: number;
}

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger('Integrations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    @Inject(ADS_CONNECTORS) private readonly connectors: Record<string, AdsConnector>,
    @InjectQueue('ads-sync') private readonly queue: Queue,
    private readonly metaConnector: MetaAdsConnector,
  ) {}

  private connector(provider: string): AdsConnector {
    const c = this.connectors[provider];
    if (!c) throw new NotFoundException(`provider '${provider}' não suportado`);
    return c;
  }

  // ---- state assinado (HMAC) para o OAuth ser stateless e seguro ----
  private signState(p: StatePayload): string {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET!).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  private verifyState(state: string): StatePayload {
    const [body, sig] = state.split('.');
    if (!body || !sig) throw new BadRequestException('state inválido');
    const expected = createHmac('sha256', process.env.JWT_SECRET!).update(body).digest('base64url');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new BadRequestException('state adulterado');
    }
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as StatePayload;
    if (Date.now() - p.ts > 10 * 60_000) throw new BadRequestException('state expirado');
    return p;
  }

  /**
   * `capability` só tem efeito para `provider==='meta'` (`'ads'` | `'leads'`,
   * default `'ads'`) — os demais conectores ignoram, sem quebrar contrato.
   * Ver `MetaAdsConnector` para o porquê de não pedir os dois num diálogo só.
   */
  getAuthUrl(tenantId: string, provider: string, capability?: string): { url: string } {
    // Gating (Brief §2): 501 config_required com as variáveis que faltam.
    if (provider === 'meta') this.config.require('meta');
    if (provider === 'google') this.config.require('google_ads');
    if (provider === 'tiktok') this.config.require('tiktok');
    this.config.require('integrations_crypto');
    const state = this.signState({ tenantId, provider, nonce: randomBytes(8).toString('hex'), ts: Date.now() });

    if (provider === 'meta' && (capability === 'ads' || capability === 'leads')) {
      return { url: this.metaConnector.buildAuthUrl(tenantId, state, capability) };
    }
    return { url: this.connector(provider).buildAuthUrl(tenantId, state) };
  }

  /**
   * Diagnóstico legível do que a conta Meta concedeu de verdade — em vez de
   * um "Invalid Scopes" cru, diz exatamente qual capability falta e por quê.
   */
  async diagnosticoMeta(tenantId: string) {
    this.config.require('meta');
    const integ = await this.prisma.withTenant(tenantId, (tx) => tx.integration.findFirst({ where: { tenantId, provider: 'meta' } }));
    if (!integ?.credentialsEncrypted) {
      return { conectado: false, tokenValido: false, concedidos: [], faltandoAds: [], faltandoLeads: [], paginas: [] };
    }
    const cred = this.crypto.decryptJson<StoredCredentials>(integ.credentialsEncrypted);
    const r = await this.metaConnector.diagnosticar(cred);
    return { conectado: true, ...r };
  }

  /** Chamado pela rota pública de callback (browser → front → API). */
  async handleCallback(provider: string, code: string, state: string): Promise<{ tenantId: string }> {
    const p = this.verifyState(state);
    if (p.provider !== provider) throw new BadRequestException('provider divergente do state');
    const connector = this.connector(provider);
    const cred = await connector.exchangeCode(code);

    const integrationId = await this.prisma.withTenant(p.tenantId, async (tx) => {
      const existing = await tx.integration.findFirst({ where: { provider }, select: { id: true } });
      const data = {
        status: 'connected',
        credentialsEncrypted: this.crypto.encryptJson(cred),
        scopes: cred.scopes ?? [],
        connectedAt: new Date(),
        erro: null,
        health: 'unknown',
      };
      let id: string;
      if (existing) {
        await tx.integration.update({ where: { id: existing.id }, data });
        id = existing.id;
      } else {
        const created = await tx.integration.create({
          data: { tenantId: p.tenantId, provider, externalBusinessId: cred.externalBusinessId ?? null, ...data },
          select: { id: true },
        });
        id = created.id;
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, acao, entidade, entidade_id) VALUES (${p.tenantId}::uuid, 'humano', 'integration.connect', 'integration', ${id})`;
      return id;
    });

    await this.registrarPaginas(p.tenantId, integrationId, connector, cred);
    await this.enqueueSync(p.tenantId, integrationId);
    return { tenantId: p.tenantId };
  }

  /**
   * Guarda as páginas do cliente (D1): é o que permite o webhook de Lead Ads,
   * que chega sem tenant, descobrir o dono via `resolve_tenant_by_meta_page`.
   * Falha aqui não derruba a conexão — a integração já está válida.
   */
  private async registrarPaginas(tenantId: string, integrationId: string, connector: AdsConnector, cred: StoredCredentials): Promise<void> {
    if (!connector.listPages) return;
    try {
      const pages = await connector.listPages(cred);
      if (!pages.length) return;
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.integration.update({where:{id:integrationId,tenantId},data:{credentialsEncrypted:this.crypto.encryptJson({...cred,pages})}});
        for (const p of pages) {
          // A reconexão só pode atualizar a página do mesmo tenant.
          await tx.$executeRaw`
            INSERT INTO meta_pages (tenant_id, integration_id, page_id, page_nome)
            VALUES (${tenantId}::uuid, ${integrationId}::uuid, ${p.pageId}, ${p.nome})
            ON CONFLICT (page_id) DO UPDATE SET integration_id = EXCLUDED.integration_id, page_nome = EXCLUDED.page_nome
            WHERE meta_pages.tenant_id = EXCLUDED.tenant_id`;
        }
      });
    } catch (e) {
      this.log.warn(`não consegui registrar as páginas do tenant ${tenantId}: ${(e as Error).message}`);
    }
  }

  async list(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, status: true, health: true, lastSyncAt: true, connectedAt: true, scopes: true, erro: true },
      }),
    );
  }

  async sync(tenantId: string, integrationId: string) {
    const integ = await this.prisma.withTenant(tenantId, (tx) => tx.integration.findUnique({ where: { id: integrationId }, select: { id: true } }));
    if (!integ) throw new NotFoundException('integração inexistente');
    await this.enqueueSync(tenantId, integrationId);
    return { ok: true, queued: true };
  }

  private async enqueueSync(tenantId: string, integrationId: string) {
    await this.queue.add(
      'sync',
      { tenantId, integrationId },
      { jobId: `sync-${integrationId}-${Date.now()}`, removeOnComplete: 50, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }
}
