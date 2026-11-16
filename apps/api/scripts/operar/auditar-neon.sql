-- AUDITORIA SOMENTE LEITURA — Studio da Beleza / Ritinha (Neon produção)
-- Roda via auditar-neon.mjs (psql em docker, NEON_ADMIN_URL de deploy/.env.render)
\set ON_ERROR_STOP 0
\pset footer off

SELECT '== migrações aplicadas (schema_migrations) ==' AS secao;
SELECT filename FROM schema_migrations ORDER BY filename;

SELECT '== constraint do prompt (agents_instrucoes_chk) ==' AS secao;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'agents_instrucoes_chk';

SELECT '== agenda do Studio (tenant 1cc7e839) ==' AS secao;
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE profissional_id IS NOT NULL) AS com_profissional,
  count(*) FILTER (WHERE servico_id IS NOT NULL) AS com_servico,
  count(*) FILTER (WHERE valor_centavos IS NOT NULL) AS com_valor,
  count(*) FILTER (WHERE contact_id IS NOT NULL) AS com_contato,
  count(*) FILTER (WHERE inicio > now()) AS futuros,
  count(*) FILTER (WHERE servico_id IS NULL AND titulo LIKE '% · %') AS formato_antigo,
  count(*) FILTER (WHERE responsavel_id IS NOT NULL) AS com_responsavel_usuario
FROM agenda_compromissos
WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';

SELECT '== catálogo (db/071) ==' AS secao;
SELECT
  (SELECT count(*) FROM servicos WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8') AS servicos,
  (SELECT count(*) FROM servicos WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND preco_centavos > 0) AS servicos_com_preco,
  (SELECT count(*) FROM profissionais WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8') AS profissionais;

SELECT '== CRM do Studio ==' AS secao;
SELECT
  (SELECT count(*) FROM contacts WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8') AS contatos,
  (SELECT count(*) FROM contacts WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND opted_out_at IS NOT NULL) AS optout,
  (SELECT count(*) FROM conversations WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8') AS conversas,
  (SELECT count(*) FROM conversations WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND atendimento = 'ia') AS conversas_ia,
  (SELECT count(*) FROM conversations WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND atendimento = 'humano') AS conversas_humano,
  (SELECT count(*) FROM messages WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8') AS mensagens;

SELECT '== outbox ==' AS secao;
SELECT status, count(*) FROM outbox_events WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' GROUP BY status ORDER BY 2 DESC;

SELECT '== workflow runs (30d) ==' AS secao;
SELECT w.nome, r.status, count(*)
FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
WHERE r.tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND r.created_at > now() - interval '30 days'
GROUP BY 1, 2 ORDER BY 1, 2;

SELECT '== DLQ ==' AS secao;
SELECT count(*) AS dlq_total FROM workflow_dlq WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';

SELECT '== agent_runs 7d (SLA) ==' AS secao;
SELECT
  count(*) AS runs,
  count(*) FILTER (WHERE status = 'respondido') AS respondidos,
  count(*) FILTER (WHERE status = 'erro') AS erros,
  count(*) FILTER (WHERE status = 'transferido') AS transferidos,
  count(*) FILTER (WHERE status = 'ignorado') AS ignorados,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latencia_ms)) AS p50_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms)) AS p95_ms,
  max(latencia_ms) AS max_ms
FROM agent_runs
WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND created_at > now() - interval '7 days';

SELECT '== entregas (agent_deliveries) 7d ==' AS secao;
SELECT status, count(*), min(created_at) AS primeira, max(created_at) AS ultima
FROM agent_deliveries
WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND created_at > now() - interval '7 days'
GROUP BY status;

SELECT '== definições de campos personalizados ==' AS secao;
SELECT nome, tipo, entidade, arquivado FROM custom_field_defs WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' ORDER BY nome;

SELECT '== aprovações MCP (nyro_actions) ==' AS secao;
SELECT id, tool, status, resumo, created_at, expira_em FROM nyro_actions
WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8' AND status = 'pendente' ORDER BY created_at DESC;

SELECT '== lembretes de agenda ==' AS secao;
SELECT count(*) FILTER (WHERE lembrete_enviado_em IS NOT NULL) AS lembretes_enviados,
       count(*) FILTER (WHERE inicio > now() AND status IN ('agendado','confirmado') AND lembrete_enviado_em IS NULL) AS futuros_sem_lembrete
FROM agenda_compromissos WHERE tenant_id = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
