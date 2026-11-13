---
id: global-nico-ia-prompts-compliance-de-agentes-nichos-regulados
titulo: "Compliance de agentes de IA em nichos regulados"
descricao: "O que um agente de atendimento pode e não pode fazer em saúde, advocacia, contabilidade e finanças, com noções de CDC e LGPD, frases obrigatórias, gatilhos de escalonamento e checklist de validação."
escopo: global
dominio: ia-prompts
framework: "Guardrails PODE / NÃO PODE por domínio"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [o que o agente da clínica pode responder, agente de advocacia pode falar de caso, regras do cfm para atendimento, lgpd no whatsapp, agente pode passar preço de procedimento, compliance de ia em saúde, o que o agente não pode prometer, cuidados do cdc no atendimento]
fonte: "Orvyn OS Cerebro/conhecimento (HEALTH, LEGAL e FINANCE guardrails, NICHES/health/regulatory, NICHES/legal); base RAG KHUB (medico, juridico, contabil); prática consolidada"
versao: 1
---

# Compliance de agentes de IA em nichos regulados

Agente de atendimento em nicho regulado opera sob escopo negativo explícito: ele organiza, informa em termos gerais, agenda e encaminha. Ele não diagnostica, não dá parecer e não promete resultado. Este documento consolida as regras por nicho para uso em prompts. Detalhes normativos de cada nicho estão em [[medico/medicina]], [[juridico/compliance-oab]], [[juridico/leis-e-links]] e [[contabil/contabil]]. Princípio permanente: informação não é recomendação profissional.

## Agentes de saúde (clínica médica, odontologia, estética): pode e não pode

PODE:
- Agendar, remarcar, confirmar e lembrar consultas e avaliações.
- Explicar como funciona o atendimento: duração, preparo administrativo informado pela clínica, documentos, convênios aceitos, formas de pagamento.
- Dar informação geral não clínica sobre um serviço, com base no que a clínica validou.
- Fazer triagem administrativa (logística), nunca diagnóstica.

NÃO PODE:
- Diagnosticar, interpretar exames, sugerir tratamento ou medicamento, dar prognóstico.
- Avaliar fotos ou sintomas enviados pela pessoa.
- Prometer resultado ("garantido", "definitivo", "sem dor", "100%").
- Usar antes e depois, depoimentos ou preço como chamariz sem verificar a norma vigente do conselho (CFM, CFO ou outro).
- Pedir ou repetir dados de saúde além do necessário.

Frases-modelo:
- "Essa avaliação quem faz é a profissional, pessoalmente. Posso marcar um horário para você?"
- Sinal de urgência ("dor forte", "sangramento", "falta de ar", reação após procedimento): "Pelo que você descreveu, procure atendimento imediato agora. Vou avisar a equipe da clínica também."

Procedimentos invasivos em estética exigem profissional habilitado; o agente não indica procedimento antes da avaliação.

## Agentes de advocacia: pode e não pode

PODE:
- Fazer triagem inicial: área do problema, se há prazo informado, preferência de atendimento.
- Agendar consulta e informar documentos úteis listados pelo escritório.
- Explicar como funciona a consulta e o atendimento do escritório.
- Responder dúvidas gerais e informativas, sem aplicar ao caso concreto.

NÃO PODE:
- Dizer se a pessoa tem ou não direito, estimar valores, chances ou prazos do caso.
- Citar artigo de lei, súmula ou jurisprudência sem fonte verificada.
- Prometer resultado ou usar honorários como chamariz.
- Fazer abordagem ativa de captação de clientela (por exemplo, disparo frio oferecendo ação). Publicidade advocatícia tem caráter informativo; verificar o Código de Ética e Disciplina e o Provimento vigente do Conselho Federal da OAB.

Frase obrigatória diante de caso concreto: "Isto é informação geral, não aconselhamento jurídico. Um advogado precisa avaliar o seu caso com os documentos." Sigilo: não pedir documentos pelo WhatsApp sem autorização do escritório.

## Agentes de contabilidade e finanças: pode e não pode

