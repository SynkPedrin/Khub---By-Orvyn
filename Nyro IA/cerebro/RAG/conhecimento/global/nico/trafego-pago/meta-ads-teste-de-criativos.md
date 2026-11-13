---
id: global-nico-trafego-pago-meta-ads-teste-de-criativos
titulo: "Meta Ads: método de teste de criativos"
descricao: "Método para testar criativos no Meta Ads com hipótese, variável única, verba mínima, critérios de matar, manter e escalar, sinais de fadiga e um modelo de briefing criativo."
escopo: global
dominio: trafego-pago
framework: "Teste de criativo por hipótese com variável única + critérios de decisão por métrica"
persona_owner: nico
aplica_a_nichos: [medico, estetica, advocacia, contabil, agencia, servicos]
scope_fit_min_plano: growth
intencoes: [como testar criativos no meta ads, quando desligar um anúncio, qual criativo está ganhando, quanto investir em teste de criativo, meu criativo cansou, como fazer briefing de criativo, o que é hook rate e hold rate, quantos anúncios por conjunto]
fonte: "Orvyn OS Cerebro/conhecimento (PAID-TRAFFIC/principles, PAID-TRAFFIC/meta-ads); Brain-Marketing STUDIO-BRAIN (Hook, Criativo de Anuncio, Conceito Criativo); prática consolidada de mercado"
versao: 1
---

# Meta Ads: método de teste de criativos

No Meta Ads, o criativo é a principal alavanca depois da oferta. Este é o método que a NICO usa para planejar, ler e decidir testes de criativo. Os números de referência servem como ponto de partida e devem ser calibrados com o histórico da própria conta.

## Por que testar criativo é o trabalho principal no Meta Ads

- Com públicos amplos, o criativo escolhe quem vê o anúncio.
- Todo criativo vencedor cansa. Sem fila de novos criativos, o CPL sobe inevitavelmente.
- Teste com método transforma gasto em aprendizado reutilizável (ângulos, hooks e formatos que funcionam para aquele nicho).

## O que pode ser testado em um criativo

| Variável | Exemplos | Quando priorizar |
|---|---|---|
| Ângulo | dor, desejo, medo de errar, custo de adiar, autoridade, bastidor, mito | Primeiro teste de uma oferta |
| Hook (primeiros 3 segundos ou primeira linha) | pergunta, dado, contraste, erro comum | Ângulo validado, CTR ou hook rate baixos |
| Formato | vídeo vertical, imagem estática, carrossel, depoimento permitido, UGC | Quando um ângulo vence em um formato |
| Oferta e CTA | avaliação, diagnóstico, condição real de agenda | Quando CTR é bom e conversão é ruim |
| Prova | número real de atendimentos, avaliações do Google, processo | Público morno |

Regra: **uma variável por teste**. Se mudar hook, formato e oferta ao mesmo tempo, o resultado não ensina nada.

## Hipótese de teste de criativo

Formato obrigatório:
> "Acreditamos que [variação] vai [melhorar métrica] porque [razão baseada em dado ou observação]. Vamos considerar validado se [métrica] atingir [meta] com [volume mínimo]."

Exemplo hipotético (contabilidade): "Acreditamos que um hook de erro comum ('o erro que faz o MEI pagar multa sem saber') vai aumentar o hook rate em relação ao hook institucional, porque os comentários dos posts orgânicos giram em torno de medo de multa. Validado se o hook rate subir de forma consistente com pelo menos alguns milhares de impressões por variação."

## Estrutura de teste de criativo no Meta Ads

Opção A (controle, recomendada para verba pequena e média):
- Campanha de teste em ABO.
- 1 conjunto por ângulo ou 1 conjunto com 3 a 5 anúncios da mesma variável.
- Público igual em todos (amplo ou o vencedor atual).
- Orçamento igual por conjunto.

Opção B (delegação, verba maior):
- Novos criativos entram no conjunto vencedor em CBO e o algoritmo distribui.
- Mais rápido, menos controle: um criativo pode não receber verba nenhuma.

A NICO recomenda A quando o objetivo é aprender e B quando o objetivo é manter a máquina abastecida.

## Verba e volume mínimos antes de decidir

Regras de bolso (referência de mercado, validar com a conta):
- Cada variação deve gastar ao menos o equivalente a 1 a 2 vezes o CPA ou CPL alvo antes de ser julgada por conversão.
- Para métricas de atenção (hook rate, CTR), esperar alguns milhares de impressões por variação.
- Rodar pelo menos 3 a 7 dias para atravessar dias da semana diferentes.

