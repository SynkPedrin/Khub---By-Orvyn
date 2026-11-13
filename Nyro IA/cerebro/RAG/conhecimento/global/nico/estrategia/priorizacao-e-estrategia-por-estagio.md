---
id: global-nico-estrategia-priorizacao-e-estrategia-por-estagio
titulo: "Priorização e estratégia por estágio de faturamento e orçamento"
descricao: "Score de prioridade com 6 fatores, pipeline de seleção de estratégia e o que fazer em cada faixa de faturamento e de verba de aquisição."
escopo: global
dominio: estrategia
framework: "Score de prioridade + seleção de estratégia por estágio e orçamento"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [o que priorizar primeiro, qual estratégia usar, tenho pouco dinheiro para anunciar, quanto investir em anúncio, como sair de 10 mil por mês, como crescer de 50 mil para 100 mil, matriz de priorização, escolher entre várias ideias]
fonte: "Orvyn OS Cerebro/conhecimento (DECISION-ENGINE: engine, strategy-selection, stage-strategies, budget-strategies)"
versao: 1
---

# Priorização e estratégia por estágio de faturamento e orçamento

Depois do diagnóstico, sempre sobram várias ideias boas. Este documento mostra como a NICO decide qual vem primeiro (score de prioridade), como filtra estratégias pelo contexto e o que costuma funcionar em cada faixa de faturamento e de verba. Diagnóstico em [[global/nico/estrategia/diagnostico-de-negocio]].

## Score de prioridade: os 6 fatores

Quando existem de 2 a 7 opções candidatas, a NICO pontua cada uma de 1 a 5 em:

| Fator | Pergunta | Peso |
|---|---|---|
| Impacto | Quanto mexe na métrica-norte? | +0,30 |
| Urgência | Há prazo, sangramento de caixa ou janela de mercado? | +0,15 |
| Velocidade | Em quanto tempo aparece o primeiro sinal? | +0,15 |
| Esforço | Horas de trabalho e complexidade | -0,15 |
| Custo | Dinheiro necessário | -0,10 |
| Risco | Prejuízo se falhar, incluindo risco regulatório e de marca | -0,15 |

Fórmula:

```
score = (Impacto x 0,30 + Urgência x 0,15 + Velocidade x 0,15)
      - (Esforço x 0,15 + Custo x 0,10 + Risco x 0,15)
normalizar para 0 a 100
```

Regras do score de prioridade:
- Empate (diferença menor que 5 pontos): desempata pelo menor risco; persistindo, pelo menor custo.
- Trava regulatória: se o risco é 5 por motivo legal ou de conselho profissional (CFM, CFO, OAB, CFC), a opção fica bloqueada até parecer profissional, independente do score.
- Estimativa sem base vira `[ESTIMATIVA]` com o racional.
- Registrar as notas dadas: a decisão precisa ser auditável e revista depois do resultado real.

## Exemplo hipotético de priorização

Clínica odontológica, gargalo em conversão, três opções:

| Opção | Imp | Urg | Vel | Esf | Custo | Risco | Leitura |
|---|---|---|---|---|---|---|---|
| Agente IA respondendo em menos de 5 min | 5 | 4 | 5 | 2 | 2 | 2 | Alta prioridade |
| Follow-up de orçamentos parados | 4 | 4 | 5 | 2 | 1 | 1 | Alta prioridade |
| Dobrar verba no Meta Ads | 3 | 3 | 4 | 1 | 5 | 3 | Baixa: amplifica conversão ruim |

A NICO recomendaria as duas primeiras juntas (baixo esforço, alto impacto) e só depois revisaria a verba. Alternativas conhecidas ao score: ICE (Impacto, Confiança, Facilidade) para times que testam muito, e RICE (Alcance, Impacto, Confiança, Esforço) quando o alcance varia muito entre opções. Use o mais simples que resolve.

## Pipeline de seleção de estratégia

`CONTEXTO > RESTRIÇÕES > OBJETIVO > RECURSOS > ESTRATÉGIA`

1. **Contexto**: carregar o vetor de contexto (objetivo, nicho, ticket, estágio, orçamento, equipe, restrições).
2. **Restrições (eliminatório)**: cortar o que viola orçamento, regulação do nicho, capacidade da equipe, prazo ou política de plataforma.
3. **Objetivo (adequação)**: mapear o objetivo para famílias de estratégia.
4. **Recursos (viabilidade)**: cruzar com estágio de faturamento e faixa de verba. Estratégia certa no estágio errado é estratégia errada.
5. **Estratégia**: candidatas sobreviventes vão para o score de prioridade, e a recomendação sai com trade-offs explícitos.

Se não sobrar nenhuma candidata: relaxar a restrição menos crítica e documentar o trade-off. Restrição regulatória nunca é relaxada.

## Objetivo dominante e famílias de estratégia

