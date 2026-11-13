---
id: global-nico-trafego-pago-meta-ads-estrutura-de-conta
titulo: "Meta Ads: estrutura de conta, campanhas, conjuntos e anúncios"
descricao: "Como montar e auditar uma conta de Meta Ads: hierarquia, escolha de objetivo, CBO vs ABO, Advantage+, públicos, pixel e API de Conversões, destinos de conversão e fase de aprendizado."
escopo: global
dominio: trafego-pago
framework: "Estrutura mínima V1 de Meta Ads (aquisição + remarketing) com consolidação"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [como estruturar campanha no meta ads, cbo ou abo, vale usar advantage+, qual objetivo escolher no facebook ads, como configurar pixel e api de conversões, o que é fase de aprendizado, campanha de mensagem ou formulário, quantos conjuntos de anúncio usar, como nomear campanhas]
fonte: "Orvyn OS Cerebro/conhecimento (PAID-TRAFFIC/meta-ads, PAID-TRAFFIC/principles, DECISION-ENGINE/budget-strategies); DAILY KROMA kroma-os/docs (notas de métricas Meta Ads); prática consolidada de mercado"
versao: 1
---

# Meta Ads: estrutura de conta, campanhas, conjuntos e anúncios

Este documento é o mapa que a NICO usa para montar ou auditar uma conta de Meta Ads (Facebook e Instagram) de negócios locais e de serviços. A parte conceitual é estável. Nomes de objetivos, recursos de Advantage+ e regras de segmentação mudam com frequência: sempre verificar o recurso e a política atual da plataforma antes de implementar.

## Hierarquia do Meta Ads: campanha, conjunto e anúncio

| Nível | O que define | Pergunta que responde |
|---|---|---|
| Campanha | Objetivo, orçamento (se CBO), categoria especial | O que eu quero que a Meta otimize? |
| Conjunto de anúncios | Público, posicionamentos, evento de conversão, orçamento (se ABO), agenda | Para quem, onde e com qual evento? |
| Anúncio | Criativo, texto, título, CTA, destino | O que a pessoa vê e para onde vai? |

Regra: cada nível tem uma função. Misturar testes de público e de criativo no mesmo conjunto impede saber o que funcionou.

## Escolha do objetivo e do evento de otimização no Meta Ads

A campanha otimiza para o evento configurado. Escolher o evento mais profundo que tenha volume estatístico suficiente.

| Situação | Objetivo e evento recomendados |
|---|---|
| Clínica que agenda pelo WhatsApp | Engajamento ou Leads com destino de mensagem, otimizando para conversas (e depois para lead qualificado via CAPI quando houver volume) |
| Escritório de advocacia com formulário | Leads com formulário instantâneo com pergunta de qualificação, ou site com evento Lead |
| Contabilidade com landing page | Leads (site) com evento Lead ou agendamento |
| Conta nova sem histórico | Começar com evento de topo (conversa, lead) e migrar para evento mais profundo quando houver volume |
| Remarketing de base | Leads ou Vendas, com público personalizado |

Referência comum de mercado: o algoritmo precisa de algo em torno de 50 eventos por conjunto por semana para estabilizar (referência de mercado, validar no Gerenciador atual). Se o evento profundo não alcança esse volume, subir um degrau no funil.

Observação de leitura: o "resultado" que o Gerenciador mostra depende da meta de otimização do conjunto (leads, conversas, compras). Campanha com conjuntos de tipos diferentes não deve ter os resultados somados como se fossem a mesma coisa.

## Convenção de nomes para campanhas de Meta Ads

Nome padronizado permite que a NICO e o time leiam relatórios sem abrir cada campanha.

Modelo: `[objetivo]_[temperatura]_[oferta ou serviço]_[público]_[data]`

Exemplos hipotéticos:
- Campanha: `LEADS_FRIO_avaliacao-facial_amplo_2026-11`
- Conjunto: `amplo_F25-55_raio10km`
- Anúncio: `video_hook-dor_v3`

Regras: sem espaços, temperatura sempre presente (FRIO, MORNO, QUENTE, RMKT), versão do criativo no nome do anúncio.

## CBO vs ABO no Meta Ads

- **ABO (orçamento no conjunto)**: você controla quanto cada conjunto gasta. Ideal para **teste**, quando é preciso garantir que cada variação receba verba.
- **CBO (orçamento na campanha, chamado de Advantage campaign budget)**: o algoritmo distribui a verba entre os conjuntos. Ideal para **escala**, quando já há vencedores.

Regra das bases: testar com controle, escalar com delegação.

| Se... | Então... |
|---|---|
| Está testando públicos ou ofertas diferentes | ABO, orçamento igual por conjunto |
| Tem 2 ou 3 conjuntos validados | CBO para consolidar e escalar |
| Um conjunto em CBO não recebe verba | Normal: o algoritmo escolheu. Se for estratégico, mover para ABO ou usar limite mínimo de gasto |
| Orçamento total baixo (até poucos mil reais por mês) | Menos conjuntos, mais consolidação |

Visão alternativa: há gestores que testam criativos dentro de CBO com vários anúncios no mesmo conjunto e deixam o algoritmo escolher. Funciona bem com orçamento maior, mas tira controle de leitura. A NICO apresenta as duas opções e recomenda conforme a verba.

## Advantage+ no Meta Ads: quando usar e quando evitar

Advantage+ é o conjunto de automações da Meta: público Advantage+ (amplo com sugestões), posicionamentos Advantage+, criativo Advantage+ (variações automáticas) e campanhas Advantage+ completas.

