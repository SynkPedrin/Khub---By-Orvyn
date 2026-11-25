# wa-gateway

Serviço Node que mantém **uma sessão do WhatsApp Web por cliente do KHUB**
(sessionId `khub-<tenantId>`) usando open-wa, e conversa com a API do KHUB só
pelo contrato em [`CONTRATO.md`](./CONTRATO.md). Roda numa VPS própria em
Docker; o passo a passo de instalação está em
[`deploy/wa-gateway/README.md`](../../deploy/wa-gateway/README.md).

Fica fora do workspace pnpm (tem `package.json` e `package-lock.json` próprios).

## Versão do open-wa verificada

**5.12.1** (npm `latest` em 24/11/2026), conferida nos `.d.ts`, no código
compilado e no `wapi.js` dos pacotes. O `@open-wa/wa-automate` 5.x é só um
guarda-chuva (CLI + servidor HTTP) que reexporta `createClient` de
`@open-wa/core` e `Client` de `@open-wa/client`. O gateway depende direto
desses pacotes, todos fixados em 5.12.1:

- `@open-wa/core`: `createClient(options)`, o motor da sessão
- `@open-wa/client`: `new Client({ client, transport })`, os métodos de mensagem
- `@open-wa/driver-puppeteer`: `new PuppeteerDriver()`
- `@open-wa/logger`: só para baixar o nível do log interno (`rootLogger.instance.level`)

Por que não importar `@open-wa/wa-automate`: na 5.12.1 ele carrega
`@open-wa/session-sync`, que exige o binário `zstd` já na importação
(`Error: Can not access zstd!`) e puxa Hono, Elasticsearch etc. que o gateway
não usa. O `create()` dele também só devolve o cliente depois de READY, sem
expor os eventos de QR por sessão. Por isso o gateway faz o que o `create()`
faz (código em `cli-runtime-*.cjs`), mas com acesso aos eventos.

**Um processo, N sessões:** o gateway usa a biblioteca dentro do próprio
processo Node (um `createClient` por sessão, cada um com o seu Chromium). Não
sobe uma CLI por sessão.

### Nomes exatos usados (5.12.1)

| Para quê | API |
|---|---|
| criar sessão | `createClient({ sessionId, driver, sessionDataPath, headless, qrTimeoutMs: 0, authTimeoutMs: 0, executablePath, browser, browserArgs, licenseKey, killClientOnLogout: true, deleteSessionDataOnLogout: true, eventMode: false })` e depois `new Client({ client: core, transport: core.getTransport() })` e `client.start()` |
| QR (cada rotação) | `client.events.on('launch.auth.qr.generated', e => e.details.qr)`: é a string crua do QR, convertida em data URL com o pacote `qrcode`. `e.details.attemptInThisCycle` diz se é o 1º do ciclo |
| QR lido | `launch.auth.qr.scanned` |
| estado | `session.state.changed` (`details.next`: `STARTING`, `AUTHENTICATING`, `READY`, `DISCONNECTED`, `STOPPED`) e `client.getState()` |
| deslogado pelo celular | `session.logout` (é o mesmo que `client.onLogout`) |
| perfil | `getHostNumber()`, `getMe()` (`pushname`), `getProfilePic(chatId)` (no navegador chama `WAPI.getProfilePicFromServer`; devolve a `eurl`) |
| mensagens novas (recebidas **e** enviadas pelo celular) | `client.onAnyMessage(cb)` (`onMessage` só pega as recebidas) |
| status | `client.onAck(cb)` (`msg.ack`: -1 falhou, 1 enviado, 2 entregue, 3/4 lido) |
| mídia recebida | `client.decryptMedia(msg)`, que devolve data URL |
| enviar | `sendText(chatId, texto)` (lança `SendTextError` com `code`/`outcome`) e `sendFile(chatId, dataUrl, nome, { type: 'image'\|'document'\|'audio', caption?, ptt? })` |
| número existe | `checkNumberStatus('55…@c.us')` (`numberExists`, `status`, `id._serialized`) |
| histórico | `getAllChats()`, `getAllMessages(chatId, includeMe, includeNotifications)` (`WAPI.getAllMessagesInChat`), `loadEarlierMessages(chatId)` (`chat.loadEarlierMsgs()`) |
| encerrar | `client.stop(motivo)` |

