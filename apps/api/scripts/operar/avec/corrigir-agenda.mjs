// Corrige agendamentos JÁ importados do Avec no formato antigo (título "Serviço · Cliente · Profissional")
// para o formato limpo: título = serviço, servico_id, profissional_id e contato (clientes sem telefone
// criados uma vez por referência "avec:<código>"). Não apaga nada; só mexe em linha ainda sem serviço/profissional.
//
// uso: node corrigir-agenda.mjs --banco qa|neon --tenant <uuid> [--gravar]
//   qa:   docker exec orvyn-qa-pg psql -U postgres -d orvyn_qa
//   neon: docker run postgres:16 psql "$NEON_ADMIN_URL" (variável carregada de deploy/.env.render)
// Sem --gravar roda tudo numa transação e desfaz no fim (ROLLBACK), mostrando os números.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const banco = arg('banco');
const tenant = arg('tenant');
const gravar = process.argv.includes('--gravar');
if (!['qa', 'neon'].includes(banco) || !/^[0-9a-f-]{36}$/i.test(tenant ?? '')) throw new Error('uso: --banco qa|neon --tenant <uuid> [--gravar]');

const agenda = JSON.parse(readFileSync(`${homedir()}/Downloads/avec-export/2026-11-14/khub/agenda.json`, 'utf8'));
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const linhas = agenda.map((a) => {
  const [d, m, y] = a.data.split('/');
  const servico = limpa(a.servico) || 'Atendimento';
  const prof = limpa(a.profissional);
  const cliente = limpa(a.cliente);
  // Títulos que o importador antigo pode ter gerado (com e sem o cliente).
  const t1 = limpa([servico, cliente, prof].filter(Boolean).join(' · ')).slice(0, 200);
  const t2 = limpa([servico, prof].filter(Boolean).join(' · ')).slice(0, 200);
  return [`${y}-${m}-${d} ${a.hora}`, t1, t2, servico.slice(0, 160), prof.slice(0, 120), cliente.slice(0, 200), a.clienteRef ?? ''].map(csv).join(',');
});

