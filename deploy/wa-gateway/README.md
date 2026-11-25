# Como colocar o wa-gateway no ar (passo a passo)

O wa-gateway é o "celular virtual" do KHUB: ele mantém o WhatsApp Web de cada
cliente aberto num servidor seu e repassa as mensagens para o KHUB. Este guia
sobe o gateway numa VPS (servidor alugado) com HTTPS automático.

Você vai precisar de:
- um domínio onde você consiga criar registros DNS (ex.: `SEU-DOMINIO`);
- cartão para alugar a VPS (cerca de US$ 8 a 25 por mês);
- uns 30 minutos.

---

## 1. Alugar a VPS

Qualquer provedor serve. Sugestões:

| Provedor | Plano | RAM | Aguenta mais ou menos |
|---|---|---|---|
| Hetzner | CPX21 | 4 GB | 5 números |
| Hetzner | CPX31 | 8 GB | 12 números |
| DigitalOcean | Basic 4 GB | 4 GB | 5 números |

Regra de bolso: **cada número conectado usa uns 500 MB de RAM** (é um navegador
Chrome aberto), mais 1 GB para o sistema.

Na criação, escolha **Ubuntu 24.04**, uma região perto do Brasil (EUA Leste,
por exemplo) e adicione sua chave SSH (ou use senha). Anote o **IP** da máquina.

## 2. Apontar o domínio

No painel do seu domínio, crie um registro:

| Tipo | Nome | Valor |
|---|---|---|
| A | `wa` | o IP da VPS |

O endereço do gateway vai ser `wa.SEU-DOMINIO`. A propagação pode levar alguns
minutos.

## 3. Instalar o Docker na VPS

Entre na VPS (no Mac: `ssh root@IP-DA-VPS`) e rode:

```bash
curl -fsSL https://get.docker.com | sh
docker --version          # deve mostrar a versão
```

Libere as portas da web (se o provedor tiver firewall, libere 80 e 443 lá também):

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Levar os arquivos para a VPS

O gateway precisa das pastas `services/wa-gateway` e `deploy/wa-gateway`
**mantendo essa estrutura**. Do seu computador, dentro da pasta do KHUB-OS:

```bash
ssh root@IP-DA-VPS "mkdir -p /opt/khub/services /opt/khub/deploy"
rsync -a --exclude node_modules --exclude data services/wa-gateway root@IP-DA-VPS:/opt/khub/services/
rsync -a deploy/wa-gateway root@IP-DA-VPS:/opt/khub/deploy/
```

(Ou faça `git clone` do repositório em `/opt/khub`.)

## 5. Configurar o `.env`

Na VPS:

```bash
cd /opt/khub/deploy/wa-gateway
cp exemplo.env .env
openssl rand -hex 32      # rode duas vezes: uma para a CHAVE, outra para o SEGREDO
nano .env
```

Preencha:

| Variável | O que colocar |
|---|---|
| `WA_DOMINIO` | `wa.SEU-DOMINIO` |
| `OPENWA_GATEWAY_KEY` | o 1º valor do `openssl rand -hex 32` |
| `OPENWA_WEBHOOK_SECRET` | o 2º valor (diferente do 1º) |
| `KHUB_WEBHOOK_URL` | `https://api.SEU-DOMINIO/v1/webhooks/openwa` (endereço da API do KHUB) |
| `MAX_SESSOES` | quantos números cabem (veja a tabela do passo 1) |
| `GATEWAY_MEM_LIMIT` | RAM da VPS menos 1 GB (ex.: `3g` numa VPS de 4 GB) |
| `OPENWA_LICENSE_KEY` | deixe vazio por enquanto (veja "Licença" abaixo) |

Salve (no nano: `Ctrl+O`, `Enter`, `Ctrl+X`) e proteja o arquivo:

```bash
chmod 600 .env
```

> Nunca mande o `.env` por chat nem coloque no Git.

## 6. Subir

```bash
cd /opt/khub/deploy/wa-gateway
docker compose up -d --build
```

O primeiro build leva alguns minutos (ele baixa o Chromium). Depois:

```bash
docker compose ps                    # os dois serviços devem estar "running"/"healthy"
```

### Conferir se está no ar

