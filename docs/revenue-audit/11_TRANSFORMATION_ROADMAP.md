# 11 — Roadmap de Transformação

> Reordenado pelos gaps reais, não pela sequência sugerida no prompt. Convenção do repo: uma sprint por sessão, parar e reportar; decisão estrutural (schema, contrato de API) exige aprovação antes. IDs referem os arquivos 02 a 09.

## Princípio de ordem
1. Antes de qualquer feature: **provar em runtime** (sem isso, as notas são palpite).
2. Depois o que bloqueia a venda para agência de tráfego (Meta, saúde, revogação).
3. Depois operação diária (UI que funciona), depois motor, depois polimento.

## Sprint 0 — Baseline em runtime (pré-requisito)
- Subir Postgres (pgvector) + Redis dedicados do Orvyn via `docker-compose.yml` do repo, aplicar migrations 000 a 027 em banco novo (nada destrutivo; **requer aprovação**, mexe em infra local).
- Rodar `002_isolation_test.sql`, API, worker, web; smoke no navegador dos 8 cenários.
- Estender o teste de isolamento a outbox, agenda, financeiro, tags, meta_pages e tabelas de agência (SEC-15, SEC-02).
- Criar registro de migrations aplicadas.
- Aceite: build web e API verdes, isolamento A×B provado, evidências em `evidence/`.

## Sprint 1 — Segurança de agência e acesso (P0)
- SEC-01: revogar memberships e tokens ao remover membro/arquivar cliente; `revokeAllForIdentity` em uso.
- ARQ-01/A1: member/viewer trocam de cliente conforme permissão.
- A2/A3: pausar/arquivar/editar cliente. RLS nas tabelas de agência + teste A×B.
- Criação de agência fora de seed (decisão estrutural: pedir aprovação).
- Reset e troca de senha; lockout de login; detecção de reuso de refresh (SEC-07/08).
- Aceite: teste automatizado de que ex-membro perde acesso imediatamente.

## Sprint 2 — Integração Meta e WhatsApp confiáveis
- Troca por token de longa duração, refresh e detecção de expiração com status real na UI.
- Seleção explícita de conta/página por tenant; corrigir `UNIQUE(page_id)` (migration com rollback, aprovação).
- `state` OAuth atrelado ao usuário e consumido.
- Evolution: promover para `connected` via `connection.update`; segredo por instância; documentar setup.
- `subscribed_apps`, paginação e rate limit. UI honesta (Instagram/Messenger/Google/TikTok não aparecem como conectados).
- Bloqueio externo: App Review/Business Verification, `META_APP_SECRET`, instância real.

## Sprint 3 — Operação diária sem dev (UI)
- Menu aponta para telas reais (/inbox, /nyro, agenda); remover estados vazios enganosos.
- Ligar ou remover os 72 botões sem ação; corrigir `?aba=` vs `?tab=`.
- Criar/editar funil, etapa e oportunidade; ganho/perda; criar lead pela UI (K-1, K-3, L-4).
- Remover `AdsSimulador` e textos fixos de produção; demo isolado por flag explícita.

## Sprint 4 — Inbox e leads
- Ponte worker→socket (I-1) com teste; não-lidas, busca, filtros, paginação.
- Mídia recebida; status de entrega real (I-3); Activity e `ultimoContatoAt` no inbound.
- CSV, dedupe manual, origem do contato (L-1, L-2, L-3).

## Sprint 5 — Motor de automação
- Webhook de entrada com teste de regressão; ramo de condição sem match; tag com contexto atual.
- Cancelamento de follow-up em mudança de estágio, resposta, opt-out; idempotência de todas as ações.
- Janela de envio para e-mail e "esperar"; opt-out sem falso positivo; SSRF robusto.
- Gatilhos de agendamento, formulário, lead de campanha, inatividade.
- Builder: excluir, duplicar, versões; validação de ramos.

## Sprint 6 — Painel da agência
- Saúde por cliente: integração, última mensagem, automações com erro, oportunidades sem atendimento.
- Métricas corretas (A5, B7). Templates de agência por snapshot com cópia segura entre tenants (decisão estrutural).

## Sprint 7 — Design system e UX
- Unificar tokens (hex literais, 9-11px), foco/Esc em modal, a11y, responsivo 1440 a 390 com screenshots antes/depois.

## Sprint 8 — Performance e confiabilidade
- Paginar `listConversations`, `overview`, `pipeline` (ARQ-04); reconciler por tenant com backoff; DLQ/alerta/retenção do outbox; `trust proxy` e rate limit (SEC-06).

## Sprint 9 — IA
- Após chave Anthropic: validar chat/router/guardrails reais; decidirAcao atômico (C1); RBAC por tool (C2); teto de custo (C3); moldura anti-injection (C4).

## Sprint 10 — E2E comercial e release
- Os 8 cenários end-to-end no navegador, 100 por cento com evidência; testes do web; checklist AGENCY_READY completo.

## Billing
Fora do roadmap até decisão do usuário (mudanças de billing exigem aprovação explícita). Faturamento manual no piloto.
