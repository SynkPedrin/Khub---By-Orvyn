// Teste de isolamento cross-tenant para api_keys + crm_tags (invariante RLS).
// Semeia como superuser (bypassa RLS), depois atua como khub_app (NOBYPASSRLS)
// com app.current_tenant_id = A e prova que A NÃO enxerga dados de B, que não
// grava no escopo de B (WITH CHECK), e que a função de auth acha o tenant certo
// pelo hash. Qualquer vazamento => exit != 0. Ao final: limpa o que semeou.
//
//   node scripts/test-isolation-api-keys.mjs
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const prisma = new PrismaClient({ datasources: { db: { url: ADMIN } } });

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const hashA = sha('orv_live_KEY_DO_A');
const hashB = sha('orv_live_KEY_DO_B');
let falhas = 0;
const check = (cond, msg) => { if (!cond) { falhas++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`); };

async function comTenant(tenant, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE khub_app`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, tenant);
    return fn(tx);
  });
}

try {
  // ---------- limpeza + seed (superuser, ignora RLS) ----------
  await prisma.$executeRawUnsafe(`DELETE FROM api_keys WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM crm_tags WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, nome) VALUES ('${A}','Clinica A') ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, nome) VALUES ('${B}','Escritorio B') ON CONFLICT (id) DO NOTHING`);
  await prisma.$executeRawUnsafe(`INSERT INTO api_keys (tenant_id,name,key_prefix,key_hash) VALUES ('${A}','A','orv_live_a','${hashA}'),('${B}','B','orv_live_b','${hashB}')`);
  await prisma.$executeRawUnsafe(`INSERT INTO crm_tags (tenant_id,name,color) VALUES ('${A}','lead-A','#7B2EFF'),('${B}','lead-B','#10B981')`);
  await prisma.$executeRawUnsafe(`DELETE FROM financeiro_cobrancas WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`INSERT INTO financeiro_cobrancas (tenant_id,descricao,valor_centavos) VALUES ('${A}','cobranca-A',10000),('${B}','cobranca-B',20000)`);
  await prisma.$executeRawUnsafe(`DELETE FROM agenda_compromissos WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`INSERT INTO agenda_compromissos (tenant_id,titulo,inicio,fim) VALUES ('${A}','compromisso-A',now(),now()+interval '1 hour'),('${B}','compromisso-B',now(),now()+interval '1 hour')`);

  console.log('\n== api_keys ==');
  const keysA = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT tenant_id, name FROM api_keys`));
  check(keysA.length === 1 && keysA[0].name === 'A', `tenant A só enxerga a própria chave (viu ${keysA.length})`);

  console.log('\n== crm_tags ==');
  const tagsA = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT name FROM crm_tags`));
  check(tagsA.length === 1 && tagsA[0].name === 'lead-A', `tenant A só enxerga a própria tag (viu ${tagsA.length})`);

  console.log('\n== financeiro_cobrancas ==');
  const cobA = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT descricao FROM financeiro_cobrancas`));
  check(cobA.length === 1 && cobA[0].descricao === 'cobranca-A', `tenant A só enxerga a própria cobrança (viu ${cobA.length})`);

  console.log('\n== agenda_compromissos ==');
  const agA = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT titulo FROM agenda_compromissos`));
  check(agA.length === 1 && agA[0].titulo === 'compromisso-A', `tenant A só enxerga o próprio compromisso (viu ${agA.length})`);

  console.log('\n== WITH CHECK (gravar no escopo de B a partir de A) ==');
  let bloqueou = false;
  try {
    await comTenant(A, (tx) => tx.$executeRawUnsafe(`INSERT INTO crm_tags (tenant_id,name) VALUES ('${B}','invasora')`));
  } catch { bloqueou = true; }
  check(bloqueou, 'A NÃO consegue inserir tag no tenant B (WITH CHECK bloqueia)');

  console.log('\n== função de auth (SECURITY DEFINER) ==');
  const rB = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT * FROM auth_lookup_api_key($1)`, hashB));
  check(rB.length === 1 && rB[0].tenant_id === B, 'auth_lookup_api_key acha o tenant certo pelo hash (mesmo atuando como A)');
  const rNada = await comTenant(A, (tx) => tx.$queryRawUnsafe(`SELECT * FROM auth_lookup_api_key($1)`, sha('nao-existe')));
  check(rNada.length === 0, 'hash inválido não retorna nada');

  // ---------- cleanup ----------
  await prisma.$executeRawUnsafe(`DELETE FROM api_keys WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM crm_tags WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM financeiro_cobrancas WHERE tenant_id IN ('${A}','${B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM agenda_compromissos WHERE tenant_id IN ('${A}','${B}')`);

  console.log(falhas === 0 ? '\n✅ ISOLAMENTO OK — sem vazamento' : `\n❌ ${falhas} falha(s) de isolamento`);
  await prisma.$disconnect();
  process.exit(falhas === 0 ? 0 : 1);
} catch (e) {
  console.error('erro no teste:', e.message);
  await prisma.$disconnect();
  process.exit(1);
}
