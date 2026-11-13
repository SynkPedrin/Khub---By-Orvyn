# Regras de Negócio — KHUB

> Regras por nicho, limites de plano, guardrails da Nyro, segurança/LGPD. Consolida PRD §5, §6, §14, §17 + regras de engenharia do master prompt. Ver [[PRD]] · [[Arquitetura]] · [[Banco]].

---

## 1. Multi-tenancy (nível catastrófico)
- **Toda** tabela de negócio tem `tenant_id NOT NULL`.
- Isolamento por **RLS no Postgres** (1ª camada); aplicação é a 2ª camada.
- Toda query em transação com `SET LOCAL app.tenant_id`. Sem exceção.
- Todo PR que adiciona tabela → policy RLS + teste de isolamento (tenant A lê tenant B → 0 linhas).
- RAG: `tenant_id` em toda query vetorial. Conhecimento do cliente A jamais responde para o cliente B.

## 2. A Nyro é um usuário, não um deus
- A Nyro **nunca escreve direto no banco**. Só age via **tools tipadas** que chamam as **mesmas APIs** com as **mesmas permissões** de um usuário humano.
- Toda ação da Nyro entra em `audit_logs` com `actor: 'nyro'`.
- **Human-in-the-loop obrigatório** em: disparo em massa, alteração de automação ativa, criação/edição de campanha paga, exclusão de dados → fila de aprovação (`POST /v1/nyro/actions/:id/approve`).
- Tools tipadas com schema (Zod), validadas antes da execução.
- Memória em três níveis: conversa · conta · nicho (RAG).

## 3. Guardrails de compliance (nichos regulados)
- Nunca gerar diagnóstico médico. Nunca prometer resultado jurídico. Blocklist de claims proibidos (CFM/OAB).
- Guardrail em **duas camadas**: prompt de sistema **e** validador pós-resposta. Prompt sozinho não é guardrail.
- Toda resposta da Nyro registra internamente as fontes RAG usadas (rastreabilidade para auditoria).

> ⚠️ LACUNA: A blocklist concreta de claims (CFM/OAB), o validador pós-resposta e os limites de gasto não estão especificados no PRD. Definir em F3 com apoio da operação/jurídico; registrar como regra versionada.

