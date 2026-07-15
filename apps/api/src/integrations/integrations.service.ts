import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { ADS_CONNECTORS, type AdsConnector } from './ads-connector';

interface StatePayload {
  tenantId: string;
  provider: string;
  nonce: string;
  ts: number;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ADS_CONNECTORS) private readonly connectors: Record<string, AdsConnector>,
    @InjectQueue('ads-sync') private readonly queue: Queue,
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

  getAuthUrl(tenantId: string, provider: string): { url: string } {
    if (provider === 'meta' && !process.env.META_APP_ID) {
      throw new BadRequestException('META_APP_ID não configurado no servidor.');
    }
    if (!this.crypto.configured()) {
      throw new BadRequestException('INTEGRATIONS_ENCRYPTION_KEY não configurada — não é possível guardar credenciais com segurança.');
    }
    const state = this.signState({ tenantId, provider, nonce: randomBytes(8).toString('hex'), ts: Date.now() });
    return { url: this.connector(provider).buildAuthUrl(tenantId, state) };
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

    await this.enqueueSync(p.tenantId, integrationId);
    return { tenantId: p.tenantId };
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
      { jobId: `sync:${integrationId}:${Date.now()}`, removeOnComplete: 50, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }
}
