// Variáveis de ambiente. Sem chave, segredo ou URL do webhook o gateway não sobe.
import path from 'node:path';

function inteiro(v, padrao, min = 1) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : padrao;
}

/** OPENWA_LICENSE_KEY: uma chave só, ou JSON `{ "khub-<uuid>": "chave", ... }` (a licença é por número). */
function lerLicenca(v) {
  if (!v || !v.trim()) return undefined;
  const s = v.trim();
  if (s.startsWith('{')) {
    try {
      const mapa = JSON.parse(s);
      return (sessionId) => mapa[sessionId] ?? null;
    } catch {
      throw new Error('OPENWA_LICENSE_KEY parece JSON mas não é válido');
    }
  }
  return s;
}

export function lerConfig(env = process.env) {
  const faltando = ['OPENWA_GATEWAY_KEY', 'OPENWA_WEBHOOK_SECRET', 'KHUB_WEBHOOK_URL'].filter((k) => !env[k] || !String(env[k]).trim());
  if (faltando.length) {
    const e = new Error(`Variáveis obrigatórias ausentes: ${faltando.join(', ')}`);
    e.code = 'CONFIG';
    throw e;
  }
  let url;
  try {
    url = new URL(env.KHUB_WEBHOOK_URL);
  } catch {
    const e = new Error('KHUB_WEBHOOK_URL inválida');
    e.code = 'CONFIG';
    throw e;
  }
  if (String(env.OPENWA_GATEWAY_KEY).length < 16 || String(env.OPENWA_WEBHOOK_SECRET).length < 16) {
    const e = new Error('OPENWA_GATEWAY_KEY e OPENWA_WEBHOOK_SECRET precisam de pelo menos 16 caracteres (use openssl rand -hex 32)');
    e.code = 'CONFIG';
    throw e;
  }
  const dataDir = path.resolve(env.DATA_DIR || '/data');
  return {
    porta: inteiro(env.PORT, 8080),
    chave: String(env.OPENWA_GATEWAY_KEY),
    segredoWebhook: String(env.OPENWA_WEBHOOK_SECRET),
    webhookUrl: url.toString(),
    dataDir,
    sessoesDir: path.join(dataDir, 'sessions'),
    maxSessoes: inteiro(env.MAX_SESSOES, 10),
    licenca: lerLicenca(env.OPENWA_LICENSE_KEY),
    chromePath: env.CHROME_PATH || undefined,
    // Em contêiner o sandbox do Chromium normalmente não tem os namespaces que precisa.
    chromeSemSandbox: /^(1|true|sim|yes)$/i.test(env.CHROME_NO_SANDBOX || ''),
    headless: !/^(0|false|nao|não|no)$/i.test(env.HEADLESS || ''),
    maxMidiaMb: inteiro(env.MAX_MIDIA_MB, 16),
    openwaLogLevel: env.OPENWA_LOG_LEVEL || 'warn',
  };
}
