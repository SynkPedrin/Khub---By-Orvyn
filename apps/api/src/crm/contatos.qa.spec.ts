import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContatosMassaService } from './contatos-massa.service';
import { ContatosMesclaService } from './contatos-mescla.service';
import { ContatosViewsService } from './contatos-views.service';

/**
 * Integração REAL (Postgres + RLS) da Q2.2 — só roda com o banco de QA:
 *   KHUB_QA_APP_URL=postgresql://khub_app:...@127.0.0.1:55440/orvyn_qa \
 *   KHUB_QA_ADMIN_URL=postgresql://postgres:...@127.0.0.1:55440/orvyn_qa \
 *   npx jest src/crm/contatos.qa.spec.ts
 * App como `khub_app` (sem BYPASSRLS); fixtures pelo superusuário. Os tenants
 * criados ficam no QA (audit_logs é imutável e impede apagar o tenant).
 * Sem as variáveis o bloco é pulado — e o relatório da tarefa diz isso.
 */
const APP = process.env.KHUB_QA_APP_URL;
const ADMIN = process.env.KHUB_QA_ADMIN_URL;
const d = APP && ADMIN ? describe : describe.skip;

d('Q2.2 contra o Postgres de QA (RLS real)', () => {
  let admin: PrismaClient;
  let prisma: PrismaService;
  const A = randomUUID();
  const B = randomUUID();
  const eu = randomUUID();

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: ADMIN! } } });
    process.env.DATABASE_URL = APP;
    prisma = new PrismaService();
    await prisma.$connect();
    await admin.$executeRaw`INSERT INTO tenants (id, nome) VALUES (${A}::uuid, 'IT_Q22_A'), (${B}::uuid, 'IT_Q22_B')`;
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.$disconnect();
  });

  it('mesclar: move negócio, conversa, nota, tarefa, atividade e campanha; sem colisão de índice único; apaga o duplicado', async () => {
    const [p, dup, pl, st, camp] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await admin.$executeRaw`INSERT INTO contacts (id, tenant_id, nome, email, tags, created_at) VALUES
      (${p}::uuid, ${A}::uuid, 'Ana Principal', 'ana@x.com', '{vip}', now() - interval '2 day'),
      (${dup}::uuid, ${A}::uuid, 'Ana Dup', 'ANA@x.com', '{vip,quente}', now() - interval '1 day')`;
    await admin.$executeRaw`UPDATE contacts SET telefone = '+55 11 97777-1234', empresa = 'ACME', opted_out_at = now() WHERE id = ${dup}::uuid`;
    await admin.$executeRaw`INSERT INTO pipelines (id, tenant_id, nome) VALUES (${pl}::uuid, ${A}::uuid, 'Funil')`;
    await admin.$executeRaw`INSERT INTO stages (id, tenant_id, pipeline_id, nome, ordem) VALUES (${st}::uuid, ${A}::uuid, ${pl}::uuid, 'Novo', 0)`;
    await admin.$executeRaw`INSERT INTO deals (tenant_id, titulo, contact_id, pipeline_id, stage_id) VALUES (${A}::uuid, 'Negócio do dup', ${dup}::uuid, ${pl}::uuid, ${st}::uuid)`;
    await admin.$executeRaw`INSERT INTO conversations (tenant_id, nome, contact_id) VALUES (${A}::uuid, 'Conversa dup', ${dup}::uuid)`;
    await admin.$executeRaw`INSERT INTO notes (tenant_id, corpo, contact_id) VALUES (${A}::uuid, 'nota do dup', ${dup}::uuid)`;
    await admin.$executeRaw`INSERT INTO tasks (tenant_id, titulo, contact_id) VALUES (${A}::uuid, 'tarefa do dup', ${dup}::uuid)`;
    await admin.$executeRaw`INSERT INTO campaigns (id, tenant_id, nome) VALUES (${camp}::uuid, ${A}::uuid, 'Camp')`;
    // os DOIS na mesma campanha: mover o do dup violaria (campaign_id, contact_id)
    await admin.$executeRaw`INSERT INTO campaign_enrollments (tenant_id, campaign_id, contact_id) VALUES (${A}::uuid, ${camp}::uuid, ${p}::uuid), (${A}::uuid, ${camp}::uuid, ${dup}::uuid)`;

    const svc = new ContatosMesclaService(prisma);
    const dups = await svc.duplicados(A);
    const g = dups.grupos.find((x) => x.contatos.some((c) => c.id === p))!;
    expect(g.contatos.map((c) => c.id).sort()).toEqual([p, dup].sort());

    const r = await svc.mesclar(A, eu, p, [dup]);
    expect(r.movidos).toMatchObject({ 'deals.contact_id': 1, 'conversations.contact_id': 1, 'notes.contact_id': 1, 'tasks.contact_id': 1 });
    expect(r.movidos['campaign_enrollments.contact_id']).toBeUndefined();

    const [c] = await admin.$queryRaw<{ telefone: string; empresa: string; tags: string[]; opted: boolean }[]>`SELECT telefone, empresa, tags, opted_out_at IS NOT NULL AS opted FROM contacts WHERE id = ${p}::uuid`;
    expect(c).toEqual({ telefone: '+55 11 97777-1234', empresa: 'ACME', tags: ['vip', 'quente'], opted: true });
    const [{ n }] = await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM contacts WHERE id = ${dup}::uuid`;
    expect(n).toBe(0);
    const [{ e }] = await admin.$queryRaw<{ e: number }[]>`SELECT count(*)::int AS e FROM campaign_enrollments WHERE contact_id = ${p}::uuid`;
    expect(e).toBe(1);
    // tag herdada não dispara "tag adicionada" de novo
    const [{ t }] = await admin.$queryRaw<{ t: number }[]>`SELECT count(*)::int AS t FROM outbox_events WHERE tenant_id = ${A}::uuid AND kind = 'contact.tagged' AND payload->>'id' = ${p} AND status = 'pending'`;
    expect(t).toBe(0);
    const [{ a }] = await admin.$queryRaw<{ a: number }[]>`SELECT count(*)::int AS a FROM audit_logs WHERE tenant_id = ${A}::uuid AND acao = 'contacts.merge' AND entidade_id = ${p}`;
    expect(a).toBe(1);
  });

  it('mesclar com id de OUTRO tenant: 404 (RLS), nada muda', async () => {
    const [pa, cb] = [randomUUID(), randomUUID()];
    await admin.$executeRaw`INSERT INTO contacts (id, tenant_id, nome) VALUES (${pa}::uuid, ${A}::uuid, 'A1'), (${cb}::uuid, ${B}::uuid, 'SEGREDO_B')`;
    await expect(new ContatosMesclaService(prisma).mesclar(A, eu, pa, [cb])).rejects.toThrow(/inexistente/);
    const [{ n }] = await admin.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM contacts WHERE id = ${cb}::uuid`;
    expect(n).toBe(1);
  });

  it('massa por filtro: tag em 1.200 contatos numa operação, gatilho de tag por contato, B intocado', async () => {
    await admin.$executeRaw`INSERT INTO contacts (tenant_id, nome, tags) SELECT ${A}::uuid, 'Lote ' || g, '{lote-it}' FROM generate_series(1, 1200) g`;
    await admin.$executeRaw`INSERT INTO contacts (tenant_id, nome, tags) VALUES (${B}::uuid, 'B lote', '{lote-it}')`;
    const r = await new ContatosMassaService(prisma).executar(A, eu, { filtro: { tag: 'lote-it' }, acao: 'tag_add', params: { tag: 'migrado' } });
    expect(r).toEqual({ acao: 'tag_add', alvo: 1200, afetados: 1200, ignorados: 0 });
    const [{ b }] = await admin.$queryRaw<{ b: number }[]>`SELECT count(*)::int AS b FROM contacts WHERE tenant_id = ${B}::uuid AND 'migrado' = ANY(tags)`;
    expect(b).toBe(0);
    const [{ ev }] = await admin.$queryRaw<{ ev: number }[]>`SELECT count(*)::int AS ev FROM outbox_events WHERE tenant_id = ${A}::uuid AND kind = 'contact.tagged' AND payload->>'tag' = 'migrado'`;
    expect(ev).toBe(1200);
    const de2 = await new ContatosMassaService(prisma).executar(A, eu, { filtro: { tag: 'lote-it' }, acao: 'tag_add', params: { tag: 'migrado' } });
    expect(de2.afetados).toBe(0); // idempotente
    const ex = await new ContatosMassaService(prisma).executar(A, eu, { filtro: { tag: 'lote-it' }, acao: 'excluir' });
    expect(ex.afetados).toBe(1200);
  });

  it('listas salvas: compartilhada é do tenant, não vaza para B', async () => {
    const svc = new ContatosViewsService(prisma);
    const v = await svc.criar(A, eu, { nome: 'Quentes', filtros: { tag: 'quente' }, colunas: ['nome', 'tags'], compartilhada: true });
    expect((await svc.listar(A, randomUUID())).map((x) => x.id)).toContain(v.id);
    expect((await svc.listar(B, eu)).map((x) => x.id)).not.toContain(v.id);
    await expect(svc.remover(B, eu, v.id)).rejects.toThrow(/inexistente/);
  });
});