const T = `'${tenant}'::uuid`;
let duracoes = '';
try {
  const sv = JSON.parse(readFileSync(`${homedir()}/Downloads/avec-export/2026-11-14/servicos-completo.json`, 'utf8'));
  duracoes = sv.filter((x) => x.duracao).map((x) => `('${String(x.nome).replace(/'/g, "''")}', ${Number(x.duracao)})`).join(',');
} catch { /* sem o arquivo de serviços: não mexe em duração */ }
const sql = `
\\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE m (ini_local text, t1 text, t2 text, servico text, profissional text, cliente text, ref text) ON COMMIT DROP;
\\copy m FROM '/dados/m.csv' WITH (FORMAT csv)
ALTER TABLE m ADD COLUMN inicio timestamptz;
UPDATE m SET inicio = (ini_local::timestamp AT TIME ZONE 'America/Sao_Paulo');
CREATE INDEX ON m (inicio);

-- linhas da agenda ainda no formato antigo que casam com o Avec
CREATE TEMP TABLE alvo ON COMMIT DROP AS
SELECT DISTINCT ON (a.id) a.id, a.contact_id, m.servico, m.profissional, m.cliente, m.ref
FROM agenda_compromissos a JOIN m ON a.inicio = m.inicio AND a.titulo IN (m.t1, m.t2)
WHERE a.tenant_id = ${T} AND a.servico_id IS NULL AND a.profissional_id IS NULL
ORDER BY a.id, (a.titulo = m.t1) DESC, (m.ref LIKE 'avec:%') DESC, m.ref;

INSERT INTO servicos (tenant_id, nome) SELECT DISTINCT ${T}, btrim(servico) FROM alvo WHERE btrim(servico) <> ''
  ON CONFLICT (tenant_id, (lower(btrim(nome)))) DO NOTHING;
INSERT INTO profissionais (tenant_id, nome) SELECT DISTINCT ${T}, btrim(profissional) FROM alvo WHERE btrim(profissional) <> ''
  ON CONFLICT (tenant_id, (lower(btrim(nome)))) DO NOTHING;

-- clientes sem contato: um por referência (reaproveita se já existir)
INSERT INTO contacts (tenant_id, nome, tag, tags, origem, campos_custom)
SELECT DISTINCT ON (ref) ${T}, cliente, 'Lead', ARRAY['importado'], 'importacao', jsonb_build_object('ref_externa', ref)
FROM alvo
WHERE contact_id IS NULL AND ref <> '' AND btrim(cliente) <> ''
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.tenant_id = ${T} AND c.campos_custom->>'ref_externa' = alvo.ref)
ORDER BY ref;

UPDATE agenda_compromissos a SET
  titulo = left(alvo.servico, 200),
  servico_id = s.id,
  profissional_id = p.id,
  contact_id = COALESCE(a.contact_id, c.id),
  updated_at = now()
FROM alvo
LEFT JOIN servicos s ON s.tenant_id = ${T} AND lower(btrim(s.nome)) = lower(btrim(alvo.servico))
LEFT JOIN profissionais p ON p.tenant_id = ${T} AND lower(btrim(p.nome)) = lower(btrim(alvo.profissional))
LEFT JOIN LATERAL (SELECT id FROM contacts c WHERE c.tenant_id = ${T} AND alvo.ref <> '' AND c.campos_custom->>'ref_externa' = alvo.ref LIMIT 1) c ON true
WHERE a.id = alvo.id;

-- duração real: catálogo com a duração do Avec; atendimento que entrou com os 60 min padrão
-- da importação passa a durar o tempo do serviço (só linhas com serviço, que vêm da importação)
CREATE TEMP TABLE d (servico text, duracao int) ON COMMIT DROP;
INSERT INTO d VALUES ${duracoes || "('', 0)"};
UPDATE servicos s SET duracao_min = d.duracao, updated_at = now()
FROM d WHERE s.tenant_id = ${T} AND lower(btrim(s.nome)) = lower(btrim(d.servico)) AND d.duracao BETWEEN 1 AND 1440 AND s.duracao_min <> d.duracao;
UPDATE agenda_compromissos a SET fim = a.inicio + make_interval(mins => s.duracao_min), updated_at = now()
FROM servicos s
WHERE a.tenant_id = ${T} AND a.servico_id = s.id AND a.fim - a.inicio = interval '60 minutes' AND s.duracao_min <> 60;

-- correção não dispara automação (contato criado / compromisso alterado)
UPDATE outbox_events SET status = 'processed', processed_at = now(), last_error = 'correcao_agenda_avec: não dispara automação'
WHERE tenant_id = ${T} AND status = 'pending' AND created_at = now();

SELECT 'linhas corrigidas' AS item, count(*) FROM alvo
UNION ALL SELECT 'contatos criados', count(*) FROM contacts WHERE tenant_id = ${T} AND created_at = now() AND origem = 'importacao'
UNION ALL SELECT 'servicos no catalogo', count(*) FROM servicos WHERE tenant_id = ${T}
UNION ALL SELECT 'profissionais no catalogo', count(*) FROM profissionais WHERE tenant_id = ${T}
UNION ALL SELECT 'agenda com profissional', count(*) FROM agenda_compromissos WHERE tenant_id = ${T} AND profissional_id IS NOT NULL
UNION ALL SELECT 'agenda com contato', count(*) FROM agenda_compromissos WHERE tenant_id = ${T} AND contact_id IS NOT NULL
UNION ALL SELECT 'servicos com duracao do Avec', count(*) FROM servicos WHERE tenant_id = ${T} AND duracao_min <> 30
UNION ALL SELECT 'agenda total', count(*) FROM agenda_compromissos WHERE tenant_id = ${T}
UNION ALL SELECT 'agenda ainda formato antigo (titulo com " · ", sem servico)', count(*) FROM agenda_compromissos WHERE tenant_id = ${T} AND servico_id IS NULL AND titulo LIKE '% · %';
${gravar ? 'COMMIT;' : 'ROLLBACK;'}
`;

// Dados e script vão num diretório montado em /dados (o COPY embutido no stdin
// não termina igual em todas as versões do psql).
const dir = mkdtempSync(`${tmpdir()}/corrigir-agenda-`);
writeFileSync(`${dir}/m.csv`, linhas.join('\n') + '\n');
writeFileSync(`${dir}/script.sql`, sql);
const cmd = banco === 'qa'
  ? ['sh', ['-c', `docker exec orvyn-qa-pg mkdir -p /dados && docker cp "${dir}/m.csv" orvyn-qa-pg:/dados/m.csv && docker cp "${dir}/script.sql" orvyn-qa-pg:/dados/script.sql && docker exec orvyn-qa-pg psql -U postgres -d orvyn_qa -At -F ' | ' -q -f /dados/script.sql`]]
  : ['docker', ['run', '--rm', '-e', 'U', '-v', `${dir}:/dados:ro`, 'postgres:16', 'sh', '-c', 'psql "$U" -At -F " | " -q -f /dados/script.sql']];
const env = { ...process.env };
if (banco === 'neon') {
  const arq = readFileSync(new URL('../../../../../deploy/.env.render', import.meta.url), 'utf8');
  env.U = arq.split('\n').find((l) => l.startsWith('NEON_ADMIN_URL='))?.slice('NEON_ADMIN_URL='.length).trim();
  if (!env.U) throw new Error('NEON_ADMIN_URL não encontrado em deploy/.env.render');
}
const r = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
rmSync(dir, { recursive: true, force: true });
process.stdout.write(r.stdout);
if (r.status !== 0) { process.stderr.write(r.stderr.replace(/postgres(ql)?:\/\/\S+/g, '[url]')); process.exit(r.status ?? 1); }
console.log(gravar ? '\nGRAVADO (COMMIT).' : '\nSIMULAÇÃO (ROLLBACK): nada foi gravado. Use --gravar para aplicar.');
