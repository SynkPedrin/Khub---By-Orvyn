# STATUS EXECUÇÃO — Operação Ritinha

> Atualizado a cada etapa. Fuso: America/Sao_Paulo.

## 2026-11-16 — Fase Zero (auditoria) CONCLUÍDA
Ver `AUDITORIA_INICIAL.md`. Achados-chave: Ritinha fora da linha de frente (padrao=false, nenhum fluxo ativo a chama); tag de handoff sem notificação; agenda sem profissional/serviço; Avec = importação batch sem escrita; 401 Anthropic resolvido (incidente de env de 13/11); 217 arquivos não commitados.

## 2026-11-16 — Fase 1 (decisões delegadas pelo dono) EM ANDAMENTO

**Executado**
- Commit `3583ab2`: preservação de todo o trabalho não commitado.
- **Agenda corrigida em produção** (backup prévio): 20.888 compromissos com serviço/profissional/contato; catálogo 85 serviços + 23 profissionais; zero formato antigo; nenhuma automação disparada.
- **Avec: viabilidade provada ao vivo** — disponibilidade real read-only (`carregarAgenda`: jornada + reservas + bloqueios por profissional/dia) e catálogo de profissionais/serviços/comissões. Escrita não verificada (só canário autorizado). Detalhes em `MAPA_AVEC.md`.
- **Ritinha v3 no rascunho** (7.415 chars): rascunho do ChatGPT mesclado com a seção de preços/sugestões da v2. Não publicada — aguarda aprovação humana (`fd6230fb`).
- **Automações corrigidas e publicadas**: "Novo Lead 🚀" v2 (filtro origem=WhatsApp, fim da dupla oportunidade) e "Notificação Interna 🔔 (importado do GHL)" (3 gatilhos; aviso de pagamento agora manda VALIDAR antes de confirmar).

**Validado**
- GETs pós-mudança: gatilho com filtro na versão ativa 2; notificação GHL ativa com 3 gatilhos e destinatário único; draft da Ritinha com 7.415 chars; versão publicada da Ritinha inalterada.
- Run real de hoje ("Ariel", WhatsApp, 14:20 UTC) concluído no Novo Lead — fluxo saudável após a correção da agenda (nenhum disparo indevido).

**Pendente (humano)**
- Pedro: aprovar/rejeitar `fd6230fb` (publica v3 da Ritinha) e `e93023b1` (mensagem de teste) no KHUB — **expiram 17/11 13:09 UTC**.
- Confirmar destinatário das notificações internas (`+5518981948549` em uso; `5518935000971`/Harumi era o do GHL).
- Confirmar modelo de ativação da Ritinha na linha de frente (recomendação: `padrao=true` após canário, com "Novo Lead 🚀" já filtrado).

**Bloqueado**
- Escrita no Avec: só após canário autorizado com reversão.
- SLA 2 min: Render free dorme; upgrade de plano é decisão de custo.

**Próximo passo**
- Implementar o probe Avec como serviço no backend (read-only, com cache e fallback) + bateria de testes T01–T20 na bancada; depois canário no número autorizado.

---

## Checkpoint para auditoria independente (16/11 ~12h)
1. Neon: agenda do Studio com 20.886/20.890 `profissional_id` preenchido; `servicos`=85, `profissionais`=23.
2. API: workflows ativos = 4 (Novo Lead v2 c/ filtro, MetaAds Tagging, Notificação Interna simples, Notificação GHL c/ 3 gatilhos).
3. Ritinha: `versaoPublicadaId=8f897eb0` (v2, inalterada); rascunho 7.415 chars.
4. Avec: probe read-only funcionando (reservas reais de 17/11–21/11 listadas em MAPA_AVEC.md).
