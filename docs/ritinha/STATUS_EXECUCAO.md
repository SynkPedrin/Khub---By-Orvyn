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

## 2026-11-16 — Front-end (agenda + financeiro) ENTREGUE

- Pedido do dono: agenda legível mesmo com muitos atendimentos no dia, histórico acessível, financeiro com gestão de todo o fluxo de caixa.
- Implementado (commit `158189a`): Resumo do dia com mini-trilhas por profissional, ocupação no cabeçalho da Equipe, calor por dia no Mês, stepper de mês no Financeiro, gráfico diário entradas×saídas + saldo acumulado.
- Verificação: vitest 250/250 (9 novos), tsc limpo, lint limpo.
- **Deploy web em produção (16/11 ~15h47 UTC):** `vercel deploy --prod` Ready, alias `app.kromads.com.br` (⚠️ DNS do domínio próprio não resolve — acesso por `https://khub-os.vercel.app`). Conteúdo verificado ao vivo: chunk de `/agenda` contém o ResumoDia; chunk de `/financeiro` contém o gráfico "saldo acumulado". Branch `feat/ritinha-avec-go-live` enviada ao GitHub.
- Nota: Pedro adicionou `.github/workflows/manter-api-acordada.yml` (ping 5 min no Render) — mitiga o sono do plano free; plano pago segue recomendado para o SLA.

---

## Checkpoint para auditoria independente (16/11 ~12h)
1. Neon: agenda do Studio com 20.886/20.890 `profissional_id` preenchido; `servicos`=85, `profissionais`=23.
2. API: workflows ativos = 4 (Novo Lead v2 c/ filtro, MetaAds Tagging, Notificação Interna simples, Notificação GHL c/ 3 gatilhos).
3. Ritinha: `versaoPublicadaId=8f897eb0` (v2, inalterada); rascunho 7.415 chars.
4. Avec: probe read-only funcionando (reservas reais de 17/11–21/11 listadas em MAPA_AVEC.md).

## 2026-11-17 (tarde) — Missão "Ritinha 10/10": motor, travas e homologação

**No ar (Render, deploys `d997bd6`, `8de9ea0`, `0bfdcb9`; Ritinha v5 publicada e principal no WhatsApp)**

Travas:
- **Preço:** só com fonte no turno.
- **Desconto/promoção:** não é oferecido sem estar cadastrado.
- **Dia fechado:** segunda, domingo e feriados bloqueados no código das ferramentas do salão.
- **Agenda:** as travas reconhecem o salão (BUG-049).
- **Uma pergunta por vez:** a pergunta de cortesia extra sai.

Motor:
- **Opt-out preciso:** antes, "cancelar meu horário" marcava opt-out para sempre.
- **Intenção `confirmacao`:** determinística, sem nova venda.
- **Framework de objeções:** guia por tipo e contador; na 3ª vez para de argumentar.
- **Desinteresse e resistência emocional:** regra própria.

Banco: `db/076` (instruções até 20 mil caracteres, BUG-048).

Ritinha v5: v4 + FICHA DO STUDIO:
- funcionamento de terça a sábado, das 9h às 18h30;
- equipe de 8, com especialidades;
- 22 preços;
- políticas;
- sem PIX.

Novo Lead 🚀 só com o CRM: as mensagens saíram porque a IA principal conduz a conversa.

**Homologação** (`scripts/operar/ritinha-avaliacao.mjs`, 42 cenários no simulador de produção, critérios determinísticos):
- Linha de base v5: 40/42 (95,2%).
- Depois das correções: **41/42 (97,6%)**, latência mediana 2,8 s, p90 4,8 s, US$ 1,32 por bateria.
- Críticos 100%:
  - nenhum preço, desconto ou horário inventado;
  - isolamento da outra subconta;
  - opt-out e humano respeitados;
  - injeção recusada.
- Falha remanescente: `digitacao` (2 perguntas numa mensagem de esclarecimento).
- Evidência: `docs/ritinha/homologacao/avaliacao-*.json`.

**Bloqueia o 10/10**
- **Avec ao vivo:**
  - o login exige troca de senha;
  - a sincronização (AVEC-5) depende de decisão.
- **Hoje:** a disponibilidade vem da agenda do KHUB (importada até 16/11). Cada reserva avisa a equipe, e a mensagem diz que "a equipe confirma".
- **Teste E2E pelo WhatsApp** com o número autorizado: não rodado nesta etapa.
