// Ponto de entrada: lê env, sobe fila de webhook, sessões e HTTP.
import path from 'node:path';
import { lerConfig } from './config.js';
import { log } from './log.js';
import { FilaWebhook } from './webhook.js';
import { Idempotencia } from './idempotencia.js';
import { GerenciadorSessoes } from './sessoes.js';
import { criarServidor, VERSAO } from './http.js';

let config;
try {
  config = lerConfig();
} catch (e) {
  log.error('config_invalida', { erro: e.message });
  process.exit(1);
}

const fila = new FilaWebhook({ dataDir: config.dataDir, url: config.webhookUrl, segredo: config.segredoWebhook });
const idem = new Idempotencia(path.join(config.dataDir, 'idempotencia.jsonl'));
const gerenciador = new GerenciadorSessoes({ config, fila });
const servidor = criarServidor({ config, gerenciador, idem, fila });

fila.iniciar();
idem.iniciarLimpeza();
servidor.listen(config.porta, () => {
  log.info('gateway_no_ar', { porta: config.porta, versao: VERSAO, maxSessoes: config.maxSessoes, licenca: !!config.licenca });
  gerenciador.restaurar().catch((e) => log.error('restauracao_falhou', { erro: e }));
});

let saindo = false;
async function sair(sinal) {
  if (saindo) return;
  saindo = true;
  log.info('encerrando', { sinal });
  servidor.close();
  await gerenciador.pararTodas();
  await fila.parar();
  idem.parar();
  process.exit(0);
}
process.on('SIGTERM', () => sair('SIGTERM'));
process.on('SIGINT', () => sair('SIGINT'));
process.on('unhandledRejection', (e) => log.error('rejeicao_nao_tratada', { erro: e instanceof Error ? e : new Error(String(e)) }));
