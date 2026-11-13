---
id: global-nico-ia-prompts-rubrica-de-qualidade-de-prompt
titulo: "Rubrica de qualidade de prompt de agente (0 a 100)"
descricao: "Critérios ponderados, travas críticas e faixas de nota para avaliar se um agente de atendimento consegue trabalhar sozinho, com o formato de devolutiva da NICO."
escopo: global
dominio: ia-prompts
framework: "Rubrica de Prompt 0 a 100 com travas críticas"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [nota do meu prompt, avaliar prompt do agente, meu agente está pronto para produção, por que meu prompt tirou nota baixa, como aumentar a nota do agente, auditoria de prompt, critérios de qualidade de prompt]
fonte: "Análise de prompt do KHUB (faixas 80+ / 50 a 79 / abaixo de 50); Orvyn OS Cerebro/conhecimento (AI/agent-opportunity-map, CORE/anti-hallucination); Brain-Marketing STUDIO-BRAIN (QUALITY_STANDARD, nota com veto)"
versao: 1
---

# Rubrica de qualidade de prompt de agente (0 a 100)

Esta rubrica responde a uma pergunta só: o agente consegue trabalhar sozinho com o que está escrito? A NICO soma pontos por critério, aplica travas para faltas críticas e devolve nota, o que falta e sugestões priorizadas. As faixas são as mesmas da análise de prompt do KHUB.

## Faixas de nota do prompt de agente

| Nota | Faixa | Significado | Ação |
|---|---|---|---|
| 80 a 100 | Pronto para produção | O agente trabalha sozinho com segurança | Ativar e monitorar as primeiras conversas |
| 50 a 79 | Funciona, mas frágil | Atende o caminho feliz e quebra em exceções | Corrigir os itens apontados antes de escalar volume |
| 0 a 49 | Vai falhar | Falta informação ou limite essencial | Não ativar; completar o prompt |

A mesma lógica da avaliação de criativos vale aqui: a nota final é a soma, mas uma falha de piso limita o teto até ser corrigida.

## Critérios ponderados da rubrica (total 100 pontos)

| Critério | Peso | Nota cheia | Nota parcial | Zero |
|---|---|---|---|---|
| 1. Papel e objetivo | 10 | Identidade, empresa, objetivo único e critério de sucesso | Objetivo vago ou vários objetivos sem prioridade | Sem objetivo |
| 2. Informações operacionais | 20 | Tudo que o foco exige (ver travas) está escrito ou na base ligada | Parte das informações, com lacunas sem regra | Nada operacional |
| 3. Grounding e incerteza | 10 | Manda usar só fontes dadas e diz o que fazer quando não sabe | Diz "não invente" sem dizer o que fazer | Nada sobre incerteza |
| 4. Escopo negativo (proibições) | 10 | Lista clara do que nunca fazer, coerente com o nicho | Lista genérica ou incompleta | Sem limites |
| 5. Transferência para humano | 10 | Gatilhos objetivos, frase de passagem e registro | Só "chame humano se necessário" | Sem regra |
| 6. Condução e qualificação | 10 | Fluxo em passos, perguntas que mudam a ação, CTA com opções | Fluxo parcial ou perguntas sem uso | Sem fluxo |
| 7. Tom e personalidade | 5 | Tom definido e coerente com público e marca | Tom citado sem descrição | Sem tom |
| 8. Formato WhatsApp | 5 | Mensagens curtas, uma pergunta por vez, sem markdown | Parcial | Nada ou formato inadequado |
| 9. Compliance e dados | 10 | Regras do nicho (conselho, CDC, LGPD) e cuidado com dados | Menção genérica | Ausente em nicho regulado |
| 10. Exemplos de diálogo | 5 | 2 a 4 exemplos que cobrem preço e transferência | 1 exemplo | Nenhum |
| 11. Coerência e clareza | 5 | Sem contradições, sem marcadores vazios, prioridades claras | Pequenas ambiguidades | Regras que se contradizem |

Em negócio não regulado (por exemplo, pet shop), o critério 9 avalia só LGPD e CDC; os pontos continuam valendo.

## Travas críticas que limitam a nota do prompt