PODE (contabilidade):
- Explicar serviços do escritório, agendar diagnóstico, listar documentos de abertura ou troca de contador, lembrar prazos que o escritório cadastrou.

NÃO PODE (contabilidade):
- Prometer economia de imposto ou "redução garantida".
- Indicar regime tributário, alíquota ou enquadramento para o caso concreto sem o contador responsável.
- Orientar qualquer prática irregular.
- Citar prazo ou alíquota sem fonte e competência; quando citar, "verificar a fonte oficial vigente". Ver [[contabil/obrigacoes-e-prazos]].

PODE (finanças empresariais): explicar conceitos e organizar números. NÃO PODE: garantir retorno, recomendar investimento pessoal ou apresentar projeção como certeza. Frase: "Decisões de investimento pessoais devem considerar seu perfil e, quando apropriado, um profissional autorizado."

## Noções de CDC para agentes que falam de oferta e preço

O Código de Defesa do Consumidor (Lei 8.078/1990) afeta o que o agente diz sobre ofertas. Pontos práticos:
- Informação clara e correta: preço, condições, prazos e características não podem ser ambíguos.
- A oferta suficientemente precisa vincula o fornecedor. Por isso o agente nunca inventa condição, desconto ou prazo.
- Publicidade enganosa ou abusiva é proibida: nada de escassez falsa, "últimas vagas" sem ser verdade, ou omissão de informação relevante.
- Atendimento deve facilitar cancelamento e reclamação; o agente encaminha reclamação para humano em vez de discutir.

Para regras exatas, verificar o texto vigente da lei.

## Noções de LGPD para agentes de atendimento

A LGPD (Lei 13.709/2018) se aplica a todo dado pessoal tratado pelo agente. Regras para escrever no prompt:
- Finalidade: coletar só para o objetivo declarado (agendar, atender).
- Minimização: pedir o mínimo. Para agendar, normalmente nome e telefone bastam.
- Dado sensível: saúde, por exemplo, exige cuidado reforçado. Não replicar informação clínica em campos de marketing.
- Consentimento e opt-out: se a pessoa pedir para parar de receber mensagens, parar e registrar (no KHUB, marcar não perturbe).
- Direitos do titular: pedidos de acesso ou exclusão de dados são encaminhados para a equipe responsável.
- Transparência: se a pessoa perguntar se está falando com robô, responder com verdade.

## Gatilhos de escalonamento obrigatórios em nichos regulados

| Gatilho | Nicho | Ação do agente |
|---|---|---|
| Sintoma de urgência | Saúde | Orientar atendimento imediato e notificar equipe |
| Reação após procedimento | Estética, odonto | Orientar contato imediato com a clínica e notificar |
| Caso concreto com pedido de opinião | Advocacia, contabilidade | Frase de informação geral e oferecer consulta |
| Prazo judicial ou fiscal informado | Advocacia, contabilidade | Prioridade para humano |
| Reclamação, ameaça de processo, menção a órgão de defesa do consumidor | Todos | Humano imediatamente, sem discutir |
| Pedido de exclusão de dados | Todos | Registrar e encaminhar |
| Pedido de desconto fora da tabela | Todos | Humano |

## Checklist do validador de compliance do agente

Use antes de ativar o agente e em auditoria de conversas:
- [ ] O prompt proíbe diagnóstico, parecer e promessa de resultado (quando o nicho exige).
- [ ] Há frase padrão para caso concreto e para urgência.
- [ ] Nenhum termo bloqueado no prompt ou nos exemplos: garantido, definitivo, sem dor, 100%, cura, vitória certa, economia garantida.
- [ ] Preços e condições vêm de fonte validada pelo dono; sem estimativa.
- [ ] Coleta mínima de dados e regra de opt-out.
- [ ] Gatilhos de escalonamento escritos.
- [ ] Publicidade (antes e depois, depoimentos, preço) checada contra a norma vigente do conselho e a política atual da plataforma.
- [ ] A base de conhecimento foi revisada pelo profissional responsável.

O KHUB aplica guardrail em duas camadas (regras no prompt e validação após a resposta). Um prompt bem escrito reduz bloqueios do validador, mas não substitui a revisão humana em nicho regulado.
