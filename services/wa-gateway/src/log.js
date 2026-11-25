// Log em JSON por linha. Regra (CONTRATO.md §3): nunca texto de mensagem,
// número completo, QR ou segredo. Quem chama passa só campos seguros; como
// rede de proteção, toda sequência de 8+ dígitos em strings é mascarada
// (`5511****9999`) — inclusive em mensagens de erro vindas do open-wa.
import { mascarar } from './util.js';

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };
const LIVRES = new Set(['t', 'sessionId', 'loteId', 'eventId']); // uuids, não números
const minimo =NIVEIS[process.env.LOG_LEVEL || 'info'] ?? 20;

export function higienizar(s) {
  return String(s).replace(/\d{8,}/g, (d) => mascarar(d)).slice(0, 500);
}

function escrever(nivel, msg, campos) {
  if (NIVEIS[nivel] < minimo) return;
  const linha = { t: new Date().toISOString(), nivel, msg, ...campos };
  const s = JSON.stringify(linha, (k, v) => {
    if (v instanceof Error) return { nome: v.name, msg: higienizar(v.message), code: v.code };
    if (typeof v === 'string' && !LIVRES.has(k)) return higienizar(v);
    return v;
  });
  (nivel === 'error' || nivel === 'warn' ? process.stderr : process.stdout).write(s + '\n');
}

export const log = {
  debug: (m, c = {}) => escrever('debug', m, c),
  info: (m, c = {}) => escrever('info', m, c),
  warn: (m, c = {}) => escrever('warn', m, c),
  error: (m, c = {}) => escrever('error', m, c),
};
