---
id: global-nico-estrategia-diagnostico-de-negocio
titulo: "Diagnóstico de negócio: motor de 12 etapas e heurística de gargalo"
descricao: "Como a NICO diagnostica um negócio antes de recomendar qualquer estratégia: vetor de contexto, intake de 8 perguntas, 12 etapas, gargalo único e formato de saída."
escopo: global
dominio: estrategia
framework: "Motor de Diagnóstico Universal + Teoria das Restrições"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [fazer diagnóstico do meu negócio, por que não estou vendendo, qual o gargalo da minha empresa, analisar minha empresa, o que eu faço primeiro, preciso de mais tráfego, montar estratégia completa, onde estou perdendo clientes]
fonte: "Orvyn OS Cerebro/conhecimento (CORE: universal-diagnostic-engine, context-principle, reasoning-system, strategic-output-format; PROMPTS: diagnostic-intake)"
versao: 1
---

# Diagnóstico de negócio: motor de 12 etapas e heurística de gargalo

Nenhuma estratégia boa nasce sem diagnóstico. Este documento descreve como a NICO investiga um negócio (clínica, escritório, contabilidade, studio, serviço local ou agência) antes de recomendar qualquer ação: que contexto coletar, em que ordem investigar, como achar o gargalo principal e como devolver a resposta.

## Por que diagnosticar antes de recomendar

A regra central do diagnóstico de negócio é: tráfego amplifica o que existe, inclusive o que está quebrado. Se a oferta é fraca ou o atendimento demora horas para responder, colocar mais verba em anúncio só faz o prejuízo chegar mais rápido.

Por isso a NICO nunca recomenda "mais tráfego" antes de auditar oferta e conversão. A maioria dos donos de negócio chega dizendo "preciso de mais leads". Muitas vezes o problema real é outro: leads que ninguém responde, orçamento enviado sem follow-up, no-show alto, preço mal comunicado. O diagnóstico existe para separar sintoma de causa.

Pipeline de raciocínio que o diagnóstico alimenta:

`INPUT > DIAGNÓSTICO > HIPÓTESES > PRIORIZAÇÃO > ESTRATÉGIA > EXECUÇÃO > MÉTRICAS > FEEDBACK > OTIMIZAÇÃO`

O diagnóstico ocupa as duas primeiras etapas. A priorização está em [[global/nico/estrategia/priorizacao-e-estrategia-por-estagio]].

## Vetor de contexto: os 12 campos mínimos

Antes de qualquer recomendação estratégica, a NICO preenche (ou assume explicitamente) o vetor de contexto do negócio:

| Campo | Exemplo hipotético |
|---|---|
| Objetivo | Sair de 30 mil para 60 mil por mês em 90 dias |
| Nicho | Odontologia, implantes |
| Público | Adultos de 40 a 65 anos com perda dentária |
| Oferta | Avaliação com exame de imagem + plano por etapas |
| Ticket | Valor médio por cliente |
| Margem | Margem bruta aproximada |
| Estágio | zero, 0 a 10k, 10 a 50k, 50 a 100k, 100 a 500k, 500k a 1M, escala |
| Orçamento | Disponível para aquisição por mês |
| Equipe | Quem executa: dono, recepção, SDR, closer |
| Canais | Ativos hoje: Instagram, Google, indicação |
| Prazo | Horizonte da meta |
| Restrições | Regulatórias (CFM, CFO, OAB), técnicas, financeiras, de marca |

Regras do vetor de contexto:
1. Campo ausente e crítico para a decisão: perguntar.
2. Campo ausente e não crítico: assumir com a marcação `[PREMISSA: ...]` visível na resposta.
3. Restrições regulatórias (saúde, direito, finanças) são sempre críticas.
4. O mesmo problema com vetores diferentes gera estratégias diferentes. Uma clínica faturando 15 mil com R$ 500 de verba não recebe o mesmo plano que uma faturando 200 mil com R$ 10 mil.

## Intake rápido: as 8 perguntas do diagnóstico

