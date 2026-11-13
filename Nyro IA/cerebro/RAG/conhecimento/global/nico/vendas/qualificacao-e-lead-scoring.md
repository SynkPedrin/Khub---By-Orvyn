---
id: global-nico-vendas-qualificacao-e-lead-scoring
titulo: "Qualificação de leads e lead scoring"
descricao: "Como escolher entre BANT, GPCT e MEDDIC, montar um modelo de pontuação de leads por perfil, engajamento e intenção, definir faixas e regras de roteamento e recalibrar com dados reais."
escopo: global
dominio: vendas
framework: "BANT, GPCT, MEDDIC + modelo de pontuação Perfil, Engajamento e Intenção"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [como qualificar lead, lead scoring, pontuação de leads, lead quente morno frio, bant ou gpct, perguntas de qualificação para ia, como desqualificar lead, quais leads atender primeiro]
fonte: "Orvyn OS Cerebro/conhecimento (SALES/challenger-meddic-bant-nepq, SALES/methodology-selector, AI/agent-opportunity-map); conhecimento global existente (vendas-e-sdr); prática consolidada de mercado"
versao: 1
---

# Qualificação de leads e lead scoring

Qualificar é decidir quem merece o tempo do closer agora, quem precisa de nutrição e quem não é cliente. Lead scoring transforma essa decisão em regra, para que o time humano e o agente de IA priorizem do mesmo jeito.

## Qual framework de qualificação usar

| Framework | O que verifica | Quando usar | Quando evitar |
|---|---|---|---|
| BANT | Budget (orçamento), Authority (decisor), Need (necessidade), Timing (prazo) | Triagem rápida de alto volume, por SDR ou agente | Como roteiro de conversa: soa interrogatório |
| GPCT | Goals (objetivos), Plans (planos), Challenges (desafios), Timeline (prazo) | Serviço consultivo, B2B leve, quando o contexto importa mais que o orçamento | Venda transacional de ticket baixo |
| MEDDIC | Métricas, comprador econômico, critérios e processo de decisão, dor, campeão interno | Venda com vários decisores e ciclo longo (contabilidade ou jurídico para empresas maiores) | Pequenos negócios e leads B2C |

Regra prática para negócios locais: use GPCT simplificado na conversa (o que você quer resolver, por que agora, o que já tentou, para quando) e registre os campos de BANT no CRM. Ver o básico em [[global/vendas-e-sdr]].

## Perguntas de qualificação para agente de IA

Perguntas curtas, uma por mensagem, que soam como atendimento e não como formulário:

1. Necessidade: "O que você gostaria de resolver?"
2. Motivação e prazo: "O que te fez procurar isso agora?" / "Tem alguma data em mente?"
3. Histórico: "Já fez ou tentou algo antes?"
4. Decisor: "Mais alguém participa dessa decisão?"
5. Logística: "Qual bairro ou região?" / "Particular ou convênio?" (quando aplicável)
6. Orçamento (só quando o negócio pede e com tato): "Pra eu te indicar a melhor opção, você já tem uma faixa de investimento em mente?"

O agente nunca pergunta dados sensíveis desnecessários (diagnósticos, documentos) na fase de qualificação. Minimização de dados é exigência da LGPD.

## Modelo de lead scoring: Perfil, Engajamento e Intenção

A pontuação soma três dimensões. Os pesos abaixo são ponto de partida (exemplo hipotético) e devem ser recalibrados com os dados de fechamento do próprio negócio.

**Perfil (fit com o cliente ideal), até 40 pontos**

| Critério | Pontos |
|---|---|
| Serviço procurado é o principal do negócio | +15 |
| Está dentro da área de atendimento | +10 |
| Decisor confirmado | +10 |
| Faixa de orçamento compatível | +5 |
| Fora da área ou serviço que o negócio não faz | desqualifica |

**Engajamento, até 30 pontos**

| Critério | Pontos |
|---|---|
| Respondeu em menos de 1 hora | +10 |
| Respondeu todas as perguntas de qualificação | +10 |
| Mandou foto, exame ou detalhe espontâneo | +5 |
| Interagiu com conteúdo ou voltou ao site | +5 |
| Sem resposta após 2 toques | -10 |

**Intenção, até 30 pontos**

| Critério | Pontos |
|---|---|
| Pediu horário ou disponibilidade | +15 |
| Perguntou forma de pagamento | +10 |
| Prazo declarado de até 30 dias | +5 |
| Veio por indicação | +10 (pode ultrapassar o teto da dimensão) |
| Disse explicitamente que só está pesquisando | -5 |

## Faixas de pontuação e roteamento

| Faixa | Pontuação | Ação | Responsável |
|---|---|---|---|
| Quente | 70 ou mais | Agendar agora; alerta interno para humano se o agente não fechar o horário | SDR ou agente + closer |
| Morno | 40 a 69 | Continuar qualificação, enviar conteúdo de decisão, cadência de follow-up | Agente + automação |
| Frio | abaixo de 40 | Nutrição leve, remarketing, reativação futura | Automação |
| Desqualificado | critério eliminatório | Encerrar com elegância, registrar motivo | Agente |

Regra: lead quente sem resposta humana em até 15 minutos dispara alerta para a equipe. Ver a receita de alerta em [[global/nico/crm-automacao/receitas-de-fluxos-essenciais]].

## Desqualificar com elegância

Desqualificar não é descartar: é ser honesto sobre o encaixe.

Exemplo hipotético (advocacia, área que o escritório não atende): "Obrigado por confiar em nós, [nome]. Essa área específica não é a que nosso escritório atende, e eu prefiro te dizer isso agora para você não perder tempo. Recomendo procurar um advogado especializado em [área]."

Exemplo hipotético (fora da região): "Hoje não atendemos [região], mas se você estiver por perto em algum momento, vai ser um prazer te receber."

Registrar como desqualificado com motivo. Isso evita que o lead entre em cadências de venda.

## Sinais de urgência que furam a fila

Alguns sinais mudam a prioridade independentemente da pontuação:
- Saúde: dor aguda, sangramento, sintomas graves. Orientar atendimento imediato (pronto atendimento quando necessário) e chamar humano.
- Advocacia: prazo processual ou audiência próxima, prisão, demissão recente com prazo correndo. Transferir para advogado.
- Contabilidade: notificação de órgão, prazo de obrigação vencendo. Transferir para responsável técnico.
- Serviços locais: emergência (vazamento, pane). Priorizar encaixe.

## Recalibrar o scoring com dados reais

Um modelo de scoring só vale se prever fechamento. Revisar a cada 60 a 90 dias:
1. Exportar os leads do período com pontuação e resultado (ganho, perdido).
2. Calcular a taxa de fechamento por faixa. Esperado: quente fecha bem mais que morno, que fecha mais que frio.
3. Se o morno fecha tanto quanto o quente, os critérios não diferenciam: revisar pesos.
4. Identificar quais critérios aparecem mais nos ganhos (ex.: indicação, pediu horário) e aumentar o peso.
5. Identificar critérios que não mudam nada e remover (menos campos, menos atrito).

Fórmula de leitura: taxa de fechamento da faixa = vendas da faixa / leads da faixa.

## Erros comuns na qualificação

- Usar o BANT como interrogatório na primeira mensagem.
- Qualificar demais e não agendar: o objetivo da qualificação é chegar ao próximo passo.
- Score que nunca é revisado e vira número decorativo.
- Tratar indicação igual a lead frio de anúncio.
- Não registrar o motivo de desqualificação (o mesmo lead volta e recebe a mesma abordagem).