Nomes do v4 que **não existem** no `Client` 5.12.1: `getProfilePicFromServer`
(virou `getProfilePic`), `getAllMessagesInChat` (virou `getAllMessages`),
`loadAndGetAllMessagesInChat`, `logout`, `kill`, `ev.on('qr.**')` (virou
`launch.auth.qr.generated` no emissor da sessão).

## O que é pago (licença open-wa) na 5.12.1

Segundo o registro de métodos (`@open-wa/schema`, campo `license`):

- **Iniciar conversa com número que nunca escreveu** exige licença Restricted ou
  Premium. Sem ela, `sendText` lança `SendTextError` `LICENSE_REQUIRED`, e o
  gateway responde **422 `licenca_necessaria`** (nada foi enviado). Responder
  quem já escreveu funciona sem licença.
- `checkNumberStatus` aparece como `insiders` no registro, mas o `wapi.js`
  embutido tem uma implementação livre. Se a verificação falhar, o gateway
  segue sem ela e só recusa com 422 quando o WhatsApp responde explicitamente
  que o número não existe.
- `getAllChats`, `getAllMessages`, `loadEarlierMessages`, `decryptMedia`,
  `getProfilePic`, `sendFile`, `getMe` e `getHostNumber` estão como `license: none`.

A licença é **por número**. `OPENWA_LICENSE_KEY` aceita uma chave só ou um
JSON `{ "khub-<uuid>": "chave" }`. O open-wa também aceita esse mapa nativamente.

## Histórico: o que funciona e o que não

- Funciona sem licença: lista os chats 1:1 com atividade dentro de `dias`,
  lê as mensagens que o WhatsApp Web já tem e pede mais antigas ao celular com
  `loadEarlierMessages` até cobrir a janela ou chegar em `maxPorChat`. Sai em
  lotes de ≤ 20 chats / ≤ 2 000 mensagens, em ordem cronológica, só tipo +
  texto/legenda (sem mídia), com foto do contato quando der, e `ultimo: true`
  no último lote.
- **Limite real:** um aparelho conectado (multi-device) só recebe o histórico
  que o celular sincroniza ao vincular, normalmente as conversas recentes e
  alguns meses. `loadEarlierMessages` às vezes busca mais no celular, às vezes
  não (depende do celular estar online e da versão do WhatsApp). Então
  "90 dias" é o máximo pedido, não uma garantia. Quando o carregamento para,
  o gateway manda o que conseguiu.
- Contatos com id oculto (`@lid`): o gateway tenta descobrir o número
  (`contact.phoneNumber` / `Store.Contact`). Se não conseguir, o chat fica fora
  (do histórico e do webhook), com um aviso no log e sem número.
- Um pedido de histórico por sessão por vez: um segundo `POST /historico`
  enquanto o primeiro roda devolve o mesmo `loteId`.

## Garantia de id (dedupe no KHUB)

O `providerId` de `POST /messages/text` e `/messages/media`, o `id` do webhook
`mensagem` (inclusive `deMim: true`) e o `id` de `historico.lote` são **a mesma
string**: o id serializado do WhatsApp/open-wa (`true_5511…@c.us_3EB0…`), sem
prefixo nem outro formato. Todos passam por `idCanonico()` (`src/util.js`), e o
teste `providerId do envio == id do webhook mensagem (deMim) == id do
histórico` em `test/gateway.test.js` cobre os três caminhos. Detalhes:

