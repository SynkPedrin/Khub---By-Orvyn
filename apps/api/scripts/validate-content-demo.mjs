// Read-only V3 preflight. No seeding, external providers, or credentials in output.
// Run from apps/api: node --env-file=.env scripts/validate-content-demo.mjs
import { PrismaClient } from '@prisma/client';
const targets = {
  CLINIC: { leads: 41, won: 6, revenue: 21700, spend: 2460, campaigns: 1, appointments: 14 },
  SOLAR: { leads: 37, won: 2, revenue: 80300, spend: 4420, campaigns: 2, appointments: 12 },
  PLANNED_FURNITURE: { leads: 34, won: 2, revenue: 38300, spend: 2180, campaigns: 1, appointments: 9 },
};
const prisma = new PrismaClient({datasources:{db:{url:process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL}}});
let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: actual=${actual}, expected=${expected}`);
}
try {
  // Repeatable, database-enforced read-only snapshot; never consumes jobs.
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const agencies = await tx.agency.findMany({where:{isDemo:true},include:{clientAccounts:true}});
    const agency = agencies.find(a => ['Pedro Gabriel','Agência Pedro Gabriel'].includes(a.name));
    check('agency exists', Boolean(agency), true);
    for (const [scenario,target] of Object.entries(targets)) {
      const tenants = await tx.tenant.findMany({where:{isDemo:true,demoScenario:scenario}});
      check(`${scenario}: unique existing tenant`,tenants.length,1);
      if (tenants.length !== 1) continue;
      const tenant = tenants[0], where = {tenantId:tenant.id};
      await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      console.log(`\n${tenant.nome}`);
      check('agency association',Boolean(agency?.clientAccounts.some(c=>c.tenantId===tenant.id && c.isDemo)),true);
      const contacts = await tx.contact.findMany({where,select:{id:true,adCampaignId:true,adCreativeId:true}});
      const deals = await tx.deal.findMany({where});
      const campaigns = await tx.adCampaign.findMany({where});
      const creatives = await tx.adCreative.findMany({where});
      const stages = await tx.stage.findMany({where});
      const appointments = await tx.agendaCompromisso.count({where});
      const insights = await tx.adInsight.aggregate({where:{...where,level:'campaign'},_sum:{spend:true,revenue:true,leads:true}});
      const won = deals.filter(d=>d.status==='ganho');
      const revenue = won.reduce((sum,d)=>sum+Math.round(Number(d.valor)*100),0)/100;
      check('contacts',contacts.length,target.leads);
      check('won',won.length,target.won);
      check('closed revenue BRL',revenue,target.revenue);
      check('campaign spend BRL',Number(insights._sum.spend??0),target.spend);
      check('campaign count',campaigns.length,target.campaigns);
      check('creative count',creatives.length,3);
      check('appointments',appointments,target.appointments);
      check('ad leads equal actual contacts',Number(insights._sum.leads??0),contacts.length);
      check('ad revenue equal closed revenue',Number(insights._sum.revenue??0),revenue);
      check('deal contact/stage/pipeline ownership',deals.every(d=>(!d.contactId || contacts.some(c=>c.id===d.contactId)) && stages.some(s=>s.id===d.stageId && s.pipelineId===d.pipelineId)),true);
      check('contact attribution ownership',contacts.every(c=>(!c.adCampaignId || campaigns.some(a=>a.id===c.adCampaignId)) && (!c.adCreativeId || creatives.some(a=>a.id===c.adCreativeId && a.campaignId===c.adCampaignId))),true);
      check('appointments contact ownership',(await tx.agendaCompromisso.findMany({where})).every(a=>!a.contactId || contacts.some(c=>c.id===a.contactId)),true);
    }
  },{isolationLevel:'RepeatableRead',timeout:30000});
  console.log(`\n${failures} validation failures. This is a preflight, not E2E or proof of RLS/no-external-IO.`);
  if (failures) process.exitCode=1;
} finally {
  await prisma.$disconnect();
}
