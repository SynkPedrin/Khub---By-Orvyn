# MAPA AVEC — verificado ao vivo em 2026-11-16

## Duas camadas de acesso (ambas já demonstradas)

**1. Relatórios (histórico, batch)** — `/admin/relatorios/listar` via sessão web
- Códigos: 0155/0248 (agendamentos por status), 0387/0385/0180 (financeiro), 0186/8123/0028 (comissões), 0229 (usuários), 0004 (clientes).
- Usado na importação de 14/11 (20.890 agendamentos; financeiro 1:1). Scripts em `apps/api/scripts/operar/avec/`.

**2. Grade de agenda ao vivo (tempo real, READ-ONLY verificado hoje)** — app `admin.avec.beauty/admin/agenda-v2`
- `POST /admin/agenda/listarTodosProfissionaisComAgendaAndServicos` → profissionais ativos + serviços por profissional + **comissão por serviço** (verificado: 8 profissionais — Rita, Thaina, Gabriela, Carmelita, cristina, isabela, Mel, Vitória).
- `POST /admin/agenda/carregarAgenda` → por dia e profissional: **jornada** (hora_inicio/hora_fim), **reservas** (cliente, telefone, serviço, início/fim, status) e **bloqueios**. Horários livres = jornada − reservas − bloqueios (o campo `livres` vem vazio; a UI calcula no cliente).
- Verificado ao vivo (16/11 ~14h UTC): terça 17/11 com 8 profissionais em jornada (06:00–20:00 conforme a pessoa) e reservas reais (ex.: Rita 6, Gabriela 11); quarta 18/11 (Gabriela 20 reservas); sábado 21/11.
- **Requisito de sessão:** login web (`entrar.mjs`) + uma visita à página `agenda-v2` no navegador para primar os cookies; depois `ctx.request` responde JSON puro. Sessão expira — o job precisa re-login automático.
- Payload: form-urlencoded `dados={"data":"AAAA-MM-DD","profissionalIdArr":[{"id":"…"}]}`.

## Escrita (criar/reagendar/cancelar): NÃO verificada
- O app de agenda certamente tem endpoints de escrita, mas não foram mapeados (exigiria criar um agendamento real de teste no sistema da cliente — **só com autorização e reversão**, fase de canário).
- Não há evidência de API pública/documentada do Avec. O acesso é a endpoints internos do próprio admin (risco de mudança sem aviso; sem contrato).
- **Contrato seguro vigente (v3 da Ritinha):** IA consulta disponibilidade real via probe read-only → oferece horários → coleta aceite → **a escrita é da equipe** (ou de um caminho de escrita validado em canário), nunca confirmação otimista.

## Estado dos dados no KHUB (pós-correção de 16/11)
- 20.890 compromissos: **20.886 com profissional, 20.888 com serviço e contato, 0 no formato antigo** (os 2 restantes são agendamentos de teste da Ritinha de 11/11).
- Catálogo: **85 serviços** (36 com duração real do Avec) e **23 profissionais** (nomes reais: Rita, Carmelita, Cris/Cristina, Vitoria, Vivi, Mel, Ana Julia, Manu, Judite, Lana…).
- Backup pré-correção: `~/khub-backups/agenda-studio-2026-11-16.csv` e `contatos-studio-2026-11-16.csv`.
- ⚠️ `valor_centavos` continua 0 (decisão de design do LEIAME: dinheiro só do financeiro). Comissões por serviço/profissional existem no Avec e na extração — AVEC-3/4 pendentes (equipe + entidade de comissões).

## Sincronização contínua (AVEC-5) — desenho proposto
1. Job diário (ou sob demanda no turno da conversa): re-login se necessário → `carregarAgenda` por dia/profissional → projeta em `agenda_compromissos` (somente futuro, com `ref_externa` quando houver) ou em cache próprio `avec_agenda_cache`.
2. Reconciliação: relatório 0248 (futuro, por status) 1×/dia para detectar cancelamentos/alterações externas.
3. Escrita: fase posterior, com idempotency key = hash(cliente+serviço+início), reversão documentada e canário no contato autorizado.
4. **Regra mantida:** o KHUB nunca confirma disponibilidade por conta própria; toda oferta de horário nasce de um probe fresco ou de cache com carimbo < N min.

## Riscos
- Endpoints internos sem contrato → podem mudar; o job precisa de healthcheck e fallback (degrada para "equipe confirma").
- Sessão web expira → re-login headless com credencial em `~/.khub/avec.env` (fora do repo).
- Escrita por endpoint interno pode contornar validações do Avec (comissão, comanda) → só após canário medido.
