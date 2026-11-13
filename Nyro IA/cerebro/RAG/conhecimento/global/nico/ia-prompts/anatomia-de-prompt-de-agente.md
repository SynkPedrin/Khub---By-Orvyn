---
id: global-nico-ia-prompts-anatomia-de-prompt-de-agente
titulo: "Anatomia de um bom prompt de agente de atendimento"
descricao: "Os blocos que todo system prompt de agente de IA de atendimento no WhatsApp precisa ter, com modelo pronto e exemplos completos para clínica e escritório de advocacia."
escopo: global
dominio: ia-prompts
framework: "Anatomia de Prompt de Agente (12 blocos)"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [como escrever o prompt do meu agente, estrutura de prompt de atendimento, modelo de prompt para whatsapp, criar agente de ia para clínica, prompt de agente para escritório de advocacia, o que colocar no prompt do agente, melhorar instruções do agente]
fonte: "Orvyn OS Cerebro/conhecimento (AI/agent-opportunity-map, PROMPTS/system-prompt-core, HEALTH e LEGAL guardrails); assistente de prompt do KHUB; prática consolidada de engenharia de prompt"
versao: 1
---

# Anatomia de um bom prompt de agente de atendimento

Um agente de atendimento no WhatsApp só trabalha sozinho se o prompt dele responder a quatro perguntas: quem eu sou, o que eu preciso conseguir, com quais informações e dentro de quais limites. Este documento mostra os 12 blocos de um prompt completo, um modelo para copiar e dois exemplos inteiros (clínica e advocacia). Para dar nota a um prompt, use [[global/nico/ia-prompts/rubrica-de-qualidade-de-prompt]].

## Os 12 blocos de um prompt de agente de atendimento

| # | Bloco | Pergunta que responde | Se faltar |
|---|---|---|---|
| 1 | Identidade e papel | Quem é o agente e em nome de quem fala? | Agente genérico, tom de robô |
| 2 | Objetivo (foco) | Qual o resultado de cada conversa? (agendar, qualificar, vender, tirar dúvida) | Conversa sem rumo, nunca chega no CTA |
| 3 | Contexto do negócio | O que a empresa faz, para quem, onde, diferenciais | Respostas vagas, sem argumento |
| 4 | Informações operacionais | Serviços, valores ou regra de preço, horários, endereço, duração, formas de pagamento, convênios | Agente inventa ou trava (falha crítica) |
| 5 | Base de conhecimento e grounding | De onde vem a verdade e o que fazer quando a resposta não está lá | Alucinação |
| 6 | Fluxo de conversa | Ordem dos passos: saudação, entender, qualificar, propor, fechar | Interrogatório ou conversa solta |
| 7 | Qualificação | O que perguntar e o que fazer com cada resposta | Lead errado na agenda |
| 8 | Proibições (escopo negativo) | O que o agente NUNCA faz | Promessa indevida, risco jurídico |
| 9 | Transferência para humano | Quando e como passar a conversa | Cliente irritado preso no robô |
| 10 | Tom e formato | Registro de linguagem, tamanho, emojis, sem markdown | Muro de texto, tom errado |
| 11 | Compliance do nicho | Regras de conselho, CDC, LGPD | Publicidade irregular, vazamento de dado |
| 12 | Exemplos de diálogo | 2 a 4 trocas modelo | Agente interpreta as regras do jeito dele |

Regra prática da NICO: os blocos 2, 4, 8 e 9 são os que mais derrubam agentes em produção. Revise esses quatro primeiro.

## Bloco 1 e 2: identidade, papel e objetivo do agente

A identidade define a voz; o objetivo define o fim da conversa. Escreva os dois em até cinco linhas.

- Diga o nome do agente, a empresa e a função: "Você é a Clara, atendente virtual da clínica. Seu trabalho é ajudar quem chega pelo WhatsApp a agendar uma avaliação."
- Um objetivo principal por agente. Objetivos secundários entram como "se a pessoa pedir X, faça Y".
- Defina o que conta como sucesso: "Conversa bem-sucedida = horário confirmado com nome completo e telefone."
- Se o agente se apresenta como IA ou não depende da política do negócio; a recomendação é ser transparente quando a pessoa perguntar ("Sou a assistente virtual da equipe").

## Bloco 3 e 4: contexto do negócio e informações operacionais

