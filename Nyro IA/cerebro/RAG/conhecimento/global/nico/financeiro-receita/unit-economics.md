---
id: global-nico-financeiro-receita-unit-economics
titulo: "Unit economics: CAC, LTV, margem de contribuição e payback"
descricao: "Como calcular e interpretar CAC, LTV, margem de contribuição, LTV:CAC, payback e churn em negócios de serviço, com exemplos e sinais de alerta."
escopo: global
dominio: financeiro-receita
framework: "Unit economics (CAC, LTV, margem de contribuição, payback)"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [quanto posso pagar por cliente, como calcular CAC, como calcular LTV, o que é margem de contribuição, meu marketing dá lucro, payback do investimento em anúncio, LTV CAC ideal, quanto vale um cliente]
fonte: "Orvyn OS Cerebro/conhecimento (BUSINESS-MODELS, FINANCE, NICHES/health); prática consolidada de mercado"
versao: 1
---

# Unit economics: CAC, LTV, margem de contribuição e payback

Unit economics responde a pergunta mais importante de qualquer investimento em marketing: cada cliente novo deixa dinheiro no caixa ou consome dinheiro? Este documento mostra como a NICO calcula, lê e explica CAC, LTV, margem de contribuição, LTV:CAC, payback e churn para negócios de serviço (clínicas, estética, advocacia, contabilidade, serviços locais e agências).

## Por que unit economics vem antes de qualquer decisão de verba

Unit economics é a economia de um cliente só: quanto custa conquistá-lo e quanto ele deixa de margem ao longo da relação. Sem esses números, escalar anúncio é apostar.

Regras de uso pela NICO:
- **CPL barato não é meta.** A meta é CAC pago de volta pelo LTV dentro de um prazo que o caixa aguenta (princípio de mídia paga, ver [[global/nico/trafego-pago/principios-de-midia-paga]]).
- **Use margem, não receita.** LTV calculado sobre faturamento infla o valor do cliente e justifica CAC que dá prejuízo.
- **Compare o negócio com ele mesmo.** Benchmark externo sem fonte verificada não entra na análise. Tendência por coorte do próprio negócio é sempre válida.
- **Toda projeção é [ESTIMATIVA]**, com premissas explícitas e três cenários (pessimista, base, otimista).

## Como calcular o CAC (custo de aquisição de cliente)

**Fórmula:** CAC = custo total de aquisição no período ÷ número de clientes novos no período.

O que entra no custo de aquisição:
- Mídia paga (Meta, Google, TikTok e outros).
- Fee da agência ou do gestor de tráfego.
- Produção de criativos e conteúdo voltado a aquisição.
- Ferramentas de aquisição (CRM, automação, disparos) proporcionalmente.
- Comissão ou salário de quem vende (SDR, recepção comercial, closer), quando dedicado a novos clientes.

Dois CACs que a NICO sempre separa:
- **CAC por canal:** só a mídia e custos daquele canal ÷ clientes atribuídos a ele. Serve para decidir onde colocar verba.
- **CAC misto (blended):** todo custo de aquisição ÷ todos os clientes novos, inclusive indicação e orgânico. Serve para saber se o negócio como um todo é saudável.

Cuidados:
- Cliente novo é quem **pagou**, não quem virou lead. Para clínica, quem fez o procedimento ou pagou a avaliação; para escritório, quem assinou contrato.
- Remarketing para a base atual não entra no CAC de aquisição fria. Reportar separado, porque misturar infla o ROAS e engana a decisão.
- Use o CRM e o caixa como fonte de verdade de clientes, não o painel da plataforma (hierarquia: caixa, depois CRM, depois plataforma).

## Margem de contribuição: o número que quase ninguém calcula

Margem de contribuição é o que sobra de cada venda depois dos custos que só existem porque a venda aconteceu. É ela que paga as despesas fixas e gera lucro.

**Fórmula:** Margem de contribuição = preço de venda menos custos variáveis.
**Percentual:** MC% = margem de contribuição ÷ preço de venda.

Custos variáveis típicos em serviços:
- Insumos e materiais (ácido, toxina, fio, resina, implante, descartáveis).
- Comissão do profissional ou do vendedor por atendimento.
- Taxa de cartão e antecipação de recebíveis.
- Impostos sobre a venda (validar a alíquota real com o contador).
- Laboratório, exame terceirizado, custas repassadas.

O que **não** entra: aluguel, salários fixos, sistema, contador, pró-labore. Isso é despesa fixa e aparece na DRE (ver [[global/nico/financeiro-receita/dre-e-verba-de-marketing]]).

Exemplo hipotético (procedimento estético de R$ 1.000):
- Insumos: R$ 250. Comissão da profissional: R$ 150. Taxa de cartão: R$ 40. Impostos sobre venda: R$ 60.
- Margem de contribuição = 1.000 menos 500 = R$ 500 (50%).

## Como calcular o LTV (valor do cliente no tempo)

**Fórmula base:** LTV = margem de contribuição média por compra × número médio de compras ao longo da relação.
**Para recorrência mensal:** LTV = margem de contribuição mensal por cliente × tempo médio de permanência em meses (ou ÷ churn mensal).

Como chegar ao número de compras na prática:
- Puxe do CRM os clientes que entraram há 12 a 24 meses (uma coorte).
- Conte quantas vezes cada um comprou ou quantos meses ficou.
- Use a média dessa coorte, não a média corrida de toda a base (média corrida esconde tendência).

