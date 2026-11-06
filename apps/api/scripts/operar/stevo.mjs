#!/usr/bin/env node
/**
 * Operação Stevo (agência) — enquanto o painel da agência não existe (sprint 10).
 * Chama os MESMOS serviços da API (regras, RLS, auditoria). Nunca imprime segredo.
 *
 *   pnpm build && node --env-file=.env scripts/operar/stevo.mjs <comando>
 *
 *   me                                      escopos da chave e o que falta
 *   instancias                              instâncias da conta (sem telefone) + vínculo
 *   criar-cliente  --agencia-email E --nome N [--nicho X]
 *   vincular       --tenant T --instancia I --agencia-email E
 *   webhook        --url https://…/v1/webhooks/stevo-api   (grava o segredo no .env)
 *   webhooks                                lista webhooks de conta
 */
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const cmd = process.argv[2];

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { StevoApiProvider } = require('../../dist/crm/messaging/stevo-api.provider');
const { StevoApiVinculoService } = require('../../dist/crm/messaging/stevo-api-vinculo.service');
const { AgencyService } = require('../../dist/agency/agency.service');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { EVENTOS_STEVO } = require('../../dist/crm/messaging/stevo-api-webhook.controller');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const stevo = app.get(StevoApiProvider);
const prisma = app.get(PrismaService);
const identidade = async (email) => {
  if (!email) throw new Error('--agencia-email obrigatório');
  const i = await prisma.identity.findFirst({ where: { email }, select: { id: true } });
  if (!i) throw new Error(`identidade não encontrada: ${email}`);
  return i.id;
};

try {
  if (cmd === 'me') {
    const me = await stevo.me();
    console.log('chave:', me.key.name, '| restrita a instâncias:', me.key.allowed_instance_ids ? 'sim' : 'não', '| limite/min:', me.key.rate_limit_per_minute);
    console.log('escopos:', me.key.scopes.join(', '));
    const falta = await stevo.escoposFaltando();
    console.log(falta.length ? `FALTAM: ${falta.map((f) => `${f.escopo} (${f.para})`).join('; ')}` : 'nenhum escopo necessário faltando');
  } else if (cmd === 'instancias') {
    for (const i of await stevo.listarInstancias()) {
      const r = await prisma.$queryRaw`SELECT resolve_tenant_by_stevo_api_instance(${i.id}) AS tenant_id`;
      console.log(`- ${i.instance_name ?? i.name} | id ${i.id} | conectada: ${i.connected} | perfil: ${i.profile_name ?? '-'} | vínculo: ${r[0]?.tenant_id ?? 'nenhum'}`);
    }
  } else if (cmd === 'criar-cliente') {
    const nome = arg('nome');
    if (!nome) throw new Error('--nome obrigatório');
    const c = await app.get(AgencyService).criarCliente(await identidade(arg('agencia-email')), { nome, nicho: arg('nicho') });
    console.log(`cliente criado: ${c.displayName} | tenant ${c.tenantId}`);
  } else if (cmd === 'vincular') {
    const r = await app.get(StevoApiVinculoService).vincular(arg('tenant'), arg('instancia'), await identidade(arg('agencia-email')));
    console.log(`vinculada: ${r.instancia.nome} (${r.instancia.perfil ?? '-'}) → status ${r.status}`);
  } else if (cmd === 'webhook') {
    const url = arg('url');
    if (!url?.startsWith('https://')) throw new Error('--url https://… obrigatório (a Stevo exige HTTPS público)');
    const { id, secret } = await stevo.criarWebhookConta(url, [...EVENTOS_STEVO], 'ORVYN Revenue OS');
    const env = readFileSync('.env', 'utf8');
    const linha = `STEVO_WEBHOOK_SECRET=${secret}`;
    writeFileSync('.env', /^STEVO_WEBHOOK_SECRET=.*$/m.test(env) ? env.replace(/^STEVO_WEBHOOK_SECRET=.*$/m, linha) : `${env.replace(/\n?$/, '\n')}# Segredo do webhook de conta Stevo (whsec_), criado em ${new Date().toISOString()} — webhook ${id}\n${linha}\n`);
    console.log(`webhook criado (${id}); segredo gravado em .env (não exibido). Reinicie a API.`);
  } else if (cmd === 'webhooks') {
    for (const w of await stevo.listarWebhooks()) console.log(`- ${w.id} | ${w.url} | ativo: ${w.active}${w.disabled_reason ? ` (${w.disabled_reason})` : ''} | ${w.events.join(',')}`);
  } else {
    console.log('comandos: me | instancias | criar-cliente | vincular | webhook | webhooks');
  }
} catch (e) {
  console.error('ERRO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
}
