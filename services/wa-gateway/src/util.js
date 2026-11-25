// Funções puras (sem open-wa, sem rede) — cobertas por test/util.test.js.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_ID_RE = /^khub-[0-9a-f-]{36}$/;

export function sessionIdValido(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/** Só dígitos. `+55 (11) 99999-9999` → `5511999999999`; `5511…@c.us` → `5511…`. */
export function normalizarNumero(valor) {
  if (valor === null || valor === undefined) return '';
  const s = String(valor);
  const antesDoArroba = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  // ids multi-device podem vir como `5511…:12@c.us` (device suffix)
  const semDevice = antesDoArroba.split(':')[0];
  return semDevice.replace(/\D+/g, '');
}

/** Máscara para logs: `5511999999999` → `5511****9999`. Nunca loga número completo. */
export function mascarar(valor) {
  const d = normalizarNumero(valor);
  if (!d) return '';
  if (d.length <= 8) return '****' + d.slice(-2);
  return d.slice(0, 4) + '****' + d.slice(-4);
}

/** Assinatura do webhook conforme CONTRATO.md §2: `sha256=` + hex(HMAC-SHA256(secret, `${ts}.${corpo}`)). */
export function assinar(segredo, timestamp, corpoCru) {
  const h = createHmac('sha256', segredo).update(`${timestamp}.${corpoCru}`).digest('hex');
  return `sha256=${h}`;
}

/** Comparação em tempo constante (chave do gateway). */
export function chaveConfere(recebida, esperada) {
  if (typeof recebida !== 'string' || typeof esperada !== 'string' || !esperada) return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Id canônico de mensagem do WhatsApp: sempre a forma serializada do open-wa
 * (`true_5511…@c.us_3EB0…`). Aceita string ou objeto `{ _serialized }`.
 * É a MESMA função usada no `providerId` dos envios, no `id` do webhook
 * `mensagem` e no `id` do `historico.lote` — por isso os três batem.
 */
export function idCanonico(id) {
  if (!id) return null;
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && typeof id._serialized === 'string') return id._serialized;
  return null;
}

/** Id de chat serializado (`5511…@c.us`) a partir de string ou Wid. */
export function chatIdSerializado(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (typeof v._serialized === 'string') return v._serialized;
    if (v.user && v.server) return `${v.user}@${v.server}`;
  }
  return null;
}

/** Só conversas 1:1 de usuário (`@c.us`; `@lid` precisa de número resolvido à parte). */
export function ehChatIndividual(chatId) {
  if (typeof chatId !== 'string') return false;
  if (chatId === 'status@broadcast') return false;
  return chatId.endsWith('@c.us') || chatId.endsWith('@s.whatsapp.net') || chatId.endsWith('@lid');
}

const TIPOS = {
  chat: 'texto',
  image: 'imagem',
  audio: 'audio',
  ptt: 'audio',
  video: 'video',
  document: 'documento',
  sticker: 'figurinha',
};

export function tipoDaMensagem(tipoWa) {
  return TIPOS[tipoWa] || 'outro';
}

export const TIPOS_COM_MIDIA = new Set(['image', 'audio', 'ptt', 'video', 'document', 'sticker']);

/** Texto a enviar ao KHUB: corpo para texto, legenda para mídia, "" para o resto. */
export function textoDaMensagem(msg) {
  if (!msg) return '';
  if (msg.type === 'chat') return typeof msg.body === 'string' ? msg.body : (msg.content ?? '');
  if (TIPOS_COM_MIDIA.has(msg.type)) return typeof msg.caption === 'string' ? msg.caption : '';
  return '';
}

/** ack do WhatsApp → estado do contrato. Devolve null para "pendente" (não notifica). */
export function estadoDoAck(ack) {
  const n = Number(ack);
  if (n === -1) return 'falhou';
  if (n === 1) return 'enviado';
  if (n === 2) return 'entregue';
  if (n === 3 || n === 4) return 'lido';
  return null;
}

/** Tamanho em bytes depois de decodificar um base64 (sem prefixo data:). */
export function tamanhoBase64(b64) {
  if (!b64) return 0;
  const s = b64.replace(/\s+/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

/** Separa `data:mime;base64,XXXX` em { mime, base64 }. */
export function partirDataUrl(dataUrl) {
  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1] || 'application/octet-stream', base64: m[2] };
}

export function comTimeout(promessa, ms, rotulo = 'timeout') {
  let t;
  const limite = new Promise((_, rej) => {
    t = setTimeout(() => {
      const e = new Error(rotulo);
      e.code = 'TIMEOUT';
      rej(e);
    }, ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(t));
}

export const agoraSeg = () => Math.floor(Date.now() / 1000);
