# STATUS EXECUÇÃO — Operação Ritinha

> Atualizado a cada etapa. Fuso: America/Sao_Paulo.

## 2026-11-16 — Fase Zero (auditoria) CONCLUÍDA

**Executado**
- Repositório mapeado; cérebro (`Nyro IA/cerebro/`) lido; git auditado: branch `hardening/fase-0` com **217 arquivos não commitados** (125 modificados + novos); remoto local = `orvyn-os`, repo de deploy = `Khub---By-Orvyn` (main `3ca7fde`).
- Branch de trabalho criada: **`feat/ritinha-avec-go-live`** (a partir de `hardening/fase-0`, sem tocar nas alterações existentes).
- Produção inspecionada por 3 vias read-only: API oficial (login master, só GETs), SQL read-only no Neon (via `NEON_ADMIN_URL`, sem imprimir segredo), API do Render (deploys).
- Ferramentas novas (repo, read-only): `apps/api/scripts/operar/auditar-ritinha-api.mjs`, `auditar-neon.mjs` + `auditar-neon.sql`.
- Documento principal: `docs/ritinha/AUDITORIA_INICIAL.md` (+ `MAPA_AVEC.md`, `MAPA_AUTOMACOES.md`).

**Validado (evidências no AUDITORIA_INICIAL.md)**
- Ritinha ativa, v2 publicada, respondendo em 2,4–7,1 s em 16/11 — mas `padrao=false` e nenhuma automação ativa a chama: **zero clientes reais atendidos pela IA** (só 4 conversas de teste).
- "Novo Lead 🚀" v1 dispara em produção hoje (22 runs; 2 falhas em DLQ `message_delivery_config_required` de 13/11).
- Agenda: 20.890 compromissos, 0 com profissional/serviço/valor; catálogo db/071 vazio; correção pronta aguardando autorização.
- Avec: integração = scraping + importação (14/11); sem escrita, sem disponibilidade em tempo real.
- 401 Anthropic: resolvido (foi o incidente de env de 13/11). Deploy de hoje 13:22 UTC (`3ca7fde`) ao ar.
- 2 aprovações MCP pendentes (publicar agente + envio teste) criadas por sessão ChatGPT hoje 13:09 UTC, expiram 17/11 13:09 UTC.

**Pendente (depende de autorização/acesso)**
- Autorização para `corrigir-agenda.mjs --gravar` no Neon (simulação OK).
- Decisão do dono: modelo de ativação da Ritinha (padrão vs nó Ativar IA) e convivência com "Novo Lead 🚀".
- Decisão sobre o rascunho da Ritinha feito pelo ChatGPT (aprovar/editar/rejeitar) e as 2 aprovações MCP.
- Destinatário único das notificações internas (2 números divergentes).

**Bloqueado**
- Escrita no Avec (criar/remarcar/cancelar): sem API conhecida; investigar viabilidade (Fase AVEC).
- SLA 2 min com Render **free** (instância dorme): requer upgrade de plano (decisão de custo).

**Próximo passo**
- Fase AVEC: verificar capacidades reais do Avec (API/relatórios/exportação) e desenhar o contrato de agenda seguro; preparar proposta de ativação da Ritinha para aprovação.

---

## Checkpoint para auditoria independente

1. `git -C KHUB-OS branch --show-current` → `feat/ritinha-avec-go-live`
2. `docs/ritinha/AUDITORIA_INICIAL.md` lista cada achado com fonte (API/Neon/arquivo:linha).
3. Produção: `GET https://khub-api-ucey.onrender.com/v1/ready` → ready. Ritinha `29c232e5-…` ativa, `padrao=false`, versão publicada `8f897eb0-…` (v2). Workflows: 3 ativos / 6 rascunhos. Nenhuma conversa real em atendimento `ia`.
4. Nenhuma escrita foi feita em produção nesta fase.