O agente não pode inventar nada que o negócio não informou. Por isso as informações operacionais precisam estar escritas no prompt ou na base de conhecimento ligada ao agente.

Checklist mínimo por foco:
- Agente de vendas: lista de serviços ou produtos, preço ou regra de preço ("valor só após avaliação"), condições de pagamento, parcelamento, prazo de entrega ou início.
- Agente de agendamento: serviços agendáveis, duração de cada um, dias e horários de atendimento, profissionais, endereço, regra de remarcação e cancelamento, preparo quando houver.
- Agente de dúvidas: FAQ validado pelo dono, políticas (troca, garantia de processo, reembolso), canais oficiais.

Onde faltar dado, escreva a regra e não um espaço vazio: "Se não souber o valor, diga que vai confirmar com a equipe e peça o melhor horário para retorno." Nunca deixe marcadores como [NOME DA EMPRESA] ou [PREÇO]: o agente pode repetir o colchete para o cliente.

## Bloco 5: base de conhecimento e grounding

Grounding é amarrar as respostas a uma fonte verdadeira. Regras que funcionam:
1. "Responda apenas com base nas informações deste prompt e da base de conhecimento."
2. "Se a informação não estiver disponível, diga que vai verificar com a equipe. Nunca suponha preço, horário, disponibilidade ou resultado."
3. "Se a base de conhecimento e o prompt divergirem, siga o prompt e avise a equipe." (ou o contrário, mas escolha um)
4. Se o prompt depende de informação específica do negócio, a base de conhecimento precisa estar ligada. Prompt que diz "consulte os valores" com a base desligada é falha.
5. A base de conhecimento do agente é validada pelo dono do negócio antes de ativar o agente.

## Bloco 6 e 7: fluxo de conversa e qualificação

Fluxo recomendado para WhatsApp de serviços:
1. Saudação curta com o nome da pessoa quando houver.
2. Entender o motivo do contato com uma pergunta aberta.
3. Qualificar com no máximo uma pergunta por mensagem (duas ou três perguntas no total antes de propor algo).
4. Propor o próximo passo com duas opções concretas ("terça 10h ou quinta 15h?").
5. Confirmar dados e resumir.
6. Encerrar com o que acontece a seguir (lembrete, endereço, documentos).

Qualificação útil é a que muda a ação. Para cada pergunta, escreva o que fazer com a resposta. Exemplo: "Pergunte se é a primeira vez na clínica. Se sim, ofereça avaliação. Se já é paciente, pergunte o procedimento e ofereça retorno." Veja critérios em [[global/nico/vendas/qualificacao-e-lead-scoring]].

## Bloco 8 e 9: proibições e transferência para humano

Escopo negativo explícito é obrigatório. Lista base que serve para quase todo agente:
- Nunca inventar preço, horário, disponibilidade, condição ou política.
- Nunca prometer resultado (clínico, jurídico, financeiro ou de vendas).
- Nunca dar diagnóstico, orientação de tratamento ou parecer sobre caso concreto.
- Nunca pedir dado sensível que não seja necessário para o atendimento.
- Nunca falar mal de concorrente.
- Nunca insistir depois que a pessoa pedir para parar.

Transferência para humano (handoff) precisa de gatilhos objetivos e de uma frase de passagem:
- Gatilhos: pedido explícito de falar com pessoa; reclamação ou irritação; negociação fora da tabela; caso clínico ou jurídico específico; urgência declarada; assunto fora do escopo; duas tentativas sem entender a pessoa.
- Ação: avisar o cliente ("Vou chamar alguém da equipe para te ajudar com isso, tudo bem?"), registrar resumo no CRM e não continuar respondendo o assunto transferido.
- Em sinais de urgência médica, orientar procurar atendimento imediato antes de qualquer outra coisa.

## Bloco 10 e 11: tom, formato e compliance

Formato para WhatsApp:
- Mensagens curtas (uma a três frases), uma ideia por mensagem.
- Sem markdown (nada de asteriscos duplos, títulos ou listas com marcadores longos).
- Emojis com moderação e só se combinarem com a marca.
- Tratar pelo nome; espelhar formalidade do cliente.

Tom: escolha um (cordial, formal, direto, descontraído) e descreva em uma frase de personalidade. Compliance: inclua as regras do nicho do negócio, detalhadas em [[global/nico/ia-prompts/compliance-de-agentes-nichos-regulados]].

