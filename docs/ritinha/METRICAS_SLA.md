# MÉTRICAS SLA — resposta em até 2 minutos

> Meta: atendimento útil em ≤ 2 min em ≥ 95% dos casos. **Não atingida e não medida em escala** — a IA atendeu apenas 4 conversas de teste.

## Dados reais disponíveis (Neon, 16/11)

**agent_runs, últimos 7 dias (39 runs):** p50 = 3,3 s · p95 = 118,7 s · max = 165 s
- ⚠️ p95/max contaminados pela era Ollama local (11/11, ~130 s/resposta).
- **Somente 16/11 (Anthropic, produção):** 2,4 s · 2,5 s · 7,1 s (3 runs) — dentro da meta, mas amostra mínima e em conversa de teste.

**Gargalo estrutural:** Render plano **free** — a instância dorme por inatividade; cold start + fila podem estourar 2 min sem nenhuma falha de código. Upgrade de plano é pré-requisito do SLA.

## O que falta instrumentar
- Tempo mensagem recebida → 1ª resposta útil por conversa (hoje só há latência de geração do run).
- Alerta quando IA falha/atrasada + responsável (Sara/Vitória).
- Taxa de transferência, erro por 100 conversas, duplicidades.