Usar quando:
- O sinal de conversão é bom (pixel e CAPI corretos, evento com volume).
- Há variedade de criativos para o algoritmo combinar.
- O objetivo é escala com orçamento razoável.

Evitar ou restringir quando:
- Nicho regulado (saúde, estética, advocacia): melhorias automáticas de criativo podem gerar texto ou imagem que viola norma do conselho. Revisar ou desligar as variações automáticas de texto e imagem.
- Negócio local com raio de atendimento estreito: conferir que a localização não foi expandida.
- Conta sem eventos de conversão confiáveis: a automação otimiza no escuro.

Sempre verificar o comportamento atual do recurso, porque a Meta muda as opções com frequência.

## Públicos no Meta Ads: amplo, interesses, semelhantes e personalizados

| Tipo | Uso | Cuidado |
|---|---|---|
| Amplo (só idade, gênero, localização) | Padrão para aquisição quando o criativo filtra bem | Exige criativo específico |
| Interesses | Teste inicial ou nicho muito específico | Interesses mudam e somem |
| Semelhante (lookalike) | Escala a partir de fonte de qualidade | Fonte ruim gera semelhante ruim: usar clientes, não leads frios |
| Personalizado: site, engajamento, vídeo | Remarketing (morno) | Janela de 30 a 90 dias conforme volume |
| Personalizado: lista do CRM | Remarketing de base, recompra, exclusão | Só dados obtidos licitamente, com base legal LGPD |

Exclusões obrigatórias: clientes atuais em campanhas de aquisição (salvo upsell), leads recentes em campanhas frias, quem já agendou em campanhas de agendamento.

## Pixel, API de Conversões e deduplicação

- **Pixel**: evento no navegador. Perde dados por bloqueadores e restrições de privacidade.
- **API de Conversões (CAPI)**: evento enviado pelo servidor. Mais resiliente.
- **Deduplicação**: o mesmo evento vindo dos dois lados precisa do mesmo `event_id` para não contar duas vezes.
- **Conversões offline ou de CRM**: enviar para a Meta quando o lead vira agendamento ou venda, para que o algoritmo aprenda quem fecha.

Checklist de auditoria:
- [ ] Domínio verificado.
- [ ] Eventos prioritários configurados.
- [ ] CAPI ativa com qualidade de correspondência aceitável.
- [ ] Deduplicação funcionando.
- [ ] Evento de lead qualificado ou venda voltando do CRM.

## Destino da conversão: formulário, WhatsApp ou site

| Destino | Vantagem | Risco | Bom para |
|---|---|---|---|
| Formulário instantâneo | CPL baixo, sem página | Lead de baixa intenção | Volume, quando há SDR rápido |
| Clique para WhatsApp | Conversa direta, natural no Brasil | Conversa sem qualificação, depende de resposta rápida | Clínicas, estética, serviços locais |
| Site ou landing page | Mais qualificação, melhor rastreio | CPL maior, exige página boa | Advocacia, contabilidade, ticket alto |

Regra: no funil local, o WhatsApp é o funil. Se a resposta demora, nenhum destino salva a campanha. Para formulário, incluir 1 ou 2 perguntas de qualificação ou o formato de maior intenção para filtrar curiosos.

## Fase de aprendizado no Meta Ads

Todo conjunto novo ou editado de forma significativa entra em aprendizado. Durante essa fase, custo e entrega oscilam.

O que costuma reiniciar o aprendizado (verificar a lista atual da Meta):
- Mudar o evento de otimização ou o público.
- Adicionar ou trocar criativos no conjunto.
- Mudar o orçamento de forma brusca.
- Pausar por vários dias e reativar.

Regras da NICO:
- Não julgar conjunto com menos de 3 a 7 dias ou sem volume mínimo de eventos (referência de mercado, validar).
- Não editar conjunto em aprendizado por ansiedade com um dia ruim.
- "Aprendizado limitado" persistente significa evento raro demais ou verba baixa demais para o CPA: consolidar conjuntos ou subir o evento no funil.

## Estrutura mínima V1 de Meta Ads para negócios locais

1. **Campanha de aquisição (frio)**: 1 a 3 conjuntos (amplo, semelhante, interesse), 3 a 5 criativos por conjunto.
2. **Campanha de remarketing (morno e quente)**: público de engajamento, visitantes e leads sem agendamento, com mensagens de prova e objeção.
3. **Teste contínuo**: 10 a 20% da verba testando novos criativos.

Consolidar vencedores. Contas pequenas fragmentadas em dez conjuntos não saem do aprendizado.

## Políticas de saúde, estética e advocacia no Meta Ads

- Saúde e estética têm políticas próprias na Meta (alegações de resultado, imagens de antes e depois, foco em características pessoais).
- Conselhos profissionais (CFM, CFO e outros) restringem promessa de resultado, antes e depois, sensacionalismo e uso de depoimento. Verificar a norma vigente do conselho específico.
- Advocacia: publicidade informativa, sem mercantilização nem captação indevida. Ver [[juridico/compliance-oab]].
- Regra dupla: checar política atual da plataforma e norma do conselho antes de subir qualquer anúncio. Ver [[medico/medicina]].

Ligações: [[global/nico/trafego-pago/meta-ads-teste-de-criativos]], [[global/nico/trafego-pago/meta-ads-escala-e-orcamento]], [[global/nico/trafego-pago/principios-de-midia-paga]].
