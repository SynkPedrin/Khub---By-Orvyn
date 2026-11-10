// Runner de migrações com controle de versão (fecha Bugs.md D-08).
//
// Problema real: 28 arquivos em db/ aplicados manualmente via `psql -f`, em
// ordem, sem registro — nada garante que um ambiente novo (ou staging) tenha
// TODAS as migrations, nem detecta se uma já aplicada foi editada depois
// (drift silencioso entre dev/produção).
//
// Solução deliberadamente simples (não troca por Prisma Migrate): mantém o
// padrão já usado em todo o projeto (arquivos .sql crus + `psql -f`, porque
// várias migrations têm função PL/pgSQL com corpo `$$...$$` que ferramentas
// de migration "inteligentes" às vezes recortam mal) e só soma um LEDGER —
// uma tabela que registra o que já rodou, com checksum pra detectar edição
// pós-aplicação.
//
//   node scripts/db-migrate.mjs            # aplica as pendentes
//   node scripts/db-migrate.mjs --status   # só lista estado, não aplica
//   node scripts/db-migrate.mjs --mark-applied  # registra as JÁ aplicadas
//                                                sem rodar de novo (bootstrap
//                                                de um banco que já tem tudo)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Roda um arquivo .sql via `psql -f`. Se o binário não estiver no PATH do
 * host (comum em dev — o Postgres só existe dentro do container), cai pra
 * `docker exec -i <container> psql`, lendo o arquivo por stdin. Produção/CI
 * sempre têm `psql` no PATH (ver db/README.md e o passo do workflow de CI).
 */
function rodarPsql(adminUrl, caminhoSql) {
  const temPsqlLocal = spawnSync('which', ['psql']).status === 0;
  if (temPsqlLocal) {
    execFileSync('psql', [adminUrl, '-v', 'ON_ERROR_STOP=1', '-f', caminhoSql], { stdio: 'inherit' });
    return;
  }
  const target = new URL(adminUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('Instale psql para executar migrações em um banco remoto. O fallback Docker é somente local.');
  }
  if (target.port && target.port !== '5432' && !process.env.PSQL_DOCKER_CONTAINER) {
    throw new Error('Defina PSQL_DOCKER_CONTAINER explicitamente para uma porta local alternativa.');
  }
  const container = process.env.PSQL_DOCKER_CONTAINER ?? 'orvyn-postgres';
  const database = decodeURIComponent(target.pathname.slice(1));
  const sql = readFileSync(caminhoSql);
  execFileSync('docker', ['exec', '-i', container, 'psql', '-U', decodeURIComponent(target.username || 'postgres'), '-d', database, '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', '..', '..', 'db');
const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';

const args = new Set(process.argv.slice(2));
const modoStatus = args.has('--status');
const modoMarcar = args.has('--mark-applied');

function arquivosMigraveis() {
  return readdirSync(DB_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !/isolation|_test/i.test(f))
    .sort();
}

function checksum(caminho) {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex');
}

async function garantirLedger(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await garantirLedger(prisma);

  const aplicadas = await prisma.$queryRawUnsafe('SELECT filename, checksum FROM schema_migrations');
  const porArquivo = new Map(aplicadas.map((r) => [r.filename, r.checksum]));

  const arquivos = arquivosMigraveis();
  const pendentes = [];
  const divergentes = [];

  for (const f of arquivos) {
    const soma = checksum(join(DB_DIR, f));
    if (!porArquivo.has(f)) {
      pendentes.push(f);
    } else if (porArquivo.get(f) !== soma) {
      // Migration já aplicada, mas o arquivo mudou depois — nunca re-roda
      // sozinho (poderia duplicar efeito); só alerta. Humano decide.
      divergentes.push(f);
    }
  }

  if (divergentes.length) {
    console.warn('⚠️  Migrations aplicadas mas com conteúdo alterado desde então (NÃO re-executadas):');
    for (const f of divergentes) console.warn(`   - ${f}`);
  }

  if (modoStatus) {
    console.log(`Aplicadas: ${porArquivo.size} · Pendentes: ${pendentes.length}`);
    for (const f of pendentes) console.log(`  [pendente] ${f}`);
    await prisma.$disconnect();
    return;
  }

  if (modoMarcar) {
    for (const f of arquivos) {
      if (porArquivo.has(f)) continue;
      await prisma.$executeRawUnsafe(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
        f, checksum(join(DB_DIR, f)),
      );
      console.log(`[marcado sem rodar] ${f}`);
    }
    await prisma.$disconnect();
    return;
  }

  if (!pendentes.length) {
    console.log('Nada a aplicar — banco já está na última migration.');
    await prisma.$disconnect();
    return;
  }

  for (const f of pendentes) {
    const caminho = join(DB_DIR, f);
    console.log(`▶ aplicando ${f}`);
    // psql, não Prisma: várias migrations têm função PL/pgSQL com corpo
    // `$$...$$` que drivers "espertos" partem errado em múltiplas queries.
    rodarPsql(ADMIN_URL, caminho);
    await prisma.$executeRawUnsafe(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
      f, checksum(caminho),
    );
  }

  console.log(`✅ ${pendentes.length} migration(s) aplicada(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
