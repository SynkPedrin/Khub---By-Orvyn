// Complemento da seed content-demo: adiciona leads e vendas de NOVEMBRO
// no tenant "Forma Casa Planejados (DEMO)". Idempotente por marcação de
// origem ('Meta Ads · Novembro') — rodar de novo não duplica.
//
//   node scripts/seed-forma-casa-nov.mjs
import { prisma, timestampRealista, round2 } from './seed-content-demo.mjs';

const ORIGEM_MARCA = 'Meta Ads · Novembro';

const NOMES_LEADS = [
  'Patrícia Gomes', 'Rodrigo Cunha', 'Aline Barbosa', 'Thiago Nogueira', 'Vanessa Ribeiro',
  'Marcelo Teixeira', 'Cristiane Lopes', 'Fábio Monteiro', 'Renata Cardoso', 'Anderson Freitas',
  'Larissa Pinto', 'Gustavo Henrique', 'Mônica Azevedo', 'Felipe Duarte', 'Sabrina Castro',
  'Leonardo Martins', 'Priscila Fonseca', 'Diego Santana',
];

const VENDAS_NOV = [
  { nome: 'Roberta Nascimento', projeto: 'Cozinha completa', valor: 33500, diasAtras: 1 },
  { nome: 'Eduardo Ramos', projeto: 'Dormitório casal + home office', valor: 21900, diasAtras: 2 },
  { nome: 'Tatiana Melo', projeto: 'Sala de estar planejada', valor: 15700, diasAtras: 4 },
  { nome: 'Henrique Duarte', projeto: 'Apartamento completo', valor: 41200, diasAtras: 6 },
  { nome: 'Simone Freire', projeto: 'Cozinha + área gourmet', valor: 27400, diasAtras: 8 },
];

const ABERTOS_NOV = [
  { nome: 'Carla Nogueira', projeto: 'Projeto dormitório', valor: 18300, etapa: 'Proposta', diasAtras: 1 },
  { nome: 'Marcos Paulo', projeto: 'Cozinha planejada', valor: 24600, etapa: 'Negociação', diasAtras: 3 },
];

const telefone = () => `+5511${String(90000000 + Math.floor(Math.random() * 9000000))}`;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { nome: 'Forma Casa Planejados (DEMO)', isDemo: true } });
  if (!tenant) throw new Error('Tenant Forma Casa (DEMO) não encontrado — rode seed-content-demo-run.mjs antes.');

  const jaTem = await prisma.contact.count({ where: { tenantId: tenant.id, origem: ORIGEM_MARCA } });
  if (jaTem > 0) { console.log('[skip] complemento de novembro já aplicado'); return; }

  const pipeline = await prisma.pipeline.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const stages = await prisma.stage.findMany({ where: { tenantId: tenant.id, pipelineId: pipeline.id } });
  const stagePorNome = (nome) => stages.find((s) => s.nome === nome) ?? stages[0];
  const owners = await prisma.user.findMany({ where: { tenantId: tenant.id } });
  const campaign = await prisma.adCampaign.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const creatives = await prisma.adCreative.findMany({ where: { tenantId: tenant.id, campaignId: campaign.id } });

  let ownerIdx = 0;
  const proximoOwner = () => owners[ownerIdx++ % owners.length];
  const criativoAleatorio = () => creatives[Math.floor(Math.random() * creatives.length)];

  // ---- Leads novos de novembro (0–8 dias atrás) ----
  for (const nome of NOMES_LEADS) {
    const diasAtras = Math.floor(Math.random() * 9);
    const creative = criativoAleatorio();
    await prisma.contact.create({
      data: {
        tenantId: tenant.id, nome, telefone: telefone(), tag: 'NEW', origem: ORIGEM_MARCA,
        ownerId: proximoOwner().id, adCampaignId: campaign.id, adCreativeId: creative.id,
        createdAt: timestampRealista(diasAtras), ultimoContatoAt: timestampRealista(Math.max(0, diasAtras - 1)),
      },
    });
  }
  console.log(`[ok] ${NOMES_LEADS.length} leads novos de novembro`);

  // ---- Vendas fechadas em novembro ----
  for (const v of VENDAS_NOV) {
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenant.id, nome: v.nome, telefone: telefone(), tag: 'CLOSED_WON', origem: ORIGEM_MARCA,
        ownerId: proximoOwner().id, adCampaignId: campaign.id, adCreativeId: criativoAleatorio().id,
        createdAt: timestampRealista(v.diasAtras + 6), ultimoContatoAt: timestampRealista(v.diasAtras),
      },
    });
    await prisma.deal.create({
      data: {
        tenantId: tenant.id, titulo: `${v.nome} — ${v.projeto}`, contactId: contact.id,
        pipelineId: pipeline.id, stageId: stagePorNome('Fechado / Ganho').id,
        valor: round2(v.valor), status: 'ganho', origem: ORIGEM_MARCA,
        createdAt: timestampRealista(v.diasAtras + 4), updatedAt: timestampRealista(v.diasAtras),
      },
    });
  }
  const totalVendas = VENDAS_NOV.reduce((s, v) => s + v.valor, 0);
  console.log(`[ok] ${VENDAS_NOV.length} vendas fechadas em novembro (R$ ${totalVendas.toLocaleString('pt-BR')})`);

  // ---- Negócios abertos recentes ----
  for (const a of ABERTOS_NOV) {
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenant.id, nome: a.nome, telefone: telefone(), tag: 'FOLLOW_UP', origem: ORIGEM_MARCA,
        ownerId: proximoOwner().id, adCampaignId: campaign.id, adCreativeId: criativoAleatorio().id,
        createdAt: timestampRealista(a.diasAtras + 3), ultimoContatoAt: timestampRealista(a.diasAtras),
      },
    });
    await prisma.deal.create({
      data: {
        tenantId: tenant.id, titulo: `${a.nome} — ${a.projeto}`, contactId: contact.id,
        pipelineId: pipeline.id, stageId: stagePorNome(a.etapa).id,
        valor: round2(a.valor), status: 'aberto', origem: ORIGEM_MARCA,
        createdAt: timestampRealista(a.diasAtras + 2), updatedAt: timestampRealista(a.diasAtras),
      },
    });
  }
  console.log(`[ok] ${ABERTOS_NOV.length} negócios abertos recentes (Carla, Marcos Paulo)`);
}

main().catch((e) => { console.error('[erro]', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
