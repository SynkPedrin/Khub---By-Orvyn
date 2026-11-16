# CHECKLIST GO-LIVE — Ritinha

> Critérios do master §14. Estado em 2026-11-16. **Status global: NÃO VALIDADO.**

- [ ] Ritinha receber e responder mensagens reais do WhatsApp — parcial: responde em conversas de teste; **nenhuma conversa real roteada a ela**
- [ ] Atendimento não depender exclusivamente de criação de contato novo — ❌ (nenhum caminho ativo hoje)
- [ ] Sem duas automações competindo pelo mesmo contato — ❌ (Novo Lead × MetaAds Tagging criam 2 oportunidades)
- [ ] Integração Avec validada funcionalmente — ❌ (só importação read-only; escrita não existe)
- [ ] Disponibilidade respeitar profissional e duração — ❌ (agenda sem profissional/serviço; ferramentas desligadas)
- [ ] Agendamentos persistidos e consultáveis no Avec — ❌
- [ ] Comissões e financeiro consistentes — ✅ importação conferida 1:1 (44.611 entradas / 715 saídas); sem evento financeiro automático por mensagem
- [ ] Pagamentos não confirmados por declaração — ✅ instruído na v2 + tag "pagamento feito" → equipe confirma; ferramenta `verificar_pagamento_sinal` existe mas desligada
- [ ] Handoff humano com histórico e contexto — parcial: transferência funciona e atribui responsável; **sem notificação WhatsApp à equipe**
- [ ] Follow-ups com condições de interrupção — parcial (motor ok; fluxos contextuais em rascunho)
- [ ] Opt-out respeitado — ✅ implementado (0 opt-outs hoje)
- [ ] Falhas de ferramentas com estado recuperável — ✅ DLQ + motivos gravados (2 itens a reprocessar)
- [ ] Testes unitários e de integração passando — ✅ repo verde (baseline 13/11); bateria Ritinha T01–T20 pendente
- [ ] Testes E2E passando — pendente
- [ ] Teste WhatsApp autorizado com entrega/resposta confirmadas — pendente (aprovação MCP existente aguarda humano)
- [ ] SLA com medição real — ❌ (dados mínimos; Render free dorme)
- [ ] Rollback documentado — ❌ (versionamento existe; runbook não)
- [ ] Publicação com aprovação humana — ✅ mecanismo MCP ativo (2 aprovações pendentes)

## Gates de produção (ordem)
A. Preparação → B. Homologação (QA) → C. Canário (número autorizado) → D. Aprovação → E. Go-live → F. Rollback testado.
