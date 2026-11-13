---
id: global-operacao-dashboards
titulo: "Dashboards Operacionais — painéis que geram decisão"
descricao: "Framework para construir dashboards em três camadas (estratégico, operacional, tático) que disparam ação, não apenas exibem dados, com as métricas essenciais."
escopo: global
dominio: operacao
framework: "Operational Dashboard Design"
persona_owner: coo-orchestrator
comando_relacionado: kpi
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia]
scope_fit_min_plano: growth
intencoes: [dashboard, kpi, métricas, painel, indicadores, "o que medir", relatório, north star]
fonte: "C-Level Squad / coo-orchestrator"
versao: 1
---

# Dashboards Operacionais — painéis que geram decisão

## Quando usar
Ao definir o que medir e montar painéis que orientem decisões, e não apenas mostrem números bonitos.

## As três camadas
- **Estratégico (dono/board):** 5–7 métricas norte, atualização mensal.
- **Operacional (área):** 10–15 métricas de processo, atualização semanal.
- **Tático (time):** métricas em tempo real para decisões do dia a dia.

## Princípios
- Toda métrica tem um dono que pode influenciá-la.
- Toda métrica tem meta e limite (threshold).
- Status vermelho/amarelo/verde num relance.
- Indicadores antecedentes (leading) valem mais que consequentes (lagging).
- Dashboard deve disparar ação, não só consciência.

## Métricas essenciais
- **Receita:** MRR/faturamento, taxa de crescimento, receita por colaborador.
- **Eficiência:** CAC, LTV, razão LTV:CAC, período de payback.
- **Velocidade:** tempo de ciclo, tempo de resposta, time-to-hire.
- **Qualidade:** NPS, churn, taxa de erro, cumprimento de SLA.
- **Saúde:** runway, burn rate, satisfação e retenção da equipe.

## Aplicação no KHUB
Os dashboards por nicho do KHUB devem seguir estas três camadas: o dono vê o painel estratégico, o time vê o tático em tempo real (inbox, agenda). A Nyro gera insights semanais e alertas de anomalia mirando indicadores antecedentes (ex.: queda de agendamentos antes de virar queda de faturamento).

## Princípio-chave
Você não melhora o que não mede. Construa dashboards (ferramentas de decisão), não relatórios (retrospectiva).
