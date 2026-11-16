# MAPA DE AUTOMAÇÕES — Studio da Beleza (verificado em produção, 2026-11-16)

## Estado: 3 ativas / 6 rascunhos (confere com a última auditoria)

### ATIVAS

**1. Novo Lead 🚀** (`02e70a9b-…`, v1 publicada 09/11)
`contato_criado` (sem filtro de origem!) → SMS boas-vindas → criar oportunidade → esperar resposta 24h → (respondeu) "qual procedimento?" + mover etapa · (timeout) etapa "Sem Resposta" + tag follow-up.
- Produção: 22 runs concluídos (último hoje 10:43 UTC), **2 falhados → DLQ** (`message_delivery_config_required`, 13/11, sem reprocessamento).
- ⚠️ **Conflita com MetaAds Tagging** (ambos criam oportunidade na mesma etapa para lead Meta Ads).
- ⚠️ **Não ativa a IA** e, se a IA entrar por outro caminho, **fala junto com ela** (boas-vindas + "qual procedimento?" duplicam — pendência do BUG-033).

**2. Notificação Interna 🔔** (`380ad004-…`)
`negocio_criado` → notifica equipe em `+5518981948549`.
- ⚠️ Destinatário diverge dos fluxos GHL (`5518935000971`). Validar o número certo com a Rita.

**3. MetaAds WhatsApp Lead Tagging** (`bf7530b1-…`)
`contato_criado` origem=metaads → tags `metaads`,`warm lead` → criar oportunidade (mesma etapa do Novo Lead).

### RASCUNHOS

**4. Novo Lead 🚀 (importado do GHL v14)** (`24be2eac-…`)
Versão fiel ao GHL: pergunta de origem (Google/Meta/cliente/indicação) com tags, oportunidade, boas-vindas, "qual procedimento?", **`acao.ativar_ia` → Ritinha**, follow-ups em 2h/1d/3d com saída ao responder.
- 3 runs de teste `cancelado` (BUG-040, correção deployada hoje — re-testar).
- Decisão pendente (BUG-033): publicar implica boas-vindas da automação + IA conversando (dono precisa decidir o desenho).

**5. Notificação Interna 🔔 (importado do GHL)** (`5ac219d0-…`)
`tag_adicionada` "serviço escolhido" OU "pagamento feito" → condição → notifica equipe (`5518935000971`).
- **É o complemento obrigatório da Ritinha v2** (ela marca essas tags ao transferir). Em rascunho = tag sem efeito hoje.

**6. ADD TAG - ATIVAR IA** (`0ec4ae72-…`)
Rascunho quebrado: 1 nó `adicionar_tag` sem config e sem arestas. Arquivar ou reconstruir.

**7. Resposta na Dm** (`16dbff5d-…`) — decisão registrada: NÃO publicar (boas-vindas em dobro / pergunta origem para cliente antiga).
**8. Disparo de Mensagem📨** (`2fef0d11-…`) — decisão: NÃO publicar (texto provisório, sem imagem, ritmo 180× o do GHL).
**9. Agendamento Confirmado 📅** (`434216e7-…`) — decisão: NÃO publicar (no GHL a confirmação era manual; ninguém chama o webhook). Rever quando a integração Avec existir — é o lugar natural do "confirmado só após evento oficial".

## Gaps contra o master §6

| Requisito | Estado |
|---|---|
| Atendimento a conversa nova sem depender só de `contato_criado` | ❌ gatilho `mensagem_recebida` existe no catálogo mas nenhum fluxo o usa; cliente antigo que escreve não recebe automação nem IA |
| Roteamento IA respeitando humano/opt-out/transferida | ✅ no runtime (`estadoInicial`, regras de silêncio), mas inativo por falta de entrada |
| SLA 2 min com alerta | ❌ |
| Confirmação de agendamento só após evento oficial | ❌ (sem integração Avec; fluxo #9 é o ponto de encaixe futuro) |
| Follow-up contextual com interrupções | parcial (v1: 1 toque; v14: 3 toques com saída ao responder, em rascunho) |
| Opt-out | ✅ campo `opted_out_at` (0 contatos hoje); motor cancela envio com motivo gravado |
