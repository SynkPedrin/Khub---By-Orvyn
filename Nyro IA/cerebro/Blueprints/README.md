# Blueprints por nicho — Camada de Conhecimento (ADR-0022)

> **F2 destravado.** Playbooks estruturados por nicho: **fato e regra de nicho, versionado** (nunca dado de cliente). Um playbook por nicho. Fonte da verdade em código: **`apps/api/src/blueprints/playbooks.ts`** (tipado). Este doc é o mapa.
>
> **Diferença vs. o modelo GHL (snapshot+delta):** o KHUB é plataforma **nativa** — o provisionamento cria pipeline/etapas/automações **no próprio CRM** (`BlueprintService.aplicar`), não injeta numa subconta externa. Não existe camada "GHL API vs snapshot vs manual" aqui.

## Arquitetura (4 camadas, fronteiras rígidas)
1. **Conhecimento** — os playbooks (`playbooks.ts`). O moat: cada nicho novo curado compõe.
2. **Composição** — a Nyro (orquestrador multi-agente) customiza a linguagem a partir do playbook.
3. **Provisionamento** — `BlueprintService.aplicar()`: cria funil+etapas (via `CrmService.createPipeline`) e instala automações (via `MarketplaceService`). Idempotente por `tenant.templateId`.
4. **Governança** — guardrails de compliance como **restrição dura** + gate de completude (`dadosObrigatorios`).

## Schema do playbook (ver o tipo `Playbook` em código)
`id · nome · familia · versao · cnae · orgaoRegulador · tier(1-3) · funilNome · etapas[] · qualificacao[] · objecoes[{objecao,angulo1,angulo2,retirada}] · automacoes[] · compliance{proibicoes,termosBloqueados,disclaimers} · dadosObrigatorios[{chave,bloqueiaPublicacao}] · tom`

- **`etapas`** vira o pipeline no CRM. **`objecoes`** sempre com 2 ângulos + retirada elegante.
- **`compliance`** e **`dadosObrigatorios`** são os blocos de governança (tier 3 = restrição dura).

## Nichos MVP (implementados)
| Blueprint | Família | Órgão | Tier | Etapas |
|---|---|---|---|---|
| `saude.odontologia` | Saúde regulada | CFO/CRO | **3** | Novo lead → Qualificado → Aguardando pagamento → Agendado → Compareceu |
| `juridico.advocacia` | Serviço regulado | OAB (Prov. 205/2021) | **3** | Novo lead → Triagem → Consulta → Proposta/contrato → Cliente |
| `contabil.escritorio` | Serviço regulado | CFC | **2** | Novo lead → Diagnóstico → Proposta → Onboarding → Cliente ativo |

## Compliance comparado (por que o schema flexa trocando um bloco)
| | Médico/Odonto (CFM/CFO) | Advocacia (OAB) | Contábil (CFC) | Varejo (CDC) |
|---|---|---|---|---|
| Promessa de resultado | Proibida | Proibida | Evitar | Permitida com lastro |
| Preço como chamariz | Sem apelo | Vedado | Permitido s/ engano | Livre |
| Urgência/escassez | Proibida | Proibida | Desaconselhada | Real permitida |
| Gate humano Fase 1 | Sempre | Sempre | Sempre | Opcional |

Tier 3 → guardrails entram no gerador/validador como **restrição dura** (o Revisor rejeita se violado), nunca sugestão.

## Como pluga no motor
- **API:** `GET /v1/blueprints`, `GET /v1/blueprints/sugerido` (pelo `nicho` do tenant), `POST /v1/blueprints/:key/aplicar`.
- **Nyro:** tool `aplicar_blueprint(blueprint)` (sensível → aprovação humana) — no onboarding, a Nyro descobre o nicho e aplica.
- **Idempotência:** `tenant.templateId`/`templateVersion` registram o que foi aplicado.

## Próximo (o loop que compõe = moat)
- **Onboarding conversacional** (a tela vazia que chama a Nyro → descobre nicho → `aplicar_blueprint`).
- Guardrails do playbook ligados ao **validador pós-resposta** da Nyro (por nicho, não só o global CFM/OAB).
- `metricas.benchmarks` nascem vazios; preenchem com os primeiros clientes reais.
- Novos nichos (médico por especialidade, estética com médico responsável, varejo) — cada um curado vira playbook.
