// Remove exclusivamente tenants `is_demo=true` deste dataset — nunca produção.
//
//   node scripts/seed-content-demo-clean.mjs
import { PrismaClient } from '@prisma/client';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const prisma = new PrismaClient({ datasources: { db: { url: ADMIN } } });
const DATASET_VERSION = 'content-v1';

async function main() {
  const alvos = await prisma.tenant.findMany({ where: { isDemo: true, datasetVersion: DATASET_VERSION }, select: { id: true, nome: true } });
  if (!alvos.length) {
    console.log('Nada para limpar (nenhum tenant is_demo=true deste dataset).');
    return;
  }
  for (const t of alvos) {
    // Identities não pertencem ao tenant (são globais) — apagadas à parte,
    // só as criadas pela seed (via membership neste tenant demo).
    const memberships = await prisma.membership.findMany({ where: { tenantId: t.id }, select: { identityId: true } });
    // `outbox_events` não tem ON DELETE CASCADE a partir de tenants (achado
    // real desta auditoria) — o trigger real de domínio (migration 022)
    // grava eventos genuínos a cada contact/deal/message inserido, então
    // limpar antes do tenant é necessário, não um workaround de bug.
    await prisma.$executeRaw`DELETE FROM outbox_events WHERE tenant_id = ${t.id}::uuid`;
    // `agency_client_accounts` cascade a partir de tenant_id — o vínculo
    // deste cliente com a agência some junto, mas a Agency e o dono
    // (Pedro) NUNCA são tocados aqui (seção 30 do brief).
    await prisma.tenant.delete({ where: { id: t.id } }); // cascade cuida do resto (contacts, deals, ad_*, workflows…)
    for (const m of memberships) {
      // Nunca apagar identidade que é dona de agência ou membro de
      // agência — Pedro tem Membership em cada tenant-cliente (criada por
      // `AgencyService.ativarCliente`), mas sua Identity é uma entidade de
      // AGÊNCIA, não deste tenant. Sem esta checagem, o segundo `demo.clinic`
      // apagaria Pedro por engano — e `agencies.owner_identity_id` tem
      // ON DELETE RESTRICT, então isso quebraria a limpeza inteira em vez de
      // só pular a linha errada.
      const donoDeAgencia = await prisma.agency.findFirst({ where: { ownerIdentityId: m.identityId }, select: { id: true } });
      const membroDeAgencia = await prisma.agencyMember.findFirst({ where: { identityId: m.identityId }, select: { id: true } });
      if (donoDeAgencia || membroDeAgencia) continue;
      await prisma.identity.deleteMany({ where: { id: m.identityId, email: { contains: '@conteudo.orvyn.app' } } });
    }
    console.log(`[removido] ${t.nome} (${t.id})`);
  }
  console.log(`=== ${alvos.length} tenant(s) demo removido(s) — agência Pedro Gabriel preservada ===`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
