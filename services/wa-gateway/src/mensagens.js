// Conversão de mensagens/chats do open-wa para os formatos do contrato.
// Puro (sem browser): testado em test/mensagens.test.js.
import {
  idCanonico,
  chatIdSerializado,
  ehChatIndividual,
  normalizarNumero,
  tipoDaMensagem,
  textoDaMensagem,
} from './util.js';

/** Chat da mensagem: em 1:1 é sempre o contato, tanto recebida quanto enviada (deMim). */
export function chatDaMensagem(msg) {
  return (
    chatIdSerializado(msg?.chatId) ||
    chatIdSerializado(msg?.chat?.id) ||
    chatIdSerializado(msg?.fromMe ? msg?.to : msg?.from)
  );
}

/**
 * Mensagem que não deve ir ao KHUB: grupo, status, broadcast, newsletter,
 * notificação de sistema.
 */
export function deveIgnorar(msg) {
  if (!msg || typeof msg !== 'object') return true;
  if (msg.isGroupMsg) return true;
  if (msg.isNotification) return true;
  if (msg.broadcast) return true;
  const chat = chatDaMensagem(msg);
  if (!ehChatIndividual(chat)) return true;
  return false;
}

/**
 * Número do contato. Para `@lid` (id oculto do WhatsApp) só funciona se o
 * número veio resolvido (ver sessoes.js → resolverNumeroLid); senão null.
 */
export function numeroDoChat(chatId, numeroLidResolvido) {
  if (!chatId) return null;
  if (chatId.endsWith('@lid')) return numeroLidResolvido ? normalizarNumero(numeroLidResolvido) : null;
  return normalizarNumero(chatId) || null;
}

export function nomeDoContato(msg) {
  const c = msg?.chat?.contact || {};
  if (!msg?.fromMe) {
    return msg?.sender?.pushname || msg?.notifyName || c.name || c.pushname || msg?.sender?.name || undefined;
  }
  return c.name || c.pushname || msg?.chat?.name || msg?.chat?.formattedTitle || undefined;
}

/** MensagemWa (sem mídia; a mídia é anexada depois, se couber em 2 MB). */
export function paraMensagemWa(msg, { numero, fotoUrl } = {}) {
  const out = {
    id: idCanonico(msg.id),
    numero,
    deMim: !!msg.fromMe,
    texto: textoDaMensagem(msg),
    tipo: tipoDaMensagem(msg.type),
    timestamp: Number(msg.t ?? msg.timestamp) || 0,
  };
  const nome = nomeDoContato(msg);
  if (nome) out.nomeContato = nome;
  if (fotoUrl) out.fotoUrl = fotoUrl;
  return out;
}

/** Item de mensagem do histórico (sem mídia, só tipo e legenda). */
export function paraMensagemHistorico(msg) {
  return {
    id: idCanonico(msg.id),
    deMim: !!msg.fromMe,
    texto: textoDaMensagem(msg),
    tipo: tipoDaMensagem(msg.type),
    timestamp: Number(msg.t ?? msg.timestamp) || 0,
  };
}

/**
 * Seleciona as mensagens do histórico de um chat: dentro da janela de `dias`,
 * no máximo `maxPorChat` (as mais recentes), em ordem cronológica, sem
 * notificações e sem duplicatas.
 */
export function selecionarHistorico(msgs, { desdeSeg, maxPorChat }) {
  const vistos = new Set();
  const lista = [];
  for (const m of msgs || []) {
    if (!m || m.isNotification) continue;
    const id = idCanonico(m.id);
    if (!id || vistos.has(id)) continue;
    const ts = Number(m.t ?? m.timestamp) || 0;
    if (ts < desdeSeg) continue;
    vistos.add(id);
    lista.push(paraMensagemHistorico(m));
  }
  lista.sort((a, b) => a.timestamp - b.timestamp);
  return lista.length > maxPorChat ? lista.slice(lista.length - maxPorChat) : lista;
}

export const LOTE_MAX_CHATS = 20;
export const LOTE_MAX_MENSAGENS = 2000;

/**
 * Agrupa ChatHistorico[] em lotes de no máximo 20 chats ou 2000 mensagens.
 * Um chat nunca é partido (maxPorChat ≤ 2000 garante que cabe sozinho).
 */
export function emLotes(chats, { maxChats = LOTE_MAX_CHATS, maxMensagens = LOTE_MAX_MENSAGENS } = {}) {
  const lotes = [];
  let atual = [];
  let msgs = 0;
  for (const c of chats) {
    const n = c.mensagens.length;
    if (atual.length && (atual.length >= maxChats || msgs + n > maxMensagens)) {
      lotes.push(atual);
      atual = [];
      msgs = 0;
    }
    atual.push(c);
    msgs += n;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

/** Acumulador incremental (o job manda lotes conforme lê, sem guardar tudo). */
export class AcumuladorLotes {
  constructor({ maxChats = LOTE_MAX_CHATS, maxMensagens = LOTE_MAX_MENSAGENS } = {}) {
    this.maxChats = maxChats;
    this.maxMensagens = maxMensagens;
    this.atual = [];
    this.msgs = 0;
  }

  /** Adiciona um chat; devolve um lote pronto (array) se o atual encheu. */
  adicionar(chat) {
    let pronto = null;
    const n = chat.mensagens.length;
    if (this.atual.length && (this.atual.length >= this.maxChats || this.msgs + n > this.maxMensagens)) {
      pronto = this.atual;
      this.atual = [];
      this.msgs = 0;
    }
    this.atual.push(chat);
    this.msgs += n;
    return pronto;
  }

  /** O que sobrou (pode ser vazio). */
  restante() {
    const r = this.atual;
    this.atual = [];
    this.msgs = 0;
    return r;
  }
}