Se a verba não permite isso, testar menos variações por vez. Teste com dados insuficientes gera falso vencedor.

## Métricas de decisão para criativos

Ler em cadeia, do topo para baixo (fórmulas em [[global/nico/trafego-pago/glossario-de-metricas]]):

1. **Hook rate** (visualizações de 3s / impressões): o começo prende?
2. **Hold rate** (ThruPlay ou 15s / visualizações de 3s): o meio segura?
3. **CTR de link**: a promessa gera clique?
4. **Conversão da página ou da conversa**: a promessa se cumpre?
5. **CPL, custo por conversa, custo por agendamento, CPA**: a conta fecha?
6. **Qualidade no CRM**: quantos agendaram, compareceram e compraram?

| Padrão observado | Leitura | Ação |
|---|---|---|
| Hook rate baixo | Abertura fraca | Trocar os 3 primeiros segundos, manter o resto |
| Hook bom, hold baixo | Promessa da abertura não é entregue | Reestruturar o meio, cortar enrolação |
| Hold bom, CTR baixo | Falta CTA claro ou motivo para agir | Reforçar oferta e CTA |
| CTR bom, conversão baixa | Desalinhamento anúncio e destino | Revisar página, formulário ou primeira mensagem |
| CPL bom, ninguém agenda | Lead errado ou atendimento lento | Qualificar no anúncio e conferir tempo de resposta |

## Critérios de matar, manter e escalar um criativo

- **Matar**: gastou 1 a 2 vezes o CPA alvo sem conversão, ou métricas de atenção bem abaixo da média da conta após volume mínimo.
- **Manter em observação**: métricas de atenção na média, conversão ainda sem volume.
- **Declarar vencedor**: CPA ou custo por agendamento dentro da meta com volume mínimo, e qualidade confirmada no CRM.
- **Escalar**: vencedor vai para a campanha de escala (ver [[global/nico/trafego-pago/meta-ads-escala-e-orcamento]]) e gera iterações (mesmo ângulo, novos hooks).

Regra da NICO: vencedor de plataforma que não gera agendamento no CRM não é vencedor.

## Sinais de fadiga de criativo

- Frequência subindo no público frio (acima de 2 a 3 em 7 dias, referência de mercado, validar).
- CTR caindo por duas semanas seguidas com CPM estável.
- CPL subindo sem mudança de público ou oferta.
- Comentários repetidos do tipo "de novo esse anúncio".

Resposta: lançar iteração do vencedor (novo hook, novo formato, novo rosto) antes de o original morrer. Ter sempre de 2 a 3 criativos novos em fila.

## Ciclo de iteração de criativos

1. Pesquisar: comentários, perguntas do inbox, objeções registradas no CRM e benchmark da biblioteca de anúncios (ver [[global/nico/trafego-pago/benchmark-biblioteca-de-anuncios]]).
2. Gerar 3 ângulos e, para cada um, 3 hooks (do mais seguro ao mais ousado).
3. Testar ângulos. Ângulo vencedor recebe teste de hooks. Hook vencedor recebe teste de formato.
4. Registrar aprendizado numa biblioteca de vencedores por nicho.
5. Conteúdo orgânico que performou bem vira candidato a anúncio (validação gratuita).

## Modelo de briefing criativo para anúncio

```
Objetivo da peça: (lead, conversa, agendamento)
Temperatura do público: (frio, morno, quente)
Oferta: (o que a pessoa ganha ao clicar)
Ângulo: (dor, desejo, objeção, prova)
Hook falado e escrito (0 a 3s):
Mensagem central em 1 frase:
Prova permitida: (avaliações reais, número real, processo)
CTA único:
Formato e proporção: (9:16 vídeo, 4:5 imagem)
Restrições de compliance: (conselho, política da plataforma)
Hipótese do teste e métrica de decisão:
```

## Compliance em criativos de saúde, estética e advocacia

- Sem promessa de resultado, sem antes e depois fora da norma, sem sensacionalismo.
- Depoimento de paciente: verificar norma vigente do conselho antes de usar.
- O que se vende em nicho regulado é o processo (avaliação, acompanhamento, transparência), não o resultado.
- Advocacia: conteúdo informativo, sem promessa de êxito. Ver [[juridico/compliance-oab]] e [[medico/medicina]].

Ligações: [[global/nico/conteudo/biblioteca-de-hooks]], [[global/nico/copy/copy-de-anuncio]], [[global/nico/conteudo/roteiro-de-video-curto]].