## 4. Automações confiáveis
- Execução **event-driven**: gatilho → evento → fila (BullMQ) → worker processa passo.
- **Idempotência obrigatória** em webhooks e workers (chave de deduplicação por evento).
- Estado persistido por run (`workflow_runs` + `workflow_run_steps`): esperas de dias/semanas retomam sem perder contexto.
- Retry exponencial por nó; caminho de fallback (WhatsApp caiu → e-mail); dead-letter queue com alerta.
- Versionamento de workflow: rascunho/publicado, rollback, teste com contato fake.
- **Congelamento em 15 nós em F4** (melhoria proposta #4). Nó novo só com pedido de cliente pagante.

## 5. Segurança e LGPD (PRD §14)
- Dados de saúde e jurídico = **dados pessoais sensíveis**: criptografia em trânsito (TLS 1.3) e em repouso, chaves gerenciadas (KMS), mascaramento em logs.
- RLS no banco + testes de isolamento automatizados **a cada release**.
- Base legal e consentimento registrados por contato; exportação e exclusão (direitos do titular) nativas.
- Retenção configurável de conversas/gravações; anonimização após encerramento de conta.
- Pentest e revisão de dependências antes do GA; SSO/SAML no plano enterprise.
- Segredos: nunca no código, nunca no log. OAuth criptografado por tenant (KMS).

## 6. Regras de código (invioláveis)
- Clean Code + SOLID; funções curtas; sem comentário que explica código ruim.
- TS `strict: true`, zero `any` sem justificativa em PR.
- Validação de entrada em toda rota; erros RFC 7807 + `correlation-id`.
- Rate limiting por tenant e por integração; circuit breaker em conector externo.
- Nenhum módulo importa do interno de outro (só interfaces públicas).
- Nenhuma migração destrutiva sem plano de rollback.
- `localStorage` nunca como fonte de verdade; lógica de negócio não duplicada front/back.

## 6.1 Integrações & credenciais (Ads / Stripe / WhatsApp)
- **Conexão de anúncios é multi-tenant via OAuth:** cada cliente autentica e gera o **próprio token**. O operador só registra os **apps de desenvolvedor** no `.env` (`META_APP_ID/SECRET`, `TIKTOK_APP_ID/SECRET`, `GOOGLE_ADS_*` incl. **Developer Token**) — **o token do cliente nunca vem do `.env`**. Uma "API key genérica" do Google **não serve** para a Google Ads API.
- **Tokens OAuth por tenant criptografados em repouso** (AES-256-GCM) com `INTEGRATIONS_ENCRYPTION_KEY` (32 bytes base64). Nunca em log/código.
- Cada conector implementa o contrato `AdsConnector` (auth/sync/insights/health). Usar a **última versão estável** da API do provider — não hardcodar versão que deprecia; confirmar na doc oficial na implementação.
- Webhooks (**Meta Lead Ads**, **Stripe**) **idempotentes** via `webhook_events` (dedupe por evento). Refresh automático de token; **health da conexão** exposto na UI; circuit breaker + rate limit por tenant/provider.
- **Pré-requisitos EXTERNOS (não são código):** Meta `ads_read`/`ads_management` e **Google Ads Developer Token** exigem **App Review/aprovação** do provider antes de operar em produção. Build e testes usam **mocks** (+ sandbox quando houver); a conexão real fecha o aceite quando as credenciais/aprovações existirem.

## 6.2 Retrieval: semântico atrás de `VOYAGE_API_KEY`, fallback BM25
- A **Anthropic não fornece embeddings.** A busca **semântica** (vetorial, pgvector) fica atrás de `VOYAGE_API_KEY`.
- **Sem a chave → fallback automático para BM25** (`tsvector pt_unaccent`, já funcional). O RAG **nunca quebra** por ausência de Voyage; degrada para lexical.
- **Com a chave →** backfill de embeddings + híbrido (vetorial + BM25 por RRF) + reranker cross-encoder. Toda mudança de chunking/embedding roda `rag:eval` e reporta o delta.
- `ANTHROPIC_API_KEY` liga chat/contextualizer/guardrails da Nyro; **ausente → endpoints da Nyro respondem 501** explicando, sem afetar o resto da plataforma.
- **Alvo de prontidão:** com `.env` completo **exceto** `ANTHROPIC_API_KEY`, todo o resto opera; plugar a chave liga a Nyro **sem alterar código**.

---

## 7. Nichos MVP e subespecialidades

| Nicho | Subespecialidades citadas no PRD | Compliance |
|---|---|---|
| Clínica Médica / Estética | neurologia (ex.) | CFM |
| Advocacia | bancário, previdenciário, trabalhista (ex.) | OAB |
| Contabilidade | fiscal, pessoal, societário | — |
| Agência (fase posterior) | — | — |

**Canal MVP:** WhatsApp — Evolution API primeiro; Cloud API em F5.

### Pipelines e automações prontos por template (PRD §4.1)
Ver tabela completa em [[PRD]] §4.1. Resumo:
- **Clínica Médica:** funis Captação / Agendamento / Pós-consulta / Orçamentos; automações de confirmação, resgate de no-show, follow-up de orçamento, pesquisa de satisfação, reativação.
- **Advocacia:** funis Captação / Análise de viabilidade / Proposta-Contrato / Processos; qualificação do caso pela Nyro, envio de proposta, lembretes de documentos, atualização de status.
- **Contabilidade:** funis Prospecção / Onboarding / Obrigações mensais / Upsell; checklist de onboarding, cobrança recorrente (Stripe/Pix), lembretes de obrigações, NPS trimestral.

---

## 8. Planos e limites (PRD §17)

| Plano | Público | Composição sugerida |
|---|---|---|
| Starter | Profissional solo | 1 usuário, 1 pipeline extra, Nyro com créditos mensais, WhatsApp 1 número |
| Growth | Equipe | 5 usuários, automações ilimitadas, integrações de ads, créditos ampliados |
| Scale / Agency | Agências | Multi-conta, white-label, API, templates próprios, SSO |

- Uso de IA medido em **créditos**; feature flags por plano/tenant.

> ⚠️ LACUNA: valores de preço, número de créditos por plano, conversão crédito↔token, e o modelo de **permissões granulares** (o PRD só cita `role`) não estão definidos. Ver [[PRD]] Anexo A (melhorias #1 e #5).

---

## 9. Métricas norte (PRD §17)
- Ativação: conta provisionada + 1ª integração + 1ª conversa em 24h.
- % de conversas resolvidas pela Nyro.
- Retenção M3, MRR, CAC/LTV, margem de IA por conta.
- Beta (F6): NPS > 50; churn < 10%.