Uma trava limita a nota máxima independentemente da soma. Regras:

| Situação | Nota máxima |
|---|---|
| Agente de vendas sem preços, regra de preço ou condições | 45 |
| Agente de agendamento sem serviços, duração ou horários | 45 |
| Prompt depende de informação do negócio e a base de conhecimento está desligada | 49 |
| Nicho de saúde ou jurídico sem proibição de diagnóstico, parecer ou promessa de resultado | 49 |
| Prompt autoriza explicitamente inventar ou "estimar" preço, prazo ou resultado | 40 |
| Nenhuma regra de transferência para humano | 69 |
| Marcadores vazios como [NOME DA EMPRESA] ou [PREÇO] no texto | 75 |
| Sem tom definido | 79 |

A frase que acompanha uma trava de vendas sem preço deve ser direta: "Sem valores informados, ela não vai funcionar corretamente."

## Como a NICO aplica a rubrica passo a passo

1. Identificar o foco do agente (vendas, agendamento, dúvidas, triagem, pós-venda) e o nicho.
2. Verificar as travas críticas primeiro. Se alguma dispara, registrar.
3. Pontuar os 11 critérios com nota cheia, parcial (metade do peso, arredondada) ou zero.
4. Somar e aplicar o teto da trava mais restritiva.
5. Escolher no máximo 8 itens faltando, ordenados por impacto.
6. Escrever sugestões acionáveis, cada uma com o texto pronto para colar quando possível.
7. Se a nota ficou abaixo de 80, reescrever o trecho mais fraco como demonstração.

Quando houver dúvida entre nota cheia e parcial, dar parcial e explicar. Nota inflada coloca agente frágil em produção.

## Formato da devolutiva de nota do prompt

A NICO entrega nesta ordem:

1. Nota e faixa em uma linha: "Nota 62: funciona, mas está frágil."
2. O que falta (lista curta, do mais grave para o menos grave).
3. Sugestões priorizadas, cada uma com um exemplo de texto.
4. Um trecho reescrito (o bloco mais fraco).
5. Próximo passo único: "Adicione a tabela de valores e me mande de novo que eu reavalio."

Exemplo hipotético de devolutiva:

> Nota 46: do jeito que está, o agente vai falhar.
> O que falta: 1) valores ou regra de preço (agente de vendas sem preço trava na primeira pergunta); 2) quando passar para alguém da equipe; 3) dias e horários de atendimento.
> Sugestão 1: se o valor depende de avaliação, escreva isso: "O valor é definido na avaliação, que é gratuita e dura 30 minutos."
> Sugestão 2: "Se a pessoa reclamar, pedir desconto ou quiser falar com alguém, diga que vai chamar a equipe e pare de responder sobre o assunto."
> Próximo passo: complete esses três pontos e eu reavalio. Deve passar de 75.

## Critérios de produção além da nota do prompt

Nota alta no papel não substitui teste. Antes de ativar:
- Rodar 10 a 20 conversas de teste cobrindo: pergunta de preço, pedido de horário fora do expediente, reclamação, pergunta clínica ou jurídica, pessoa que some, pessoa que manda áudio ou foto.
- Conferir se as respostas ficaram curtas e sem markdown.
- Conferir se o agente transferiu quando devia.
- Revisar as primeiras conversas reais nos primeiros dias de operação.
- Reavaliar a nota sempre que o prompt mudar (versão nova, nota nova).

## Erros comuns ao pontuar prompts de agente

- Dar nota alta para prompt longo. Tamanho não é qualidade; regra sem prioridade confunde o modelo.
- Ignorar a base de conhecimento. Um prompt curto com base completa e ligada pode ser melhor que um prompt enorme.
- Avaliar o tom e esquecer o operacional. Simpatia não agenda ninguém sem horários.
- Penalizar a ausência de compliance em negócio que não é regulado com o mesmo peso de uma clínica.
- Esquecer de explicar o porquê. Toda nota parcial precisa de uma frase de motivo.

Erros de escrita mais frequentes estão em [[global/nico/ia-prompts/erros-comuns-de-prompt]] e a estrutura ideal em [[global/nico/ia-prompts/anatomia-de-prompt-de-agente]].
