# Compliance OAB — publicidade e captação na advocacia

> Escopo **nicho = juridico**. Regras que a Nyro aplica em TODA comunicação de marketing/atendimento de escritório. Segunda camada de guardrail (validador pós-resposta) além do prompt.

## Normas de referência (reais)
- **Estatuto da Advocacia e da OAB** — Lei nº 8.906/1994 — [planalto](https://www.planalto.gov.br/ccivil_03/leis/l8906.htm)
- **Código de Ética e Disciplina da OAB** — Resolução nº 02/2015 (CFOAB) — [oab.org.br](https://www.oab.org.br/)
- **Publicidade e informação na advocacia** — Provimento do CFOAB (referência: **Provimento nº 205/2021**). ⚠️ CONFIRMAR vigência/alterações em [oab.org.br](https://www.oab.org.br/).

## Blocklist (claims/práticas vedadas) — a Nyro bloqueia
- Promessa/garantia de resultado ou êxito ("você vai ganhar", "receba já").
- Mercantilização/captação indevida de clientela; abordagem ativa tipo "caça-clientes".
- Sensacionalismo, uso de casos concretos identificáveis, comparação depreciativa.
- Menção a honorários/percentual de êxito como chamariz publicitário.
- Concorrência desleal; oferta de serviços como mercadoria/promoção.

## Permitido (com sobriedade)
- Informar áreas de atuação, publicar conteúdo educativo/informativo, responder dúvidas gerais.
- Apresentação institucional sóbria; canais de contato.

## Como o validador pós-resposta age
1. Roda a resposta candidata da Nyro contra a blocklist (regex + classificação).
2. Se detectar claim vedado → **bloqueia/reescreve/escala** e registra em `nyro_guardrail_hits` ([[Banco]]).
3. Toda resposta cita as fontes RAG usadas (rastreabilidade).

> ⚠️ CURADORIA (jurídico da operação): validar esta blocklist e ampliá-la com casos reais de reprovação. É requisito de aceite do guardrail ([[Tasks]] R2.4: 20 prompts adversariais por nicho → 100% bloqueados).
