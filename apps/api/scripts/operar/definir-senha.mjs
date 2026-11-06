#!/usr/bin/env node
/**
 * Redefinição de senha pelo operador — enquanto o fluxo "esqueci a senha" não
 * existe (sprint 1). Gera senha forte, grava o hash argon2id (o mesmo do
 * signup), revoga TODAS as sessões da identidade e registra no audit_log de
 * cada tenant em que ela é membro.
 *
 *   cd apps/api && pnpm build && node --env-file=.env scripts/operar/definir-senha.mjs --email E
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hash } = require('@node-rs/argon2');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { TokenService } = require('../../dist/auth/token.service');

const i = process.argv.indexOf('--email');
const email = i > 0 ? process.argv[i + 1] : undefined;
if (!email) {
  console.error('uso: --email E');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const id = await prisma.identity.findFirst({ where: { email }, select: { id: true } });
  if (!id) throw new Error(`identidade não encontrada: ${email}`);
  // 4 blocos aleatórios legíveis + dígito e símbolo (passa em qualquer política).
  const senha = `${randomBytes(12).toString('base64url').match(/.{1,4}/g).join('-')}9!`;
  await prisma.identity.update({ where: { id: id.id }, data: { passwordHash: await hash(senha), updatedAt: new Date() } });
  await app.get(TokenService).revokeAllForIdentity(id.id);
  const tenants = await prisma.membership.findMany({ where: { identityId: id.id }, select: { tenantId: true } });
  for (const t of tenants) {
    await prisma.withTenant(t.tenantId, (tx) =>
      tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id) VALUES (${t.tenantId}::uuid, 'sistema', 'operador', 'identidade.senha_redefinida', 'identity', ${id.id})`,
    );
  }
  console.log(`senha redefinida para ${email}; sessões antigas revogadas.`);
  console.log(`NOVA SENHA: ${senha}`);
} catch (e) {
  console.error('ERRO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
}