- `sendText` já devolve esse id (validado pelo open-wa com
  `/^(true|false)_[^\s_]+@[^\s_]+_[^\s]+$/`).
- `sendFile` devolve o id serializado ou, em algumas versões do WhatsApp Web,
  só `true`. Nesse caso o gateway lê o id da última mensagem `fromMe` do chat
  (enviada a partir do início do envio). Se não achar, responde **504
  `aceite_incerto`**. A mensagem chega mesmo assim pelo webhook `mensagem`
  `deMim: true`.

## Envio: códigos de resposta

| Situação | HTTP | `erro` | Saiu? |
|---|---|---|---|
| ok | 200 | — | sim (`providerId`) |
| corpo inválido, mídia incompatível com `tipo`, download da `url` falhou | 400 | `requisicao_invalida` | não |
| sessão não conectada ou nunca iniciada | 409 | `sessao_desconectada` | não |
| número sem WhatsApp ou malformado | 422 | `numero_invalido` | não |
| número que nunca escreveu, sem licença | 422 | `licenca_necessaria` | não |
| WhatsApp Web recusou | 422 | `envio_recusado` | não |
| timeout ou resultado incerto | 504 | `aceite_incerto` | talvez (o KHUB não reenvia) |
| limite de sessões no `start` | 429 | `limite_sessoes` | — |

Idempotência (memória + `/data/idempotencia.jsonl`, 24 h, chave por sessão):
mesma chave nunca envia duas vezes. Pedidos simultâneos com a mesma chave
esperam o primeiro. Sucesso devolve o mesmo `providerId`. Depois de um 504, a
mesma chave devolve 504 de novo e nunca reenvia. Depois de um "não saiu"
(400/409/422), a chave fica livre para tentar de novo.

## Arquitetura

```
src/index.js         boot, sinais, restaura sessões
src/config.js        env (recusa subir sem chave/segredo/URL)
src/http.js          rotas do contrato em node:http + auth x-gateway-key
src/sessoes.js       GerenciadorSessoes: open-wa, estados, mensagens, envio, histórico
src/mensagens.js     conversão MensagemWa/ChatHistorico + lotes (puro)
src/webhook.js       fila persistente + assinatura HMAC + retentativas
src/idempotencia.js  chave → providerId (JSONL, 24 h)
src/util.js          número, máscara, HMAC, ids (puro)
```

- Estados: `iniciando` (inclusive logo depois de ler o QR), `aguardando_qr`
  (QR mais recente em data URL), `conectado` (com `numero`, `nome` e
  `fotoUrl`), `desconectado` (`motivo`: `conexao_caiu`, `navegador_parou`,
  `deslogado`) e `erro`. Toda mudança de estado ou motivo publica
  `sessao.estado`. Todo QR novo publica `sessao.qr`, com `expiraEmSeg` 60 no
  1º QR do ciclo e 20 nos seguintes (medido no WhatsApp Web).
- `start` é idempotente e nunca cria um segundo navegador para a mesma sessão.
  Espera até 20 s a sessão sair de `iniciando` para já devolver o QR.
- Disco: `/data/sessions/<sessionId>/` guarda `<sessionId>.data.json` (a
  credencial compacta e cifrada do open-wa 5) e `estado.json` (estado do
  gateway). No boot, as sessões que já tinham conectado e não foram deslogadas
  voltam sozinhas, sem QR. `DELETE` para o navegador e apaga a pasta.
- Logout: o `Client` 5.12.1 não tem `logout()`. No `DELETE` o gateway tenta os
  pontos internos conhecidos do WhatsApp Web (`Store.AppState.logout`, `Socket.logout`). Se não
  existirem, a credencial local é apagada mesmo assim, e o aparelho some de
  "Aparelhos conectados" quando o WhatsApp expirar o vínculo (ou o cliente
  remove pelo celular).
- Navegador que cai sozinho (`STOPPED` sem pedido) é reiniciado com backoff
  (30 s, 1 min, 2 min… até 10 min) se a sessão já tinha conectado.
