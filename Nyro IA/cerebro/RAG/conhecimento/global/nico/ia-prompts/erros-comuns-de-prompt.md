---
id: global-nico-ia-prompts-erros-comuns-de-prompt
titulo: "Erros comuns em prompts de agentes de atendimento"
descricao: "Dezesseis erros frequentes em system prompts de agentes de WhatsApp, cada um com exemplo ruim, motivo da falha e versão corrigida."
escopo: global
dominio: ia-prompts
framework: "Catálogo de erros de prompt (ruim, por quê, corrigido)"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [meu agente inventa preço, agente responde texto muito longo, por que meu agente não transfere para humano, erros no prompt do agente, agente está robótico, agente promete resultado, corrigir prompt do agente, agente faz muitas perguntas]
fonte: "Assistente e análise de prompt do KHUB; Orvyn OS Cerebro/conhecimento (CORE/anti-hallucination, HEALTH e LEGAL guardrails, AI/agent-opportunity-map); prática consolidada de engenharia de prompt"
versao: 1
---

# Erros comuns em prompts de agentes de atendimento

Quase todo agente que falha em produção comete um dos erros abaixo. Para cada erro há um exemplo ruim, o motivo da falha e a versão corrigida. A NICO usa este catálogo para explicar uma nota baixa e para reescrever trechos. A estrutura correta está em [[global/nico/ia-prompts/anatomia-de-prompt-de-agente]].

## Erro 1: papel vago no prompt do agente

- Ruim: "Você é um assistente útil que ajuda os clientes."
- Por que falha: o modelo não sabe em nome de quem fala, nem o que é sucesso. Responde tudo e não conduz nada.
- Corrigido: "Você é a Lia, atendente virtual da clínica odontológica. Seu objetivo é agendar avaliações. Sucesso = horário confirmado."

## Erro 2: regras contraditórias no prompt

- Ruim: "Seja breve." e mais abaixo "Explique sempre todos os detalhes do procedimento."
- Por que falha: o modelo escolhe uma das regras a cada mensagem, e o comportamento fica imprevisível.
- Corrigido: "Responda em até três frases. Se a pessoa pedir detalhes, explique em mensagens curtas, uma ideia por vez."

## Erro 3: muro de regras sem prioridade

- Ruim: 40 regras soltas, todas com "IMPORTANTE" e letras maiúsculas.
- Por que falha: quando tudo é importante, nada é. Regras críticas se perdem entre preferências de estilo.
- Corrigido: separar em blocos (Objetivo, Informações, Nunca, Transferência, Estilo) e colocar as proibições críticas primeiro, em lista curta.

## Erro 4: permitir que o agente invente dados

- Ruim: "Se não souber o preço, dê uma estimativa aproximada."
- Por que falha: o cliente toma a estimativa como promessa. Pelo CDC, informação de oferta precisa ser clara e pode vincular o fornecedor.
- Corrigido: "Se não souber o valor, diga que vai confirmar com a equipe e pergunte o melhor horário para retorno."

## Erro 5: agente sem regra de transferência para humano

- Ruim: nenhuma menção a humano, ou só "chame alguém se precisar".
- Por que falha: cliente irritado fica preso num robô; caso sensível é respondido pela IA.
- Corrigido: "Passe para a equipe quando: a pessoa pedir; houver reclamação; pedido de desconto; dúvida clínica. Diga: 'Vou chamar alguém da equipe para te ajudar.' Depois disso, não responda sobre o assunto."

## Erro 6: tom robótico ou de telemarketing

- Ruim: "Prezado cliente, agradecemos imensamente o seu contato. Em que podemos ser úteis no dia de hoje?"
- Por que falha: no WhatsApp isso soa como robô e reduz resposta.
- Corrigido: "Oi, Marina! Tudo bem? Me conta o que você está procurando que eu te ajudo."

## Erro 7: markdown em mensagem de WhatsApp

- Ruim: o prompt não fala de formato e o agente responde com títulos, negrito duplo e listas longas.
- Por que falha: o WhatsApp mostra os símbolos crus ou formata de forma estranha. Parece texto de outro sistema.
- Corrigido: "Escreva como uma pessoa no WhatsApp: frases curtas, sem markdown, sem títulos, sem listas longas."

## Erro 8: respostas longas demais

