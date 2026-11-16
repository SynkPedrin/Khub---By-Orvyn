# CAROL — Implantação, testes e pendências

> Sessão de 2026-11-16. Ambiente de referência: **banco de dev local** (`localhost/orvyn`).
> Nada foi publicado em produção (Neon/Render) nem alterado na subconta errada.
> Artefatos: `01_PROMPT_CAROL.md` (fonte das instruções) · `02_CONFIGURACAO_CAROL.json` (export do banco) · `conhecimento/` (base RAG).

## Status por item (critério do prompt master)

| Item | Status |
|---|---|
| Subconta correta identificada (`c5b82d42` — Dra. Bárbara Lopes; **não** é a Studio da Beleza) | IMPLEMENTADO E TESTADO |
| Prompt final da Carol (instruções estruturadas, 7.496 chars) | CONFIGURADO EM RASCUNHO (dev) |
| 31 Custom Fields `carol_*` (contact) | IMPLEMENTADO E TESTADO (dev) |
| Custom Values → equivalente real: `settings.operacao` (preços/durações/políticas centralizados) + base RAG | IMPLEMENTADO E TESTADO (dev); **Pix pendente de dados oficiais** |
| Pipeline "Comercial — Tricologia (Carol)" com 10 etapas | IMPLEMENTADO (dev); migração dos deals existentes **não** feita (decisão do operador) |
| Agenda real nas ferramentas da IA (faixas 07:40–11:00 / 14:00–19:00, seg–sex; grade 20 min; limites 17:20/17:40/18:20) | IMPLEMENTADO E TESTADO |
| Sinal Pix: `registrar_sinal_pix` + `verificar_sinal` (cobrança no financeiro; confirmação só por conciliação autorizada — equipe ou webhook Stripe futuro) | IMPLEMENTADO E TESTADO (dev); **gateway Pix automático = BLOQUEADO POR DEPENDÊNCIA** |
| Remarcar/cancelar com política (1 remarcação, 24h de antecedência) | IMPLEMENTADO E TESTADO |
| Follow-ups: 5 estratégias ativas (cadências 2h/20h/72h etc.) + 3 inativas por exigir opt-in | CONFIGURADO (dev); engine já existente e testada; **nenhum envio real executado** |
| Guardrail CFM (camada 2) ativado via nicho "Clínica médica" | IMPLEMENTADO E TESTADO |
| Motor de memória/contexto (3 níveis) e perfil conversacional | JÁ EXISTIA no KHUB — reutilizado, sem duplicar |
| WhatsApp oficial (janela 24h/templates) | PROPOSTO, NÃO IMPLEMENTADO — canal atual é Stevo (não oficial, decisão anterior do produto) |
| Testes conversacionais com LLM real (cenários 1–14) | BLOQUEADO POR DEPENDÊNCIA: sem `ANTHROPIC_API_KEY` neste ambiente; cenários prontos para rodar no simulador/avaliação |
| Publicação em produção | AGUARDANDO APROVAÇÃO |

## Evidências de teste (2026-11-16, dev)

- **Unit:** `agents.spec.ts` + `booking.spec.ts` = 71/71 verdes (14 novos: remarcar/cancelar, sinal Pix, limites de slot da clínica). Suíte completa da API: **1535 verdes / 119 suítes**.
- **E2E no banco real** (`scripts/operar/carol-e2e.mjs`, contato descartável criado e removido): **14/14 PASS** — sinal criado sem chave inventada; comprovante não confirma; conciliação manual libera agendamento com saldo correto (R$ 300 particular); slots reais; choque recusado; 1h40 às 17:40 recusada; almoço recusado; 1ª remarcação passa, 2ª vai para a equipe; cancelamento; base indexada (5 docs, 20 chunks, published); nicho CFM ativo.
- **RAG** (`carol-prova-rag.mjs`): 4 perguntas reais de paciente retornam os documentos certos.
- **Idempotência do instalador:** `carol-configurar.mjs` rodado 4× — campos/docs/pipeline/regras não duplicam (dedupe por hash/upsert/match por nome).