Quando o contexto está incompleto, a NICO pergunta apenas o essencial, em um único bloco, e já entrega algo útil com o que tem:

"Para montar o diagnóstico certo, preciso de 8 respostas rápidas:
1. O que você vende e por quanto (ticket médio)?
2. Para quem (cliente típico)?
3. Quanto fatura por mês hoje e qual a meta, em quanto tempo?
4. Como os clientes chegam hoje (canais e porcentagem aproximada)?
5. De 10 leads, quantos viram clientes? Onde a maioria se perde?
6. Quanto pode investir em aquisição por mês?
7. Quem executa (equipe)?
8. Alguma restrição importante (regulatória, técnica, financeira)?"

Regra do intake: nunca travar a conversa esperando todas as respostas. Responder com o que foi dado, marcar `[PREMISSA]` no resto e refinar quando as respostas chegarem. Se o usuário escreve de forma curta e informal, a NICO pode quebrar as perguntas em 2 ou 3 mensagens (ver [[global/nico/tom-e-estilo/adaptacao-ao-usuario]]).

## As 12 etapas do motor de diagnóstico

Executar em ordem. Cada etapa produz um artefato curto, não um ensaio.

| # | Etapa | Pergunta-chave | Artefato | O que investigar |
|---|---|---|---|---|
| 1 | Contexto | Quem é? | Ficha do negócio | Modelo, estágio, equipe, história, restrições |
| 2 | Mercado | Onde está? | Mapa de mercado | Concorrência, maturidade, tendência, regulação |
| 3 | Oferta | O que vende? | Matriz de oferta | Promessa, mecanismo, ticket, margem, diferenciação |
| 4 | Público | Para quem? | ICP e persona | Quem sente a dor, quem decide, quem paga |
| 5 | Aquisição | Como chegam clientes? | Mapa de canais | CAC por canal, dependências, canais não explorados |
| 6 | Conversão | Como lead vira cliente? | Mapa do funil | Taxas por etapa, tempo de resposta, follow-up, script |
| 7 | Retenção | Como mantém clientes? | Curva de retenção | Recompra, retorno, motivo de saída, onboarding |
| 8 | Monetização | Como aumenta receita? | Árvore de receita | Ticket, LTV, upsell, recorrência, preço |
| 9 | Operação | Quais processos existem? | Mapa de processos | O que é manual, o que quebra, pessoas-chave |
| 10 | IA e automação | O que pode ser automatizado? | Matriz de agentes | Respostas repetitivas, gargalos de resposta, dados |
| 11 | Gargalo | Qual é o MAIOR limitador? | 1 frase | Teoria das Restrições: um gargalo por vez |
| 12 | Plano | O que fazer? | Plano 7/30/90 | Só ações que atacam ou protegem o gargalo |

Dicas práticas por etapa para negócios locais:
- Etapa 5: perguntar "como você soube de nós?" nos últimos 20 clientes já dá um mapa de canais melhor que qualquer achismo.
- Etapa 6: medir o tempo de primeira resposta no WhatsApp antes de qualquer conclusão sobre tráfego. Em clínicas, o gargalo típico é o atendimento lento desperdiçando leads pagos.
- Etapa 7: em saúde e estética o LTV costuma ser subestimado (retorno, manutenção, família, indicação).
- Etapa 10: usar o formato `PROCESSO > GATILHO > IA > FERRAMENTA > AÇÃO > CONDIÇÃO > RESULTADO`.

## Heurística de gargalo: em que ordem verificar

O gargalo do negócio é verificado nesta ordem, porque cada camada depende da anterior:

1. **Oferta**: se a taxa de conversão é baixa em TODOS os canais, o problema é oferta ou posicionamento, não tráfego.
2. **Aquisição**: se a conversão é saudável mas o volume é baixo, o problema é tráfego ou prospecção.
3. **Conversão**: se os leads chegam mas não fecham, o problema é processo comercial, tempo de resposta ou follow-up.
4. **Retenção**: se vende bem mas a receita não cresce, a perda de clientes come o crescimento.
5. **Operação**: se cresce mas quebra (agenda caótica, atrasos, reclamações), o problema é processo e capacidade.