## Bloco 12: exemplos de diálogo dentro do prompt

Dois a quatro exemplos curtos ensinam mais que dez regras. Inclua pelo menos: um caminho feliz, uma pergunta de preço e um caso de transferência. Marque como exemplo para o agente não copiar literalmente: "Exemplo de estilo (adapte, não copie)".

## Modelo de prompt de agente para copiar

```
Você é [nome do agente], atendente virtual de [empresa], que [o que a empresa faz e para quem].
Seu objetivo: [resultado da conversa]. Sucesso = [critério].

INFORMAÇÕES DO NEGÓCIO
Serviços: ...
Valores: ... (ou regra: valor só após avaliação)
Horários e endereço: ...
Pagamento: ...

COMO CONDUZIR
1. Cumprimente pelo nome e pergunte como pode ajudar.
2. Entenda o motivo. Faça uma pergunta por vez.
3. Qualifique: ...
4. Proponha o próximo passo com duas opções de horário.
5. Confirme nome, telefone e horário. Explique o que acontece depois.

NUNCA
Invente valores, horários ou condições. Se não souber, diga que confirma com a equipe.
Prometa resultados. Dê diagnóstico ou parecer.

PASSE PARA UM HUMANO QUANDO
A pessoa pedir; houver reclamação; ... Diga: "Vou chamar alguém da equipe."

ESTILO
Mensagens curtas, estilo WhatsApp, sem markdown. Tom: [tom].
```

Observação: os colchetes acima são só do modelo. No prompt final, todos precisam virar texto real ou regra.

## Exemplo completo de prompt: clínica de estética (Exemplo hipotético)

```
Você é a Bia, atendente virtual de uma clínica de estética facial e corporal. Seu objetivo é agendar avaliações. Sucesso = avaliação marcada com nome completo e horário confirmado.

Informações: a avaliação dura 40 minutos e não tem custo. Atendemos de segunda a sexta, 9h às 19h, e sábado, 9h às 13h. Valores de procedimentos só são passados após a avaliação, porque dependem do caso. Aceitamos Pix e cartão em até 10x.

Conduza assim: cumprimente pelo nome; pergunte o que a pessoa gostaria de melhorar; pergunte se já fez algum procedimento antes; ofereça a avaliação com dois horários; confirme os dados.

Se perguntarem o preço: explique que o valor depende do plano indicado na avaliação, que a avaliação é sem custo e ofereça horários.

Nunca: prometa resultado, use termos como "garantido" ou "sem dor", indique procedimento sem avaliação, comente fotos de pele enviadas pela pessoa (agradeça e diga que a profissional avalia pessoalmente).

Passe para a equipe quando: houver reclamação, dúvida sobre reação após procedimento (oriente contato imediato com a clínica), pedido de desconto ou pedido de falar com alguém.

Estilo: cordial e leve, mensagens curtas, no máximo um emoji por mensagem, sem markdown.
```

## Exemplo completo de prompt: escritório de advocacia trabalhista (Exemplo hipotético)

```
Você é o assistente virtual de um escritório de advocacia com atuação em direito do trabalho. Seu objetivo é fazer a triagem inicial e agendar uma consulta com um advogado. Sucesso = consulta agendada com resumo do caso registrado.

Informações: consultas presenciais ou por vídeo, de segunda a sexta, 9h às 18h. A consulta inicial tem valor informado pela equipe. Documentos úteis: carteira de trabalho, contracheques, termo de rescisão.

Conduza assim: cumprimente; pergunte de forma geral o que aconteceu; pergunte quando terminou o vínculo (se terminou); pergunte se a pessoa prefere consulta presencial ou por vídeo; ofereça dois horários; liste os documentos úteis.

Nunca: diga se a pessoa tem ou não direito, estime valores a receber, prometa resultado, cite artigos de lei ou prazos específicos do caso. Diga: "Isso o advogado avalia na consulta, com seus documentos."

Passe para a equipe quando: a pessoa relatar prazo urgente, pedir honorários detalhados, reclamar ou pedir para falar com advogado agora.

Sigilo: não peça documentos pelo WhatsApp antes da consulta, a menos que a equipe autorize. Não repita detalhes sensíveis desnecessariamente.

Estilo: formal e acolhedor, frases curtas, sem emojis, sem markdown.
```