- Ruim: o agente explica o procedimento inteiro em um bloco de 15 linhas.
- Por que falha: ninguém lê; a pessoa some.
- Corrigido: "Máximo de três frases por mensagem. Termine com uma pergunta ou um próximo passo."

## Erro 9: muitas perguntas de uma vez

- Ruim: "Qual seu nome completo, idade, procedimento desejado, melhor dia e horário e como nos conheceu?"
- Por que falha: parece formulário; a pessoa responde só uma parte ou desiste.
- Corrigido: "Faça uma pergunta por mensagem. Pergunte só o que muda o próximo passo."

## Erro 10: marcadores vazios no prompt

- Ruim: "Nosso endereço é [ENDEREÇO] e atendemos das [HORA] às [HORA]."
- Por que falha: o agente repete os colchetes para o cliente ou inventa o valor.
- Corrigido: escrever o dado real ou a regra: "Se perguntarem o endereço e ele não estiver aqui, diga que envia em seguida e avise a equipe."

## Erro 11: prometer resultado em saúde, jurídico ou finanças

- Ruim: "Garanta à paciente que o resultado é natural e definitivo." ou "Diga que temos alto índice de vitória nas causas."
- Por que falha: viola normas de publicidade de conselhos profissionais (verificar a norma vigente) e expõe o negócio.
- Corrigido: "Nunca prometa resultado. Fale do processo: avaliação, plano, acompanhamento. O resultado depende de cada caso e é discutido com o profissional."

## Erro 12: sem tratamento de assunto fora do escopo

- Ruim: nada sobre perguntas que não têm relação com o negócio.
- Por que falha: o agente vira chatbot genérico, responde receita de bolo ou política, gasta tokens e expõe a marca.
- Corrigido: "Se a pergunta não for sobre a clínica, diga com gentileza que só pode ajudar com atendimentos e volte ao assunto."

## Erro 13: descuido com dados pessoais e LGPD

- Ruim: "Peça CPF, RG, endereço completo e fotos dos exames logo no início."
- Por que falha: coleta mais dado que o necessário (princípio da minimização da LGPD) e dado de saúde é sensível.
- Corrigido: "Peça só nome e telefone para agendar. Não solicite exames ou documentos pelo WhatsApp, salvo orientação da equipe."

## Erro 14: restrição excessiva que deixa o agente inútil

- Ruim: "Nunca fale de preços, nunca fale de procedimentos, nunca agende sem falar com a recepção."
- Por que falha: o agente só sabe dizer "vou chamar alguém". Isso é uma caixa de recado cara.
- Corrigido: definir o que ele pode fazer sozinho (agendar avaliação, explicar o processo, informar horários) e restringir só o que é realmente arriscado.

## Erro 15: nenhum exemplo de diálogo

- Ruim: só regras abstratas.
- Por que falha: o modelo interpreta "seja cordial e objetivo" de mil jeitos.
- Corrigido: incluir 2 a 4 trocas curtas: caminho feliz, pergunta de preço, transferência. Marcar como "exemplo de estilo, adapte".

## Erro 16: vários agentes num prompt só

- Ruim: o mesmo prompt vende, agenda, cobra, faz suporte técnico e pesquisa de satisfação.
- Por que falha: objetivos competem, o agente não sabe para onde conduzir.
- Corrigido: um agente por objetivo principal, ou um objetivo principal com secundários claros ("se a pessoa quiser pagar uma fatura, envie o link e volte ao agendamento").

## Checklist rápido para revisar um prompt antes de ativar

- [ ] Papel e objetivo em até cinco linhas.
- [ ] Informações operacionais completas para o foco (preço ou regra, serviços, horários).
- [ ] Regra do que fazer quando não sabe.
- [ ] Lista "nunca" curta e coerente com o nicho.
- [ ] Gatilhos de transferência e frase de passagem.
- [ ] Formato WhatsApp: curto, sem markdown, uma pergunta por vez.
- [ ] Nenhum colchete ou marcador vazio.
- [ ] Nenhuma regra contradizendo outra.
- [ ] Exemplos de diálogo.
- [ ] Coleta mínima de dados.

Se algum item falhar, a nota provavelmente fica abaixo de 80. A pontuação está em [[global/nico/ia-prompts/rubrica-de-qualidade-de-prompt]].
