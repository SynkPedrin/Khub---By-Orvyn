/**
 * Verificação de SQL contra o Postgres REAL.
 *
 * Existe porque três bugs seguidos passaram por mocks e só apareceram no banco:
 *  - BUG-007: `rag_search_hybrid` não resolvia (número JS vira bigint no driver);
 *  - BUG-012: `right(text, bigint)` não existe — mesma armadilha, query nova;
 *  - BUG-009: cursor comparado em JS perdia microssegundos do timestamptz(6).
 *
 * Mock de Prisma aceita qualquer tipo; o Postgres não. Este script roda as
 * queries cruas do código contra o banco e falha se alguma não resolver.
 *
 * Uso: node scripts/verificar-sql.mjs   (precisa de DATABASE_URL)
 */
import { PrismaClient } from '@prisma/client';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const prisma = new PrismaClient();
let falhas = 0;

const checar = async (nome, fn) => {
  try {
    await fn();
    console.log(`  ok    ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHA ${nome}\n        ${String(e.message).split('\n').find((l) => l.includes('ERROR')) ?? e.message}`);
  }
};

await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;

  // BUG-012 (parte 1): right(text, bigint) não existe → 42883
  // BUG-012 (parte 2): '\D' em template literal do JS vira 'D' — a query roda,
  // apaga a letra D e não acha ninguém. Por isso aqui não basta "não explodiu":
  // é preciso provar que a normalização REALMENTE tira a máscara.
  await checar('telefone: normalização tira máscara (não só "roda")', async () => {
    const [{ normalizado }] = await tx.$queryRaw`
      SELECT right(regexp_replace(${'+55 11 97777-1234'}, '[^0-9]', '', 'g'), ${8}::int) AS normalizado`;
    if (normalizado !== '77771234') {
      throw new Error(`ERROR: normalização devolveu "${normalizado}", esperado "77771234" (a barra do \\D foi comida pelo JS?)`);
    }
  });

  // BUG-007: função com bigint/unknown não resolve
  await checar('rag_search_lexical(text, text, text, text[], int)', async () => {
    await tx.$queryRawUnsafe(
      `SELECT * FROM rag_search_lexical($1::text, $2::text, $3::text, $4::text[], $5::int)`,
      'teste', 'medico', null, ['global'], 5,
    );
  });

  await checar('roteamento: resolve_tenant_by_stevo_instance', async () => {
    await tx.$queryRaw`SELECT resolve_tenant_by_stevo_instance(${'qualquer'})`;
  });
  await checar('roteamento: resolve_tenant_by_meta_page', async () => {
    await tx.$queryRaw`SELECT resolve_tenant_by_meta_page(${'qualquer'})`;
  });
  await checar('roteamento: resolve_workflow_by_webhook_key', async () => {
    await tx.$queryRaw`SELECT * FROM resolve_workflow_by_webhook_key(${'qualquer'})`;
  });
  await checar('audit_logs: insert com payload jsonb', async () => {
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, acao, entidade, payload)
      VALUES (${TENANT}::uuid, 'sistema', 'sql.check', 'teste', ${JSON.stringify({ ok: true })}::jsonb)`;
  });

  throw new Error('ROLLBACK_PROPOSITAL'); // não deixa resíduo
}).catch((e) => {
  if (!String(e.message).includes('ROLLBACK_PROPOSITAL')) {
    console.error('erro na transação:', e.message);
    falhas++;
  }
});

await prisma.$disconnect();
console.log(falhas ? `\n${falhas} query(s) quebrada(s) contra o banco real.` : '\nTodas as queries resolvem no Postgres real.');
process.exit(falhas ? 1 : 0);
