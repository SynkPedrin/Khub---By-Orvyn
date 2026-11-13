---
id: global-nico-vendas-cadencias-de-follow-up
titulo: "Cadências de follow-up por estado do lead"
descricao: "Sistema de follow-up para negócios de serviço: cadência por estado do lead, regra de valor novo a cada toque, mensagem de encerramento, regras de parada, janela de envio e LGPD."
escopo: global
dominio: vendas
framework: "Sistema Universal de Follow-up por estado do lead"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [cadência de follow-up, quantas vezes mandar mensagem para o lead, lead sumiu o que fazer, follow-up de proposta, mensagem de breakup, quando parar de mandar mensagem, follow-up sem ser chato, lead não responde]
fonte: "Orvyn OS Cerebro/conhecimento (SALES/followup-system, REMARKETING/segments, CRM/crm-architecture); conhecimento global existente (vendas-e-sdr); prática consolidada de mercado"
versao: 1
---

# Cadências de follow-up por estado do lead

Na maioria dos negócios de serviço, o maior vazamento de receita não é falta de tráfego: é lead sem resposta e proposta sem acompanhamento. Este documento define a cadência certa para cada estado do lead e as regras que impedem o follow-up de virar cobrança.

## Tese do follow-up: onde a receita vaza

O follow-up é a alavanca mais ignorada do processo comercial. Antes de concluir que "o tráfego não presta", meça:
- Quantos leads nunca receberam resposta?
- Quantos responderam e pararam sem ninguém retomar?
- Quantas propostas foram enviadas e nunca acompanhadas?
- Quantos no-shows nunca foram reagendados?

Se essas filas são grandes, o problema é follow-up, não aquisição. Recuperar esses leads gera receita sem verba nova de mídia. Ver [[global/nico/vendas/reativacao-e-recompra]].

## Cadência por estado do lead

| Estado | Janela | Cadência | Canal | Mensagem-mãe |
|---|---|---|---|---|
| Lead novo | 0 a 5 min | Resposta imediata (agente de IA) | Mesmo canal de entrada | Confirmar interesse + 1 pergunta de qualificação |
| Respondeu e sumiu | 24h, 72h, 7 dias | 3 toques decrescentes | WhatsApp | Retomar a última dor citada |
| Não compareceu (no-show) | 1h, 24h | Reagendamento sem culpa | WhatsApp + ligação | Novo horário fácil, em 1 resposta |
| Proposta enviada | 48h, 5 dias, 12 dias | Valor novo a cada toque | WhatsApp ou e-mail | Prova, resposta a objeção, ajuste de escopo |
| Perdido (não comprou) | 30 e 90 dias | Reativação | Mensagem + remarketing | Novo ângulo ou nova condição real |

Cada estado precisa existir no CRM como etapa ou tag. O que não tem etapa não tem follow-up. Ver [[global/nico/crm-automacao/desenho-de-pipeline]].

## Duas visões de cadência e como escolher

Existem duas referências na base de conhecimento da NICO, e as duas são válidas:

- **Cadência por estado** (este documento): 24h, 72h, 7 dias para quem respondeu e sumiu; 48h, 5d, 12d para proposta. Ideal quando o CRM registra bem o estado do lead.
- **Cadência linear do lead novo** ([[global/vendas-e-sdr]]): resposta em menos de 5 min, D+0 tentativa de agendamento, D+1, D+3, D+7 com valor, D+14 encerramento. Ideal para leads novos de campanha que ainda não engajaram.

Regra de decisão: se o lead nunca respondeu, use a cadência linear (D+0 a D+14). Se respondeu e parou, ou recebeu proposta, use a cadência por estado. Não rode as duas ao mesmo tempo para o mesmo contato.

## Regra do valor novo a cada toque

Follow-up sem valor novo é cobrança, e cobrança é proibida. Cada toque precisa entregar algo:

| Tipo de valor | Exemplo |
|---|---|
| Retomar a dor | "Você comentou que [dor]. Isso ainda está te incomodando?" |
| Resposta a objeção provável | "Muita gente fica em dúvida sobre [objeção]. Funciona assim: ..." |
| Prova permitida | Avaliação de cliente (com consentimento), número de atendimentos real, bastidor |
| Conteúdo útil | Um vídeo ou texto curto que ajuda na decisão |
| Facilitação | "Liberou um horário quinta às 10h, quer que eu reserve?" |
| Condição real | Agenda da semana, lote, prazo verdadeiro (nunca escassez falsa) |

Proibido: "Oi, conseguiu ver?", "E aí, alguma novidade?", "Só passando pra lembrar".