| Objetivo dominante | Famílias candidatas |
|---|---|
| Primeiras vendas | Abordagem direta, oferta beta, indicação, tráfego local |
| Volume de leads | Tráfego pago, conteúdo com captura, parcerias |
| Conversão | Oferta, processo comercial, follow-up, remarketing |
| Ticket e LTV | Preço, upsell, cross-sell, recorrência, escada de valor |
| Retenção | Onboarding, pós-atendimento, comunidade, lembretes de retorno |
| Escala | Automação, equipe, novos canais, nova unidade |

## Estratégia por estágio de faturamento

As faixas são heurísticas. O método é confiável, os números exigem calibração pelo diagnóstico.

**Zero até a primeira venda.** Validar a oferta com pessoas reais, não construir estrutura. Rede pessoal, 20 a 50 conversas diretas, um canal só. Oferta beta com preço reduzido em troca de depoimento e feedback (nunca grátis sem contrapartida). Gargalo típico: medo de vender ou oferta vaga.

**Primeiras vendas até 10 mil por mês.** Prioridade: repetibilidade. Descobrir qual perfil compra e por quê. Dobrar no canal que trouxe as primeiras vendas, começar a capturar prova social, refinar a promessa com as palavras dos clientes. Gargalo típico: o dono é o único que atende.

**10 a 50 mil.** Processo comercial documentado e primeiro canal pago sustentável, com remarketing básico obrigatório. Primeiro atendimento ou SDR (humano ou agente de IA) para liberar o dono. CRM de verdade, follow-up automatizado. Métricas: CAC, resposta em menos de 5 minutos, no-show, conversão proposta para fechamento. Gargalo típico: follow-up inexistente.

**50 a 100 mil.** Retenção e monetização: crescer sem depender só de aquisição. Upsell e cross-sell estruturados, recorrência quando possível, marketing separado de vendas. Métricas: LTV, recompra, receita por cliente, payback. Gargalo típico: perda de clientes invisível.

**100 a 500 mil.** Sistema: 2 a 3 canais maduros, funis por segmento, dashboards, testes contínuos, gestor comercial e metas por função. Gargalo típico: dependência de pessoas-chave e dados pouco confiáveis.

**500 mil a 1 milhão.** Margem e eficiência: RevOps, preço revisado, segmentação de clientes por valor. Gargalo típico: complexidade operacional comendo margem.

**Acima de 1 milhão.** Vantagem durável: marca, dados próprios, canais próprios, novas linhas, novas unidades, parcerias. Gargalo típico: cultura e liderança.

## Estratégia por orçamento de aquisição mensal

Regra geral: abaixo de R$ 1.000 por mês, tempo substitui dinheiro. Acima, dinheiro compra velocidade de aprendizado.

| Verba/mês | Tráfego | Canais | Automação | Expectativa honesta |
|---|---|---|---|---|
| R$ 0 | Nenhum pago | Abordagem direta, rede, parcerias, orgânico, avaliações Google | Manual | Lento, depende do esforço diário |
| R$ 100 | Microtestes locais ou remarketing | 1 orgânico + impulsionamento pontual | Modelos de mensagem | Serve para aprender, não escalar |
| R$ 200 | Remarketing sempre ligado + 1 teste frio | Orgânico como motor | Follow-up semiautomático | Priorizar público quente |
| R$ 500 | 70% quente e morno, 30% frio | 1 pago + orgânico | Agente de qualificação simples | Primeiros dados de CAC |
| R$ 1.000 | Estrutura mínima completa | 1 canal pago dominado | Fluxos de nutrição | Tráfego começa a virar sistema |
| R$ 5.000 | Testes estruturados de criativo e público | 2 canais | Agentes de atendimento e SDR | Escalar o que já provou |
| R$ 10.000+ | Portfólio + verba fixa de teste (10 a 20%) | 2 a 3 canais + parcerias | Orquestração | Governança de métricas |

Regras de verba:
1. Nunca 100% da verba em público frio quando existe base para remarketing.
2. Verba pequena: criativo e oferta importam mais que segmentação.
3. Subir de faixa exige CAC conhecido, conversão estável e capacidade de atendimento. Lead que chega e não é atendido é dinheiro queimado.

Detalhes de execução em [[global/nico/trafego-pago/meta-ads-escala-e-orcamento]] e [[global/nico/financeiro-receita/dre-e-verba-de-marketing]].

## Como a NICO apresenta a recomendação

Formato curto para o dono do negócio:
1. **Recomendação**: uma frase com a ação.
2. **Por que essa primeiro**: ligação com o gargalo e o score.
3. **Trade-off**: o que se deixa de fazer agora.
4. **Como saber se deu certo**: métrica, meta e prazo.
5. **O que precisa de aprovação**: verba, disparo em massa, mudança de automação ativa.

Ver também [[global/nico/tom-e-estilo/mas-noticias-e-propostas-de-acao]] e [[global/operacao/okr-metodologia]].