- Mensagens: só 1:1 (`@c.us`, ou `@lid` com número resolvido). Grupos, status,
  broadcast, canais e notificações ficam fora. Em 1:1, o número do contato é o
  do chat, inclusive em `deMim`. Mídia vai inline só se tiver ≤ 2 MB
  decodificada. Na primeira mensagem de um contato (e a cada 24 h) o gateway
  busca a foto e publica `contato.foto` se ela mudou.
- Webhook: cada evento é gravado em `/data/fila/` antes do envio. Assinatura
  `sha256=HMAC(segredo, "${ts}.${corpo}")`, refeita a cada tentativa. Em
  5xx/timeout/rede/408/429, tenta de novo em 2 s, 10 s, 60 s, 5 min, 5 min,
  5 min, sempre com o mesmo `eventId` e o mesmo corpo. Outros 4xx ou
  tentativas esgotadas vão para `/data/fila-falhas/`.
- Logs em JSON. Nunca saem texto de mensagem, QR ou segredo, e números
  aparecem mascarados (`5511****9999`): toda sequência de 8+ dígitos é
  mascarada automaticamente. O log interno do open-wa fica em `warn`
  (`OPENWA_LOG_LEVEL`).
- `GET /health` também exige `x-gateway-key`, como o resto do contrato. O
  healthcheck do Docker roda dentro do contêiner, onde a chave já está.
  Além dos campos do contrato, a resposta traz `filaWebhook` (eventos pendentes).

### Desvios do CONTRATO.md

Nenhum nas rotas, nos corpos, nos cabeçalhos nem nos status. Pontos que o
contrato não definia e que o gateway decidiu:

- `idempotencyKey` é obrigatório em texto **e** mídia. Sem ele, 400.
- Envio, histórico e foto numa sessão que nunca foi iniciada dão **409
  `sessao_desconectada`** (e não 404), para o KHUB tratar como "nada enviado".
  `GET /sessions/:id` continua 404.
- 422 também é usado com `erro: "licenca_necessaria"` e `"envio_recusado"`,
  além de `numero_invalido`.
- `tipo: 'audio'` com `mime` `audio/ogg…` sai como mensagem de voz (PTT). Os
  outros áudios saem como arquivo de áudio. O WhatsApp não aceita legenda em
  áudio, então a `legenda` é ignorada.

## Rodar localmente

```bash
cd services/wa-gateway
npm install            # PUPPETEER_SKIP_DOWNLOAD=1 se já tiver Chrome
npm test               # 39 testes, sem Chromium (cliente open-wa falso)

PORT=8080 \
OPENWA_GATEWAY_KEY=$(openssl rand -hex 32) \
OPENWA_WEBHOOK_SECRET=$(openssl rand -hex 32) \
KHUB_WEBHOOK_URL=http://127.0.0.1:3001/v1/webhooks/openwa \
DATA_DIR=./data \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
npm start
```

Variáveis: `PORT` (8080), `OPENWA_GATEWAY_KEY`, `OPENWA_WEBHOOK_SECRET` e
`KHUB_WEBHOOK_URL` (as três obrigatórias, chave e segredo com ≥ 16
caracteres), `DATA_DIR` (`/data`), `MAX_SESSOES` (10), `OPENWA_LICENSE_KEY`,
`CHROME_PATH`, `CHROME_NO_SANDBOX` (1 na imagem Docker), `HEADLESS` (padrão
true), `MAX_MIDIA_MB` (16, para mídia enviada), `LOG_LEVEL` (info),
`OPENWA_LOG_LEVEL` (warn).

`npm audit` acusa 6 avisos "high" que vêm todos de `image-size` →
`datauri` → `pico-s3` → `@open-wa/session-sync`, usado só na sincronização de
sessão com S3, que o gateway não usa. A correção depende de nova versão do open-wa.