```bash
curl -H "x-gateway-key: SUA_OPENWA_GATEWAY_KEY" https://wa.SEU-DOMINIO/health
```

Resposta esperada: `{"ok":true,"sessoes":0,"versao":"1.0.0",...}`.
Sem a chave, a resposta é `401`. É assim mesmo: a chave protege o gateway.

Se der erro de certificado, espere 1 ou 2 minutos (o Caddy está pedindo o HTTPS) e
confira se o DNS do passo 2 já aponta para o IP certo.

## 7. Ligar no KHUB

Na configuração da **API do KHUB** (variáveis de ambiente do serviço da API),
coloque:

| Variável na API do KHUB | Valor |
|---|---|
| `OPENWA_GATEWAY_URL` | `https://wa.SEU-DOMINIO` |
| `OPENWA_GATEWAY_KEY` | o mesmo `OPENWA_GATEWAY_KEY` do `.env` do gateway |
| `OPENWA_WEBHOOK_SECRET` | o mesmo `OPENWA_WEBHOOK_SECRET` do `.env` do gateway |

Reinicie a API. A partir daí, a conexão do WhatsApp de cada cliente (o QR
Code) é feita pela tela do KHUB.

---

## Dia a dia

**Ver os logs** (os números aparecem mascarados, tipo `5511****9999`, e o texto
das mensagens nunca aparece):

```bash
cd /opt/khub/deploy/wa-gateway
docker compose logs -f gateway        # Ctrl+C para sair
```

**Reiniciar:** `docker compose restart gateway`. Os números conectados voltam
sozinhos, sem precisar ler o QR de novo.

**Atualizar** (depois de copiar a versão nova de `services/wa-gateway` como no passo 4):

```bash
cd /opt/khub/deploy/wa-gateway
docker compose up -d --build
```

**Backup:** tudo o que importa está no volume `/data` (sessões do WhatsApp,
fila de eventos, idempotência). Para copiar:

```bash
cd /opt/khub/deploy/wa-gateway
docker compose stop gateway
docker run --rm -v wa-gateway_wa-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/wa-data-$(date +%F).tgz -C /data .
docker compose start gateway
```

> O backup contém as **credenciais do WhatsApp** dos clientes. Guarde como
> senha, nunca em lugar público. (O nome do volume pode variar. Confira com
> `docker volume ls | grep wa-data`.)

**Memória:** se `docker stats` mostrar o gateway perto do limite, aumente a
VPS ou diminua `MAX_SESSOES`. Quando o limite é atingido, o KHUB recebe o
erro `limite_sessoes` ao tentar conectar mais um número.

---

## Licença open-wa (opcional, por número)

Sem licença, o gateway **recebe e responde** normalmente quem mandou mensagem.
Para **iniciar conversa** com um número que nunca escreveu para aquele
WhatsApp, o open-wa exige uma licença paga **por número** (Restricted ou
Premium, em <https://openwa.dev>). Sem ela, o KHUB recebe o erro
`licenca_necessaria`.

Com a licença em mãos, coloque no `.env`:

```
# um número só:
OPENWA_LICENSE_KEY=CHAVE
# ou vários (uma chave por cliente do KHUB):
OPENWA_LICENSE_KEY={"khub-<id-do-cliente>":"CHAVE1","khub-<outro-id>":"CHAVE2"}
```

e rode `docker compose up -d`.

## Riscos (leia)

- O WhatsApp Web automatizado **não é uma API oficial do WhatsApp**. Existe
  risco real de o WhatsApp **banir o número**, principalmente com disparos em
  massa, mensagens para quem nunca falou com o número ou muitas denúncias de
  spam. Use em números que já conversam com clientes, num ritmo humano.
- O WhatsApp muda o WhatsApp Web de tempos em tempos. Quando isso quebra algo,
  a correção vem numa versão nova do open-wa (aí é atualizar o gateway).
- O histórico importado depende do que o celular sincroniza com o aparelho
  conectado (normalmente conversas recentes e alguns meses), não do
  WhatsApp inteiro.
- O celular do cliente precisa ficar com internet de vez em quando. Se ficar
  ~14 dias desligado, o WhatsApp desconecta os aparelhos vinculados e é
  preciso ler o QR de novo.
