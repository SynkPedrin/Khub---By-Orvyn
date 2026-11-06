# Content-Ready Audit — Agency Mode (3 clientes demo)

Auditoria visual real: login como `pedro.gabriel@conteudo.orvyn.app`, percorridas
todas as 9 telas operacionais para os 3 clientes (Clínica Vitta Prime, Helios
Energia, Forma Casa Planejados) + Agency Home/Clients. Screenshots em
`/private/tmp/claude-501/.../scratchpad/audit/`. Achados abaixo são derivados
de dado real no banco (queries diretas), não de suposição.

## Achado raiz — bloqueia metade do plano

**Contacts e deals têm timestamps históricos realistas (`created_at`/`updated_at`
espalhados em semanas), mas `activities` e `tasks` quase não existem:**

| tenant | contacts | deals | activities | tasks |
|---|---|---|---|---|
| Clínica Vitta Prime | 93 | 22 | 1 | 0 |
| Helios Energia | 93 | 27 | 1 | 0 |
| Forma Casa Planejados | 110 | 16 | 1 | 0 |

A única `activity` existente em cada tenant é o evento de bootstrap
("conta criada e funil provisionado"). Isso significa:

- Dashboard → "Atividade Recente" mostra só o boilerplate de criação da conta.
- Dashboard → "Tarefas de Hoje" mostra sempre "Nada para hoje".
- Nenhuma badge de "sem atividade há N dias" é derivável de forma honesta na
  Pipeline, porque a única fonte de "atividade" que existe é `deals.updated_at`
  (que por si só já é suficiente para ESSA badge específica — confirmado: Bruno
  Martins/AgroVale, Helios, R$96.000, `Negociação`, `updated_at = 2026-09-18`,
  4 dias antes do "hoje" do sistema, 2026-09-22 — o cenário do Módulo 26 do
  brief **já existe no dataset**, só falta a UI expor).
- "Revenue Pulse" e "Next Actions" (módulos 10/11) são **impossíveis de
  construir honestamente** sem gerar `activities`/`tasks` reais correlacionadas
  aos deals existentes.

**Ação (autorizada pela Regra 0 do brief: corrigir dataset, não fake frontend):**
estender `seed-content-demo.mjs` para gerar, por deal/contact já existente,
uma trilha de `Activity` (lead recebido, proposta enviada, follow-up agendado,
venda fechada) e `Task` (follow-ups "hoje", "atrasado", "próximos dias")
coerente com o `updated_at`/stage real de cada deal. Sem isso, nenhum dos
módulos 8–11 pode ser implementado sem inventar dado — o que a Regra 0 proíbe
explicitamente.

## Agency Home (`/agency`)

- Header genérico ("Agência Pedro Gabriel" / "Suas operações, num só lugar."),
  não usa o padrão "Boa tarde, Pedro." que o Dashboard já usa em outro lugar
  do produto — inconsistência de tom.
- KPI grid tem redundância: "Clientes: 3" e "Clientes ativos: 3" comunicam a
  mesma coisa duas vezes. Nenhuma métrica de "ações pendentes" existe (também
  bloqueada pelo achado raiz acima).
- Client cards já mostram leads/negócios/receita reais — bom. Mas não mostram
  sinais de operação ("Pipeline ativo", "Campanha rodando") que o brief pede
  no Módulo 3.
- ~350px de espaço morto abaixo dos cards em viewport 1440×900 — não há
  "Attention Center" nem segunda seção que ocupe esse espaço.

## Dashboard (todos os 3 tenants)

- Hero "Boa tarde, Pedro." + nome do cliente já existe e funciona bem —
  **não precisa de retrabalho**, só precisa que "Atividade Recente"/"Tarefas
  de Hoje" tenham dado real (achado raiz).
- KPI cards (Contatos, Negócios Abertos, Valor em Pipeline, Taxa de Conversão)
  são reais, corretos, por tenant — bom.
- "Crescimento de Receita" mostra "Ainda sem série histórica" — correto/honesto
  dado que não há snapshot histórico de receita; não é um bug, é um empty
  state genuíno. Fora de escopo desta rodada (exigiria um novo modelo de
  série temporal, não coberto pelo brief).
- "Insights da IA ORVYN" vazio — idem, não inventar.

## Pipeline (Helios, amostra)

- Bruno Martins / AgroVale (R$96.000, Negociação, 4 dias parado) está lá,
  real, exatamente o cenário do Módulo 26 — mas o card não expõe nenhuma
  badge "sem atividade há N dias" nem abre um drawer de detalhe ao clicar
  (Módulo 27 não implementado ainda).

## Automações (Helios, amostra)

- Já tem exatamente os 4 fluxos que o brief pede para Solar: "Stalled
  Proposal", "Hot Opportunity", "Proposal Follow-up", "Lead Solar
  Qualification" — nomes, triggers e descrições reais, nada genérico.
  **Já pronto**, não precisa retrabalho de conteúdo.
- "0 execução(ões)" em todas — correto não inventar histórico de runs
  (Módulo 31 já avisa para não fazer isso).

## Campanhas / Criativos (Helios, revisão anterior desta sessão)

- Campanha "Helios | Solar Empresarial | Setembro" com métricas reais
  (Investido, Leads, CPL, ROAS) e 3 criativos com badges "Melhor CPL"/"Maior
  receita atribuída" já implementados numa sessão anterior — mas os
  thumbnails são retângulos de cor sólida (placeholder), não "anúncios reais"
  como o Módulo 16 pede.

## Priorização adotada nesta sessão

Dado o tamanho do brief (54 seções) e que a raiz do problema (falta de
activities/tasks reais) bloqueia vários módulos ao mesmo tempo, a ordem de
execução desta sessão é:

1. Seed: gerar `activities`+`tasks` reais correlacionados aos deals existentes
   (desbloqueia Dashboard Revenue Pulse/Next Actions e badges de pipeline nos
   3 tenants de uma vez).
2. Agency Command Center (Módulos 1–7).
3. Dashboard hero/Revenue Pulse/Next Actions (Módulos 8–11), agora com dado real.
4. Pipeline: badge de inatividade + drawer de detalhe (Módulos 24–27).
5. Criativos: thumbnails reais (Módulo 16).

Os módulos restantes (Conversations, Lead Detail attribution chain,
Analytics redesign, 3 roteiros de gravação, flaky test, regressão final)
ficam documentados como pendentes explícitos ao final da sessão — não serão
declarados prontos sem evidência real, por instrução do próprio brief.
