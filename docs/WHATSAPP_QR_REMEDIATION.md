# WhatsApp: recuperação de QR — 2026-09-28

## Evidências e causa

- Evolution local v2.3.7 respondeu HTTP 200 e gerou QR PNG real para a instância ORVYN existente. Nenhum token ou QR foi gravado neste relatório.
- A integração afetada estava persistida como `conectando`. O marketplace considerava a existência do registro suficiente para mostrar `Conectado`.
- O modal buscava QR uma única vez. Se a primeira resposta não contivesse imagem, os polls seguintes buscavam apenas estado; a imagem não poderia chegar à tela.
- O backend descartava o QR de criação e anunciava `aguardando_qr` mesmo com QR vazio.

## Correção

- Preservar o QR retornado pela criação; não solicitar pareamento se a instância já estiver conectada.
- `GET /v1/integrations/whatsapp/status?qr=true` recupera a imagem quando solicitada. Mantém autenticação e busca por tenant; não cria instância ou reconfigura webhook.
- Modal consulta sequencialmente, recupera QR atrasado, renova após expiração e encerra consultas ao fechar ou confirmar conexão. Janela de tentativa: 120 segundos.
- Reutilizar chamada de conexão em andamento na remontagem do efeito React.
- Marketplace só mostra conectado para `status=connected`.
- Erros de configuração reconhecem `code=config_required` do filtro RFC 7807.
- HTTP 403 ao criar instância exige consulta autenticada bem-sucedida à instância antes de reaproveitá-la.

## Verificação

- API: 34 suites / 293 testes aprovados, incluindo 7 regressões novas do serviço de conexão.
- TypeScript API e web: aprovados (`--noEmit --incremental false`). Lint dos arquivos web alterados: aprovado.
- Navegador Chromium com login local real e respostas de pareamento controladas: QR atrasado, imagem decodificada, renovação, chamada única em StrictMode, conexão já ativa, falha repetida, configuração ausente e encerramento de polling aprovados. Sem erros de JavaScript.
- Serviço corrigido com Prisma/banco e Evolution reais: `aguardando_qr`, imagem PNG presente e prazo de expiração retornado.
- API `/v1/ready`: banco e Redis disponíveis; login HTTP 200.

## Limite do aceite

Pareamento do telefone, envio e recebimento reais permanecem pendentes de o operador escanear o QR. O teste de navegador com respostas controladas não prova conexão real do aparelho. Nenhuma mensagem foi enviada por esta verificação.
