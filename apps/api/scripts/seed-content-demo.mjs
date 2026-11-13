// Content Operations Lab — 3 operações demonstrativas completas.
//
// Idempotente por NEGÓCIO: se já existe um tenant com `nome` + `isDemo:true`
// para este `datasetVersion`, o script pula o negócio inteiro (não tenta
// mesclar/atualizar entidade por entidade — mais simples e seguro pra um
// seed que roda uma vez pra preparar gravação de conteúdo, não continuamente).
//
// Conecta como superuser (mesma convenção de scripts/seed-marketplace.mjs):
// criar um tenant do zero não tem `tenant_id` ainda pra usar `withTenant`.
// Todo INSERT abaixo seta `tenantId` explicitamente — RLS não filtra aqui
// (bypassado pelo superuser), então a disciplina de sempre passar o
// tenantId certo é manual e deliberada.
//
//   node scripts/seed-content-demo.mjs
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const THUMBS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../web/public/demo-creatives');

/**
 * Thumbnail SVG simples e explicitamente DEMO — nunca uma tela real de
 * anúncio nem marca de terceiro (o brief proíbe os dois). Cor por negócio,
 * texto do hook, selo "DEMO" — dá pra distinguir os 3 criativos visualmente
 * sem fingir ser um screenshot de Meta Ads real.
 */