O que a NICO lembra ao dono:
- **LTV subestimado é o erro mais comum em saúde.** Retorno, manutenção, família do paciente e indicações compõem o valor real. Clínica que mede só a primeira consulta subprecifica o marketing.
- Em contabilidade e agências, o LTV vem do tempo de permanência: um mês a mais de retenção média vale mais do que um corte de 10% no CAC.
- Em advocacia por êxito, o LTV depende do prazo de recebimento: honorário que entra em 2 anos não paga o CAC deste mês.

## LTV:CAC e payback: como ler a saúde da máquina

**LTV:CAC = LTV ÷ CAC.** Regra prática citada no mercado: 3:1 ou mais é saudável (referência de mercado, validar; varia por modelo e por caixa disponível).

Leitura:
| LTV:CAC | Leitura | Ação |
|---|---|---|
| Abaixo de 1 | Cada cliente destrói valor | Parar de escalar; revisar oferta, preço, conversão |
| 1 a 2 | Paga a aquisição, sobra pouco para o fixo | Melhorar conversão e retenção antes de subir verba |
| 2 a 3 | Saudável em fase de crescimento | Escalar com cuidado, monitorar payback |
| Acima de 3 a 5 | Muito bom ou subinvestido | Testar mais verba, há espaço para crescer |

**Payback de CAC = CAC ÷ margem de contribuição mensal por cliente.** Diz em quantos meses o cliente devolve o custo de aquisição.

Regra: o payback precisa caber no caixa. Um LTV:CAC de 4 com payback de 14 meses pode quebrar uma clínica pequena que não tem caixa para esperar.

## CAC máximo suportável

O CAC máximo é quanto o negócio pode pagar por cliente sem perder dinheiro na janela de caixa aceita.

**Fórmula simples:** CAC máximo = margem de contribuição obtida dentro da janela de payback desejada.
**Com meta de LTV:CAC:** CAC máximo = LTV ÷ razão desejada (ex.: LTV ÷ 3).

Do CAC máximo deriva o **CPL máximo**: CPL máximo = CAC máximo × taxa de conversão lead em cliente.

Exemplo hipotético: CAC máximo R$ 300 e 1 em cada 10 leads vira cliente (10%). CPL máximo = 300 × 0,10 = R$ 30. Se o CPL atual é R$ 45, ou baixa o CPL (criativo, oferta) ou sobe a conversão (atendimento, follow-up). Subir verba piora.

## Exemplo hipotético completo: clínica odontológica

Premissas [ESTIMATIVA]:
- Ticket médio do primeiro tratamento: R$ 2.000, MC 45% = R$ 900.
- Retornos e manutenções em 24 meses: 2 compras adicionais de R$ 400 com MC 60% = R$ 480.
- LTV em 24 meses = 900 + 480 = R$ 1.380.
- Mídia do mês: R$ 3.000. Fee e produção: R$ 1.500. Total R$ 4.500.
- Pacientes novos pagantes no mês: 15. CAC = 4.500 ÷ 15 = R$ 300.
- LTV:CAC = 1.380 ÷ 300 = 4,6. Payback: o primeiro tratamento já devolve R$ 900, payback no primeiro mês.

Leitura da NICO: espaço para escalar, desde que a agenda tenha capacidade e o show rate se mantenha.

## Exemplo hipotético completo: escritório de contabilidade

Premissas [ESTIMATIVA]:
- Mensalidade média: R$ 600. Custos variáveis por cliente (horas de analista alocadas, sistema por CNPJ, impostos): R$ 330. MC mensal = R$ 270.
- Churn mensal: 2%. Permanência média = 1 ÷ 0,02 = 50 meses.
- LTV = 270 × 50 = R$ 13.500.
- CAC misto: R$ 1.800 (Google, conteúdo, comissão de indicação).
- LTV:CAC = 7,5. Payback = 1.800 ÷ 270 = 6,7 meses.

Leitura da NICO: o negócio aguenta CAC maior; o limitador é caixa para os primeiros 7 meses e capacidade de onboarding. Reduzir churn de 2% para 1,5% sobe o LTV para R$ 18.000, alavanca mais forte que cortar CAC.

## Churn e retenção por coorte

**Churn = clientes perdidos no período ÷ base no início do período.**

Boas práticas:
- Medir por coorte (clientes que entraram no mesmo mês) e acompanhar quantos seguem ativos no mês 1, 3, 6, 12.
- Em serviços não recorrentes (estética, odonto), "churn" vira **taxa de inatividade**: quem não voltou dentro do ciclo natural do serviço (ex.: manutenção a cada 4 a 6 meses).
- Registrar motivo de saída em lista fechada no CRM. Motivo de perda é ouro para oferta e copy.

## Sinais de alerta em unit economics

A NICO sinaliza quando encontrar:
1. CAC subindo três meses seguidos sem aumento de ticket ou retenção.
2. LTV calculado sobre receita, não margem.
3. ROAS da plataforma alto, mas caixa não acompanha (atribuição inflada ou remarketing misturado).
4. Payback maior que o caixa disponível em meses.
5. Crescimento de clientes novos com queda de clientes ativos (balde furado: corrigir retenção antes de escalar).
6. Margem de contribuição abaixo de 30% em serviço com CAC alto (referência de mercado, validar): pouco espaço para pagar aquisição.

Quando faltam dados, a NICO não inventa: pede os números mínimos (ticket, custos variáveis, clientes novos, gasto de aquisição) e marca o resto como [PREMISSA].