Sinais rápidos de cada gargalo:

| Sintoma relatado | Gargalo provável | Primeira verificação |
|---|---|---|
| "Os leads são ruins" | Conversão ou segmentação | Ouvir 10 conversas reais do WhatsApp |
| "Ninguém fecha, acham caro" | Oferta ou valor percebido | Como o preço é apresentado e quando |
| "Tenho pouco movimento" | Aquisição | Volume de leads por semana e por canal |
| "Os clientes não voltam" | Retenção | Existe lembrete de retorno ou manutenção? |
| "Estou afogado, não dou conta" | Operação | Capacidade de agenda e quem responde |

Teoria das Restrições aplicada: atacar um gargalo por vez. Melhorar uma etapa que não é o gargalo não aumenta o resultado do sistema.

## Hipóteses: como transformar o gargalo em teste

Para cada gargalo, gerar de 3 a 7 hipóteses de causa no formato:

> "O [métrica-problema] pode ser causado por [causa] porque [evidência ou lógica]."

Exemplo hipotético (clínica de estética, conversão baixa):
- "A conversão conversa para agendamento pode estar baixa porque a primeira resposta demora mais de 2 horas, e o lead já falou com outra clínica."
- "Pode estar baixa porque a recepção responde preço seco por lista, sem convidar para avaliação."
- "Pode estar baixa porque não há follow-up depois do primeiro contato."

Regras das hipóteses: precisam ser falsificáveis; cada uma aponta uma evidência que a confirma ou refuta; hipótese sem evidência possível é descartada. As hipóteses viram experimentos no formato `HIPÓTESE > TESTE > MÉTRICA > META > RESULTADO > APRENDIZADO > PRÓXIMO TESTE`.

## Formato de saída: resposta pontual ou diagnóstico completo

Pedido pontual ("meu CPL subiu, o que faço?") recebe resposta pontual, sem inflar. Pedido de análise de empresa ou estratégia completa usa o formato estratégico em blocos. Versão resumida dos 23 blocos:

1. Resumo executivo (5 linhas: quem é, gargalo, tese, resultado esperado, próximo passo)
2. Diagnóstico (saída das 12 etapas)
3. Mercado, 4. Nicho, 5. ICP e anti-ICP (quem NÃO atender)
6. Oferta atual vs proposta, 7. Posicionamento
8. Aquisição, 9. Funil, 10. Vendas, 11. Remarketing
12. Automação, 13. IA (agentes recomendados)
14. Gargalos, 15. Oportunidades ranqueadas, 16. Estratégia
17. Plano 7 dias, 18. Plano 30 dias, 19. Plano 90 dias
20. KPIs (norte + suporte, com meta e prazo)
21. Experimentos (3 a 5), 22. Riscos (regulatórios, operacionais, financeiros, de plataforma)
23. Próximo passo: UMA ação, a primeira peça do dominó

Bloco sem informação suficiente declara: "Dados insuficientes. Perguntas necessárias: [...]". Nunca preencher com suposição silenciosa.

## Checklist do diagnóstico da NICO

- [ ] Vetor de contexto preenchido ou com `[PREMISSA]` visível
- [ ] Restrições regulatórias do nicho identificadas
- [ ] Tempo de primeira resposta verificado antes de culpar o tráfego
- [ ] Taxas por etapa do funil, mesmo que aproximadas
- [ ] Um único gargalo principal nomeado em 1 frase
- [ ] 3 a 7 hipóteses falsificáveis
- [ ] Plano só com ações que atacam o gargalo
- [ ] Números classificados: dado verificado, `[ESTIMATIVA]` ou meta
- [ ] Um próximo passo claro

Relacionados: [[global/nico/estrategia/priorizacao-e-estrategia-por-estagio]], [[global/nico/estrategia/funis-por-modelo-de-negocio]], [[global/nico/ia-prompts/raciocinio-e-anti-alucinacao]], [[global/operacao/prontidao-para-escalar]].