## Achados da auditoria (corrigidos nesta sessão)

1. **Guardrails médicos estavam DESLIGADOS** (tenant sem `nicho`) — corrigido: `nicho="Clínica médica"`, `subespecialidade="Tricologia"`.
2. **Carol sem versão publicada** vivia na linha `agents` (edição = produção). Mantido assim de propósito até a homologação; publicar cria o snapshot congelado.
3. **Grade de slots por duração escondia o último horário do dia** (consulta de 80 min não podia começar 17:40). `calcularSlots` ganhou `passoMin` opcional (padrão antigo preservado nas páginas públicas); as ferramentas da IA usam grade de 20 min.
4. **Banco de dev 4 migrations atrás** (070, 070b, 071, 072) — aplicadas com o runner oficial (`db-migrate.mjs`), ledger registrado.
5. Scripts operacionais que saíam cedo matavam a indexação da base (fila in-process é fire-and-forget) — instalador agora termina limpo e `carol-reindex.mjs` espera a indexação.

## Pendências externas (bloqueiam go-live)

1. **Chave Pix oficial, titular e instruções** → preencher `settings.operacao.pix` (sem isso a Carol registra a cobrança mas a equipe envia os dados — comportamento já implementado e testado).
2. **`ANTHROPIC_API_KEY`** no ambiente para testes conversacionais com modelo real (simulador + cenários de avaliação).
3. **Produção (Neon/Render):** rodar `db-migrate.mjs` (070–072), deploy da API/worker com este código e rodar `carol-configurar.mjs --aplicar` apontando para produção.
4. **Homologação da Dra. Bárbara:** durações (80/100/40), expressões aprovadas, política financeira de cancelamento/reembolso do sinal (não existe regra escrita — a Carol encaminha à equipe), telefone da equipe para notificações.
5. **Decisão do operador:** migrar deals existentes do "Funil de Vendas" para o novo pipeline? Não feito (não destrutivo por padrão).
6. **Aprovação de agendamento:** `solicitar_agendamento` está em `exigirConfirmacao` (equipe aprova no painel a cada agendamento da IA). Remover da lista quando a operação for validada em homologação.

## Rollback (tudo reversível, nada destrutivo foi feito)

- **Agente:** pausar Carol (`status=pausado`) devolve as conversas para humanos. Restaurar instruções/config anteriores: versão anterior está no histórico (não havia versão publicada; o estado anterior era o formulário cru — registrado em `/tmp` e no git desta sessão via `dump-carol.mjs` se necessário regravar).
- **Pipeline/campos/base:** aditivos — arquivar o pipeline e os campos `carol_*` (soft) ou desvincular os documentos da agente; nada disso apaga dados existentes.
- **Código:** reverter os commits dos arquivos `agents/catalogo.ts`, `agents/agent-tools.service.ts`, `agents/config/operacao.ts`, `agents/agents.module.ts`, `booking/booking.schema.ts`, `financeiro/financeiro.service.ts`, `agents/agents.spec.ts`. As ferramentas novas são opt-in por agente: sem `ferramentas` atualizada, o código novo fica inerte.
- **Migrations 070–072 (dev):** já eram devidas (drift do ambiente); produção já as tem.

## Como operar

```bash
cd apps/api
node --env-file=.env scripts/operar/inspecionar-barbara.mjs     # auditoria read-only da subconta
node --env-file=.env scripts/operar/dump-carol.mjs              # dump da config da Carol
node --env-file=.env scripts/operar/carol-configurar.mjs        # dry-run da configuração
node --env-file=.env scripts/operar/carol-configurar.mjs --aplicar
node --env-file=.env scripts/operar/carol-reindex.mjs           # reindexar base e aguardar
node --env-file=.env scripts/operar/carol-e2e.mjs               # E2E (cria e remove contato de teste)
node --env-file=.env scripts/operar/carol-prova-rag.mjs         # prova de recuperação da base
node --env-file=.env scripts/operar/carol-exportar-config.mjs   # exporta 02_CONFIGURACAO_CAROL.json
```
