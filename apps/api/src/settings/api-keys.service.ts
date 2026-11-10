import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { API_KEY_PREFIX } from '../auth/jwt-auth.guard';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'api_key', ${entidadeId ?? null})`;
}

/** Campos seguros de uma chave — NUNCA inclui hash nem a chave em claro. */
const SAFE = { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const;

/**
 * Private Integrations: chaves de API do tenant. Guardamos só o sha256 da chave.
 * A chave em claro é devolvida UMA única vez, na criação — depois é irrecuperável.
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.apiKey.findMany({ select: SAFE, orderBy: { createdAt: 'desc' } }),
    );
  }

  /** Gera `orv_live_<segredo>`; guarda hash+prefixo; devolve a chave em claro 1x. */
  async criar(tenantId: string, identityId: string, name: string, scopes: string[] = ['contacts.read']) {
    const secret = randomBytes(24).toString('base64url'); // ~32 chars, url-safe
    const full = `${API_KEY_PREFIX}${secret}`;
    const keyPrefix = `${full.slice(0, API_KEY_PREFIX.length + 6)}…`;
    const keyHash = sha256(full);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const key = await tx.apiKey.create({
        data: { tenantId, name: name.trim(), scopes, keyPrefix, keyHash, createdBy: identityId },
        select: SAFE,
      });
      await audit(tx, tenantId, identityId, 'api_key.criada', key.id);
      // `key` é o segredo em claro — só existe nesta resposta.
      return { ...key, key: full };
    });
  }

  async revogar(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.apiKey.findFirst({ where: { id, revokedAt: null }, select: { id: true } });
      if (!existe) throw new NotFoundException('chave inexistente ou já revogada');
      await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(tx, tenantId, identityId, 'api_key.revogada', id);
      return { ok: true };
    });
  }
}
