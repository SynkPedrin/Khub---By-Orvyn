#!/usr/bin/env node
/**
 * Cria um usuário MASTER da agência (papel `admin`, que enxerga TODOS os
 * clientes, inclusive os criados depois) pelo MESMO fluxo do botão "Convidar"
 * do painel: AgencyAdminService.invite (em nome do dono) + accept. Assim saem
 * identidade, membro da agência, acesso a cada cliente, vínculo e usuário em
 * cada subconta e auditoria, tudo numa transação, sem atalho no banco.
 *
 *   cd apps/api && pnpm build
 *   RESEND_API_KEY= node --env-file=.env scripts/operar/criar-master.mjs \
 *     --agencia-email DONO@... --email NOVO@... --nome "Nome"
 *
 * `RESEND_API_KEY=` vazio: o convite NÃO é enviado por e-mail (a conta é
 * criada direto). A senha é gerada aqui e mostrada uma única vez.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const donoEmail = arg('--agencia-email');
const email = arg('--email');
const nome = arg('--nome') ?? 'Master';
if (!donoEmail || !email) {
  console.error('uso: --agencia-email DONO --email NOVO [--nome "Nome"]');
  process.exit(1);
}

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { AgencyAdminService } = require('../../dist/agency/agency-admin.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const adm = app.get(AgencyAdminService);
  const dono = await prisma.identity.findFirst({ where: { email: { equals: donoEmail, mode: 'insensitive' } }, select: { id: true } });
  if (!dono) throw new Error(`dono não encontrado: ${donoEmail}`);
  const membro = await prisma.agencyMember.findFirst({ where: { identityId: dono.id }, include: { agency: true } });
  if (!membro || membro.role !== 'owner') throw new Error('o e-mail informado não é dono (owner) de uma agência');
  const clientes = await prisma.agencyClientAccount.findMany({ where: { agencyId: membro.agencyId, status: 'active' }, orderBy: { createdAt: 'asc' } });
  if (!clientes.length) throw new Error('a agência não tem clientes ativos');

  const convite = await adm.invite(dono.id, email, 'admin', clientes.map((c) => c.id));
  if (convite.emailSent) console.warn('ATENÇÃO: o convite também foi enviado por e-mail.');
  const token = new URL(convite.acceptUrl).searchParams.get('token');
  // Senha forte e digitável: 4 blocos aleatórios + dígito e símbolo.
  const senha = `${randomBytes(12).toString('base64url').match(/.{1,4}/g).join('-')}9!`;
  const r = await adm.accept(token, nome, senha, 'operador/criar-master');

  console.log(`agência: ${membro.agency.name}`);
  console.log(`clientes com acesso: ${clientes.map((c) => c.displayName).join(', ')}`);
  console.log(`papel na agência: admin (vê todos os clientes, inclusive novos)`);
  console.log(`subconta inicial: ${clientes[0].displayName} (papel ${r.user.role})`);
  console.log(`EMAIL: ${email}`);
  console.log(`SENHA: ${senha}`);
} catch (e) {
  console.error('ERRO:', e?.response?.message ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
}
