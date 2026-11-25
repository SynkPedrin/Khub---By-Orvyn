# Contrato KHUB ⇄ wa-gateway (open-wa) — v1

O **wa-gateway** é um serviço Node que roda numa VPS própria, mantém uma
sessão do WhatsApp Web (via `@open-wa/wa-automate`) **por cliente do KHUB** e
fala com a API do KHUB só por este contrato. O KHUB nunca importa open-wa; o
gateway nunca acessa o banco do KHUB.

- `sessionId` = `khub-<tenantId>` (uuid do tenant). Formato: `^khub-[0-9a-f-]{36}$`.
- Números sempre só dígitos com DDI (`5511999999999`). Grupos (`@g.us`) e status (`status@broadcast`) **não** são enviados ao KHUB.
- Horários: `timestamp` em segundos Unix (UTC).

## 1. KHUB → gateway (HTTP)

Base: `OPENWA_GATEWAY_URL` (ex.: `https://wa.kromads.com.br`). Toda chamada
leva `x-gateway-key: <OPENWA_GATEWAY_KEY>`; sem a chave certa → 401.
Erros: JSON `{ "erro": "<codigo>", "mensagem": "<texto>" }` com 4xx/5xx.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /health` | — | `{ ok: true, sessoes: number, versao: string }` |
| `POST /sessions/:sessionId/start` | `{}` | `200 Estado` — idempotente: se já existe sessão viva, só devolve o estado |
| `GET /sessions/:sessionId` | — | `200 Estado` (404 `sessao_inexistente` se nunca iniciada) |
| `DELETE /sessions/:sessionId` | — | `200 { ok: true }` — logout no WhatsApp + apaga os dados da sessão do disco |
| `POST /sessions/:sessionId/messages/text` | `{ to, texto, idempotencyKey }` | `200 { providerId }` |
| `POST /sessions/:sessionId/messages/media` | `{ to, tipo: 'imagem'\|'documento'\|'audio', mime, nome, legenda?, url? , base64?, idempotencyKey }` (exatamente um de `url`/`base64`; base64 sem prefixo `data:`) | `200 { providerId }` |
| `POST /sessions/:sessionId/historico` | `{ dias?: number (padrão 90, máx 365), maxPorChat?: number (padrão 300, máx 2000) }` | `202 { loteId }` — envia o histórico por webhook (`historico.lote`) |
| `GET /sessions/:sessionId/foto/:numero` | — | `200 { url: string \| null }` |

`Estado`:
```json
{
  "estado": "iniciando" | "aguardando_qr" | "conectado" | "desconectado" | "erro",
  "qr": "data:image/png;base64,..."   // só em aguardando_qr; o QR mais recente
  "qrAtualizadoEm": "2026-11-24T20:00:00Z",
  "numero": "5511999999999",          // só conectado
  "nome": "Studio X",                 // pushname do aparelho, se houver
  "fotoUrl": "https://...",           // foto do próprio número, se houver
  "erro": "texto curto"               // só em erro
}
```

Regras de envio:
- `idempotencyKey`: o gateway guarda (memória + disco, 24 h) chave → `providerId`; a mesma chave nunca envia duas vezes (devolve o mesmo `providerId`).
- Sessão não conectada → `409 { erro: "sessao_desconectada" }`. Número sem WhatsApp → `422 { erro: "numero_invalido" }`. Timeout do WhatsApp Web depois de aceitar → `504 { erro: "aceite_incerto" }` (o KHUB não reenvia).

## 2. gateway → KHUB (webhook)

`POST <KHUB_WEBHOOK_URL>` (ex.: `https://api.kromads.com.br/v1/webhooks/openwa`).

Cabeçalhos:
- `content-type: application/json`
- `x-khub-timestamp: <segundos Unix>`
- `x-khub-signature: sha256=<hex>` = HMAC-SHA256(`OPENWA_WEBHOOK_SECRET`, `${timestamp}.${corpoCru}`)

O KHUB recusa assinatura inválida ou timestamp com mais de 5 min de diferença (401).
Responde 2xx rápido. Em 5xx/timeout o gateway tenta de novo (backoff 2 s, 10 s, 60 s, 5 min; até 6 vezes) com o **mesmo** `eventId`.

Envelope:
```json
{ "eventId": "uuid", "sessionId": "khub-<tenantId>", "tipo": "<tipo>", "criadoEm": "ISO", "dados": { } }
```

| `tipo` | `dados` |
|---|---|
| `sessao.estado` | `{ estado, numero?, nome?, fotoUrl?, motivo? }` — a cada mudança (QR lido, conectado, caiu, deslogado) |
| `sessao.qr` | `{ qr: "data:image/png;base64,...", expiraEmSeg: number }` — a cada QR novo |
| `mensagem` | `MensagemWa` — toda mensagem nova 1:1, recebida **ou enviada pelo celular** (`deMim: true`) |
| `mensagem.status` | `{ ids: string[], estado: 'enviado'\|'entregue'\|'lido'\|'falhou' }` |
| `historico.lote` | `{ loteId, chats: ChatHistorico[], progresso: { feitos, total }, ultimo: boolean }` — no máx. 20 chats ou 2 000 mensagens por lote |
| `contato.foto` | `{ numero, fotoUrl }` — quando o gateway descobre/atualiza a foto de um contato |

`MensagemWa`:
```json
{
  "id": "id da mensagem no WhatsApp (estável)",
  "numero": "5511999999999",        // o contato (nunca o próprio número)
  "deMim": false,
  "nomeContato": "Ana",             // pushname/nome salvo, se houver
  "fotoUrl": "https://..." ,        // opcional
  "texto": "oi",                    // legenda quando for mídia; "" se não houver
  "tipo": "texto" | "imagem" | "audio" | "video" | "documento" | "figurinha" | "outro",
  "timestamp": 1764000000,
  "midia": { "mime": "image/jpeg", "nome": "foto.jpg", "base64": "..." }  // só se ≤ 2 MB depois de decodificar; senão omitido
}
```

`ChatHistorico`:
```json
{
  "numero": "5511999999999",
  "nome": "Ana",
  "fotoUrl": "https://..." ,
  "mensagens": [ { "id": "...", "deMim": true, "texto": "...", "tipo": "texto", "timestamp": 1764000000 } ]
}
```
Histórico **não** traz mídia (só `tipo` e legenda); mensagens em ordem cronológica.

## 3. Segurança e dados

- Chave (`OPENWA_GATEWAY_KEY`) e segredo do webhook (`OPENWA_WEBHOOK_SECRET`) só em variáveis de ambiente, nunca no repositório.
- Logs do gateway: nunca texto de mensagem, número completo ou QR (máscara `5511****9999`).
- Dados de sessão no volume `/data/sessions/<sessionId>`; `DELETE` apaga a pasta.