## Exemplos de toques por estado

Exemplos hipotéticos, adaptar ao tom da marca.

**Respondeu e sumiu (estética)**
- 24h: "Oi, [nome]! Você comentou que queria cuidar das manchas antes do verão. Quer que eu te mostre como funciona a avaliação?"
- 72h: "Uma dúvida comum é se dói ou se precisa de afastamento. Na maioria dos protocolos a rotina segue normal, e a profissional explica tudo na avaliação. Posso ver um horário?"
- 7 dias: "Vou deixar sua conversa aqui guardada. Quando quiser retomar, é só me chamar que eu vejo os horários. Combinado?"

**Proposta enviada (contabilidade)**
- 48h: "Oi, [nome]. Ficou alguma dúvida sobre o que está incluso na proposta? Posso explicar em 5 min por áudio."
- 5 dias: "Um ponto que costuma pesar na decisão: na troca de contador, nós cuidamos da transição de documentos com o escritório atual. Você não precisa se preocupar com isso."
- 12 dias: "Quer que eu ajuste o escopo pra caber melhor no momento da empresa? Às vezes faz sentido começar só com [parte]."

**No-show (odontologia)**
- 1h: "Oi, [nome], sentimos sua falta hoje! Imprevistos acontecem. Quer remarcar? Tenho [opção 1] ou [opção 2]."
- 24h: "Passando pra facilitar: posso reservar [opção]? Se preferir outro dia, me fala."

## Mensagem de encerramento (breakup)

O último toque de uma cadência deve encerrar com elegância e deixar a porta aberta. Funciona porque tira a pressão e dá ao lead um motivo simples para responder.

Modelo: "[Nome], não quero te incomodar. Vou encerrar seu atendimento por aqui por enquanto. Se em algum momento fizer sentido, é só me mandar um oi que eu retomo de onde paramos."

Depois do encerramento, o lead vai para o estado "perdido" e entra na reativação de 30 e 90 dias com novo ângulo.

## Regras de parada da cadência

A cadência para imediatamente quando:
1. O lead responde (a conversa volta para atendimento humano ou agente).
2. O lead agenda, compra ou atinge o objetivo do fluxo (porta de saída).
3. O lead pede para não receber mensagens (opt-out): marcar "não perturbe" no CRM e respeitar em todos os canais.
4. O lead é desqualificado (fora do perfil, fora da área de atendimento).

No KHUB, isso se implementa com o nó de esperar resposta (ramo resposta encerra o fluxo de cobrança) e com a ação de não perturbe. Ver [[global/nico/crm-automacao/receitas-de-fluxos-essenciais]].

## Janela de envio, frequência e LGPD

- **Janela de envio**: mensagens só em horário comercial do negócio (ex.: dias úteis, 9h às 18h, no fuso local). Mensagem de madrugada queima marca e aumenta denúncia de spam.
- **Frequência**: no máximo um toque por dia por contato, somando todos os fluxos. Dois fluxos disparando no mesmo dia para a mesma pessoa é erro de configuração.
- **Consentimento**: só enviar para quem iniciou contato ou deu consentimento. Base comprada não entra em cadência.
- **Opt-out**: toda cadência longa deve permitir sair. Respeitar o pedido de parada é obrigação, não gentileza.
- **WhatsApp oficial**: mensagens fora da janela de atendimento da plataforma podem exigir modelo aprovado. Verificar a política atual da Meta antes de configurar.

## Métricas da cadência de follow-up

| Métrica | Fórmula | Leitura |
|---|---|---|
| Taxa de resposta por toque | respostas no toque / contatos que receberam | Toque com resposta perto de zero precisa de nova mensagem |
| Recuperação de propostas | propostas que fecharam após follow-up / propostas paradas | Mede o valor do follow-up de proposta |
| Reagendamento de no-show | reagendados / no-shows | Se baixo, revisar tom e facilidade de remarcar |
| Opt-out por cadência | pedidos de parada / contatos | Se alto, mensagem invasiva ou frequente demais |
| Receita recuperada | receita de leads que fecharam após 2º toque ou mais | Argumento para manter a automação |

## Checklist de cadência pronta

- [ ] Cada estado do lead existe no CRM.
- [ ] Cada toque tem valor novo escrito e aprovado pelo dono.
- [ ] Porta de saída configurada (respondeu, agendou, comprou, opt-out).
- [ ] Janela de envio ativa.
- [ ] Encerramento elegante no último toque.
- [ ] Métrica de resposta acompanhada por toque.