function gerarThumbnail(slug, nomeCreative, hook, cor) {
  mkdirSync(THUMBS_DIR, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="${cor}"/>
  <rect width="400" height="300" fill="url(#g)" opacity="0.35"/>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>
  <text x="24" y="240" fill="#fff" font-family="system-ui,sans-serif" font-size="20" font-weight="700">${nomeCreative}</text>
  <text x="24" y="266" fill="#fff" font-family="system-ui,sans-serif" font-size="13" opacity="0.85">${hook.length > 46 ? hook.slice(0, 46) + '…' : hook}</text>
  <rect x="24" y="20" width="62" height="22" rx="11" fill="rgba(255,255,255,0.9)"/>
  <text x="55" y="35" fill="#111" font-family="system-ui,sans-serif" font-size="11" font-weight="700" text-anchor="middle">DEMO</text>
</svg>`;
  writeFileSync(join(THUMBS_DIR, `${slug}.svg`), svg, 'utf8');
}
const prisma = new PrismaClient({ datasources: { db: { url: ADMIN } } });

const DATASET_VERSION = 'content-v1';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Distribuição de horário realista: dias úteis pesam mais, horário comercial predomina. */
function timestampRealista(diasAtras, jitterHoras = 9) {
  const base = Date.now() - diasAtras * DIA_MS;
  const d = new Date(base);
  const dow = d.getDay();
  // Fim de semana existe mas é bem mais raro — se caiu num, ~70% de chance de puxar pra sexta/segunda mais próxima.
  if ((dow === 0 || dow === 6) && Math.random() < 0.7) {
    d.setDate(d.getDate() + (dow === 0 ? 1 : -1));
  }
  const horaComercial = 8 + Math.random() * jitterHoras; // 8h–17h predominante
  d.setHours(Math.floor(horaComercial), Math.floor(Math.random() * 60), 0, 0);
  return d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Divide um total em N parcelas positivas que somam exatamente o total (a matemática tem que fechar). */
function dividirExato(total, n, minimo = 1) {
  if (n <= 0) return [];
  const partes = Array.from({ length: n }, () => minimo);
  let restante = total - minimo * n;
  for (let i = 0; i < n - 1 && restante > 0; i++) {
    const fatia = round2(Math.min(restante, (total / n) * (0.6 + Math.random() * 0.8)));
    partes[i] = round2(partes[i] + fatia);
    restante = round2(restante - fatia);
  }
  partes[n - 1] = round2(partes[n - 1] + restante);
  return partes;
}

/** Distribui uma métrica diária (spend/impressions/clicks…) ao longo de `dias`, weekday-weighted, somando exato. */
function serieDiaria(total, dias) {
  const pesos = Array.from({ length: dias }, (_, i) => {
    const dow = new Date(Date.now() - i * DIA_MS).getDay();
    return dow === 0 || dow === 6 ? 0.35 : 1 + Math.random() * 0.6;
  });
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  const valores = pesos.map((p) => (total * p) / somaPesos);
  // Ajuste de arredondamento no último dia pra bater a soma exata.
  const inteiros = valores.map((v) => Math.round(v));
  const diff = total - inteiros.reduce((a, b) => a + b, 0);
  inteiros[inteiros.length - 1] += diff;
  return inteiros;
}

const STAGES_VENDAS = [
  ['Captação', 0, '#9B4DE0'],
  ['Qualificação', 1, '#7B2FBE'],
  ['Proposta', 2, '#5B1E9E'],
  ['Negociação', 3, '#B7791F'],
  ['Fechado / Ganho', 4, '#1E8449'],
];

/**
 * Cria tenant + owners + funil — mesmo shape do TenantsService.provision
 * real. Diferença deliberada: o dono principal ganha uma Identity+Membership
 * de verdade (login real), porque não existe organization switcher no
 * front hoje (auditado — `membershipsOf()` existe no backend, mas nada no
 * app o consome) e o brief pede explicitamente para não construir UI nova
 * desnecessária. Login direto por credencial é o caminho mais simples e
 * mais seguro permitido pelo próprio brief.
 */
async function provisionarTenant(nome, nicho, demoScenario, senhaDemo, stagesCustom) {
  const tenant = await prisma.tenant.create({
    data: { nome, plano: 'pro', status: 'active', nicho, isDemo: true, demoScenario, datasetVersion: DATASET_VERSION },
  });

  const pipeline = await prisma.pipeline.create({ data: { tenantId: tenant.id, nome: 'Funil de Vendas', tipo: 'vendas' } });
  const stages = [];
  for (const [nomeEtapa, ordem, cor] of stagesCustom ?? STAGES_VENDAS) {
    stages.push(await prisma.stage.create({ data: { tenantId: tenant.id, pipelineId: pipeline.id, nome: nomeEtapa, ordem, cor } }));
  }

  const emailDemo = `demo.${demoScenario.toLowerCase()}@conteudo.orvyn.app`;
  const identity = await prisma.identity.create({
    data: { email: emailDemo, passwordHash: await hash(senhaDemo), emailVerifiedAt: new Date() },
  });
  await prisma.membership.create({ data: { identityId: identity.id, tenantId: tenant.id, role: 'owner', isDefault: true } });

  const owners = [];
  const nomesOwners = ['Lucas Andrade', 'Mariana Souza', 'Pedro Lima'];
  for (let i = 0; i < nomesOwners.length; i++) {
    const nomeOwner = nomesOwners[i];
    owners.push(
      await prisma.user.create({
        data: {
          tenantId: tenant.id, identityId: i === 0 ? identity.id : null,
          email: i === 0 ? emailDemo : `${nomeOwner.split(' ')[0].toLowerCase()}@${demoScenario.toLowerCase()}.demo.khub`,
          nome: nomeOwner, role: i === 0 ? 'owner' : 'member',
        },
      }),
    );
  }
  console.log(`[login] ${nome}: ${emailDemo}`);

  await prisma.activity.create({ data: { tenantId: tenant.id, actor: 'Sistema', acao: 'conta criada e funil provisionado', tone: 'green' } });

  return { tenant, pipeline, stages, owners };
}

/** Cria Integration+AdAccount+AdCampaign+N Creatives — nunca chama Meta real (só grava linhas). */
async function criarCampanha(tenantId, ownerId, spec) {
  const integration = await prisma.integration.create({
    data: {
      tenantId, provider: 'meta_demo', status: 'connected',
      externalBusinessId: `demo-biz-${tenantId.slice(0, 8)}`, connectedBy: ownerId, connectedAt: new Date(), health: 'healthy',
    },
  });
  const account = await prisma.adAccount.create({
    data: { tenantId, integrationId: integration.id, provider: 'meta_demo', externalId: `act_demo_${tenantId.slice(0, 8)}`, name: `${spec.negocio} — Conta de Anúncios`, currency: 'BRL', timezone: 'America/Sao_Paulo' },
  });
  const campaign = await prisma.adCampaign.create({
    data: { tenantId, adAccountId: account.id, externalId: `camp_${tenantId.slice(0, 8)}`, name: spec.campanha, objective: spec.objetivo, status: 'active' },
  });

  const creatives = [];
  for (const c of spec.criativos) {
    gerarThumbnail(`${spec.slug}-${c.slug}`, c.nome, c.hook, spec.cor ?? '#6c2bff');
    const creative = await prisma.adCreative.create({
      data: {
        tenantId, adAccountId: account.id, campaignId: campaign.id,
        externalId: `cr_${tenantId.slice(0, 8)}_${c.slug}`, name: c.nome, format: c.formato,
        body: c.hook, cta: c.cta, thumbnailUrl: `/demo-creatives/${spec.slug}-${c.slug}.svg`, status: 'active',
      },
    });
    creatives.push({ ...c, row: creative });
  }
  return { integration, account, campaign, creatives };
}

/** AdInsight diário — nível creative (fonte da verdade) + nível campaign (soma dos criativos). */
async function seedInsights(tenantId, campaign, creatives, dias = 30) {
  const acAgg = Array.from({ length: dias }, () => ({ spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, revenue: 0 }));

  for (const c of creatives) {
    const spend = serieDiaria(c.spend, dias);
    const impressions = serieDiaria(c.impressions, dias);
    const clicks = serieDiaria(c.clicks, dias);
    const leads = serieDiaria(c.leads, dias);
    const conversions = serieDiaria(c.sales, dias);
    const revenue = serieDiaria(c.revenue, dias);

    for (let i = 0; i < dias; i++) {
      const date = new Date(Date.now() - i * DIA_MS);
      date.setHours(0, 0, 0, 0);
      const s = spend[i], imp = impressions[i], cl = clicks[i], ld = leads[i], cv = conversions[i], rv = revenue[i];
      await prisma.adInsight.create({
        data: {
          tenantId, level: 'creative', provider: 'meta_demo', externalRefId: c.row.externalId, date,
          spend: s, impressions: BigInt(imp), clicks: BigInt(cl), leads: BigInt(ld), conversions: BigInt(cv), revenue: rv,
          ctr: imp > 0 ? round2((cl / imp) * 100) : 0, cpc: cl > 0 ? round2(s / cl) : 0, cpm: imp > 0 ? round2((s / imp) * 1000) : 0,
          reach: BigInt(Math.round(imp * 0.82)), frequency: 1.2,
          roas: s > 0 ? round2(rv / s) : 0, cpl: ld > 0 ? round2(s / ld) : 0, cpa: cv > 0 ? round2(s / cv) : 0,
        },
      });
      acAgg[i].spend += s; acAgg[i].impressions += imp; acAgg[i].clicks += cl; acAgg[i].leads += ld; acAgg[i].conversions += cv; acAgg[i].revenue += rv;
    }
  }

  for (let i = 0; i < dias; i++) {
    const date = new Date(Date.now() - i * DIA_MS);
    date.setHours(0, 0, 0, 0);
    const a = acAgg[i];
    await prisma.adInsight.create({
      data: {
        tenantId, level: 'campaign', provider: 'meta_demo', externalRefId: campaign.externalId, date,
        spend: round2(a.spend), impressions: BigInt(a.impressions), clicks: BigInt(a.clicks), leads: BigInt(a.leads), conversions: BigInt(a.conversions), revenue: round2(a.revenue),
        ctr: a.impressions > 0 ? round2((a.clicks / a.impressions) * 100) : 0, cpc: a.clicks > 0 ? round2(a.spend / a.clicks) : 0, cpm: a.impressions > 0 ? round2((a.spend / a.impressions) * 1000) : 0,
        reach: BigInt(Math.round(a.impressions * 0.8)), frequency: 1.25,
        roas: a.spend > 0 ? round2(a.revenue / a.spend) : 0, cpl: a.leads > 0 ? round2(a.spend / a.leads) : 0, cpa: a.conversions > 0 ? round2(a.spend / a.conversions) : 0,
      },
    });
  }
}

async function jaSemeado(nome) {
  const existente = await prisma.tenant.findFirst({ where: { nome, isDemo: true, datasetVersion: DATASET_VERSION } });
  return existente;
}

/**
 * Agência "Pedro Gabriel" + os 3 tenants demo como ClientAccount. Idempotente
 * por natureza: `agencies.slug` é UNIQUE e `agency_client_accounts` tem
 * UNIQUE(agencyId, tenantId) — rodar de novo não duplica nada, só preenche o
 * que faltar (útil se a seed de negócios rodou de novo depois que a agência
 * já existia). Não recria a agência nem os tenants — só vincula.
 */
async function seedAgencia(senhaDemo, tenantsPorNome) {
  const slug = 'pedro-gabriel';
  let agencia = await prisma.agency.findUnique({ where: { slug } });

  if (!agencia) {
    const email = 'pedro.gabriel@conteudo.orvyn.app';
    let identity = await prisma.identity.findFirst({ where: { email } });
    if (!identity) {
      identity = await prisma.identity.create({ data: { email, passwordHash: await hash(senhaDemo), emailVerifiedAt: new Date() } });
    }
    agencia = await prisma.agency.create({ data: { name: 'Pedro Gabriel', slug, ownerIdentityId: identity.id, isDemo: true } });
    await prisma.agencyMember.create({ data: { agencyId: agencia.id, identityId: identity.id, role: 'owner' } });
    console.log(`[ok] agência "Pedro Gabriel" criada — login: ${email}`);
  } else {
    console.log('[skip] agência "Pedro Gabriel" já existe');
  }

  for (const [nomeTenant, tenant] of Object.entries(tenantsPorNome)) {
    if (!tenant) continue;
    const existe = await prisma.agencyClientAccount.findUnique({ where: { agencyId_tenantId: { agencyId: agencia.id, tenantId: tenant.id } } });
    if (existe) { console.log(`[skip] ${nomeTenant} já é cliente da agência`); continue; }
    await prisma.agencyClientAccount.create({
      data: { agencyId: agencia.id, tenantId: tenant.id, displayName: nomeTenant, status: 'active', isDemo: true },
    });
    console.log(`[ok] ${nomeTenant} vinculado como cliente da agência`);
  }

  // Bootstrap de login: `AuthService.login()` (código pré-existente, não
  // alterado nesta feature) exige >=1 Membership pra autenticar — Agency e
  // AgencyMember são tabelas paralelas, sem tenant algum. Sem isto Pedro
  // nunca consegue logar pra clicar em "Entrar na operação" a primeira vez
  // (ovo-e-galinha: ativarCliente() é uma rota autenticada). Provisiona no
  // PRIMEIRO cliente vinculado, com o mesmo shape que
  // `AgencyService.ativarCliente` criaria de qualquer forma no primeiro
  // acesso real — não é um tenant "extra" sendo inventado, é a mesma
  // provisão lazy só que adiantada para o login funcionar.
  const jaTemMembership = await prisma.membership.findFirst({ where: { identityId: agencia.ownerIdentityId } });
  if (!jaTemMembership) {
    const primeiro = Object.entries(tenantsPorNome).find(([, t]) => !!t);
    if (primeiro) {
      const [primeiroNome, primeiroTenant] = primeiro;
      const identity = await prisma.identity.findUniqueOrThrow({ where: { id: agencia.ownerIdentityId } });
      await prisma.membership.create({ data: { identityId: identity.id, tenantId: primeiroTenant.id, role: 'admin', isDefault: true } });
      await prisma.user.create({
        data: { tenantId: primeiroTenant.id, identityId: identity.id, email: identity.email, nome: 'Pedro Gabriel', role: 'admin' },
      });
      console.log(`[ok] login bootstrap: Pedro Gabriel ganhou acesso inicial a "${primeiroNome}" (necessário pro login funcionar)`);
    }
  } else {
    console.log('[skip] Pedro Gabriel já tem membership de login');
  }
}

export { prisma, provisionarTenant, criarCampanha, seedInsights, timestampRealista, round2, dividirExato, jaSemeado, seedAgencia, DATASET_VERSION };
