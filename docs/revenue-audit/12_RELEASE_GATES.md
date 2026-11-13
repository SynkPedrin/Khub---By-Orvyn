# 12 — Release Gates

Estado em 2026-10-14 (após a Sprint 0). Legenda: PASS, FAIL, BLOCKED (depende de infra ou credencial), NOT_EXECUTED, NOT_EXIST.

## Gates técnicos (atualizado na Sprint 0, 2026-10-14)

| Gate | Estado | Observação |
|---|---|---|
| Typecheck API | PASS | |
| Typecheck web | PASS | |
| Lint web | PASS (0 erros, 3 warnings) | 2× `<img>`, 1× deps de `useCallback` |
| Testes API (jest) | PASS 304/304, 37 suítes | `MOCK_TEST`: não provam integração |
| Testes web (vitest) | PASS 18/18, 4 arquivos | Novos na Sprint 0 (antes: não existiam) |
| Build API | PASS | |
| Build web | PASS | usar `NEXT_DIST_DIR` e `env -u NODE_ENV` fora do dev |
| Migrations 000–027 em banco limpo | PASS 28/28, idempotentes | Banco de QA isolado |
| Isolamento RLS: `002` (RAG) | PASS | |
| Isolamento RLS: matriz como `khub_app` | PASS 122/122 | 13 das 51 tabelas com `tenant_id` |
| Isolamento entre agências A×B (API) | PASS 14/15 | falha = SEC-01 (revogação) |
| Isolamento por RLS das tabelas de agência | NOT_EXIST | tabelas sem RLS (SEC-02) |
| Worker startup e reinício no meio de espera | PASS | |
| Cenários de runtime (8) | 4 PASS · 4 PASS_COM_LACUNAS · 0 FAIL | ver 13 §6 |
| Smoke no navegador (1440/768/390) | PASS 10/10, 55 páginas | ver 15 |
| Teste de segurança: rate limit | FAIL → corrigido parcialmente | RT-04 / B-RT-04 |
| Teste de segurança: SSRF, segredos de webhook, auth, lockout | NOT_EXECUTED | |
| E2E de integrações externas reais | NOT_EXECUTED (EXTERNAL_BLOCKER) | sem credenciais, por desenho |
| Teste de carga / volume | NOT_EXECUTED | |
| Acessibilidade | NOT_EXECUTED | |

Ainda **não** se pode declarar "100% green": há gates `NOT_EXECUTED` e um `FAIL` parcial.

## Gates de release por nível

### Piloto fechado (1 a 2 clientes, acompanhado)
- [x] Sprint 0 completo (runtime + isolamento provado em 13 tabelas e na API)
- [ ] SEC-01 corrigido
- [ ] Recuperação de senha
- [ ] WhatsApp Evolution recebendo e mostrando mensagem real em instância real
- [ ] Sem `AdsSimulador` nem dados fictícios em produção
- [ ] Kanban: criar funil/oportunidade pela UI

### Beta com agências (até 5 clientes)
- [ ] Sprint 1 e 2 completos
- [ ] Painel de saúde por cliente
- [ ] Meta Lead Ads com seleção por cliente e renovação de token
- [ ] Inbox em tempo real
- [ ] Follow-up cancela em resposta e mudança de estágio

### AGENCY_READY
- [ ] Todos os 19 itens da seção 19 do prompt, verificados com evidência
- [ ] Todos os gates técnicos PASS
- [ ] Zero issue P0 e P1 abertos de segurança

## Bloqueios externos (não são defeito de código)
- WhatsApp: instância e QR reais; payload Evolution nunca visto ao vivo.
- Meta: App Review, Business Verification, `META_APP_SECRET`.
- IA: `ANTHROPIC_API_KEY`, chave Voyage.
- E-mail: SMTP/Resend para convites.
- Infra: Postgres e Redis do KHUB rodando.
- Google Ads: developer token.

## Ações que exigem aprovação explícita (não executadas)
Subir Postgres/Redis em Docker e aplicar migrations, migration de `UNIQUE(page_id)`, mudanças de billing, criação de agência fora de seed, qualquer envio de mensagem externa ou uso de credencial real.
