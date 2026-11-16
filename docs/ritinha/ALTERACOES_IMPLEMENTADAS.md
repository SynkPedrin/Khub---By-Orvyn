# ALTERAÇÕES IMPLEMENTADAS — Operação Ritinha

## 2026-11-16 (Fase Zero — somente leitura)
- Branch `feat/ritinha-avec-go-live`; docs/ritinha; scripts read-only de auditoria (`auditar-ritinha-api.mjs`, `auditar-neon.mjs/.sql`).
- Commit `3583ab2`: snapshot de preservação dos 217 arquivos não commitados das sessões anteriores.

## 2026-11-16 (Fase 1 — mudanças em produção, autorizadas por delegação do dono: "tome as melhores decisões")

| # | Mudança | Tipo | Evidência | Reversão |
|---|---|---|---|---|
| 1 | **Agenda corrigida no Neon**: 20.888 compromissos com serviço/profissional/contato; catálogo com 85 serviços (36 com duração real) e 23 profissionais; 799 contatos de referência criados; 0 automações disparadas (850 eventos neutralizados) | Dados (produção) | `corrigir-agenda.mjs --gravar`: relatório antes/depois; contagens pós no Neon | Backup `~/khub-backups/agenda-studio-2026-11-16.csv` + `contatos-studio-2026-11-16.csv` |
| 2 | **Ritinha — rascunho v3 (7.415 chars)**: mescla do rascunho do ChatGPT (Avec como fonte oficial, sem PIX, sem tag "pagamento feito" por declaração, opt-out, SLA) + seção Preços/Sugestões da v2. **NÃO publicada** — a aprovação pendente `fd6230fb` publicará este texto quando o Pedro decidir | Config (rascunho) | PATCH /v1/agents → 200; draft 7.415 chars ≤ 8.000 | v2 publicada intacta (`8f897eb0`); texto em `scripts/operar/ritinha-instrucoes-v3.txt` |
| 3 | **"Novo Lead 🚀" v2 publicada**: gatilho `contato_criado` agora com `origem=WhatsApp` — fim da dupla oportunidade com "MetaAds Tagging" | Automação ativa | validar ok → publicar v2; GET confirma gatilho | rollback para versão 1 via `/rollback` |
| 4 | **"Notificação Interna 🔔 (importado do GHL)" PUBLICADA** com redesenho: 3 gatilhos independentes — "serviço escolhido" → aviso de agendamento; "pagamento feito" e "comprovante recebido" → aviso **"validar pagamento ANTES de confirmar"**. Destinatário: `+5518981948549` (mesmo do fluxo ativo; pendente confirmação humana) | Automação ativa | validar ok → publicar v1 | pausar via `/status` |

**Não feito de propósito:** Ritinha segue `padrao=false` (ativação na linha de frente só após canário); nenhuma mensagem enviada a clientes; aprovações MCP não consumidas; nenhuma escrita no Avec.

## Pendente de confirmação humana
- Destinatário das notificações internas (`+5518981948549` vs `5518935000971`/Harumi).
- Aprovação `fd6230fb` (publica a v3) e `e93023b1` (mensagem de teste) — expiram 17/11 13:09 UTC.
