// Cliente open-wa falso com a mesma superfície usada pelo gateway (Client 5.12.1).
import { EventEmitter } from 'node:events';

export class ClienteFalso {
  constructor({ conectarSozinho = false } = {}) {
    this.events = new EventEmitter();
    this.h = {};
    this.enviados = [];
    this.parado = false;
    this.conectarSozinho = conectarSozinho;
    this._liberar = null;
    this.chats = [];
    this.mensagens = {};
    this.estado = 'STARTING';
  }
  getState() { return this.estado; }
  onAnyMessage(cb) { this.h.any = cb; }
  onAck(cb) { this.h.ack = cb; }
  async start() {
    if (this.conectarSozinho) { this.estado = 'READY'; return; }
    this.events.emit('launch.auth.qr.generated', { details: { qr: '2@QR-FALSO,abc,def' } });
    // Como o open-wa 5.12.1 real: stop() no meio faz start() RESOLVER (sem READY).
    await new Promise((r) => { this._liberar = r; });
  }
  escanear() { this.events.emit('launch.auth.qr.scanned', {}); this.estado = 'READY'; this._liberar?.(); }
  async stop() { this.parado = true; this.estado = 'STOPPED'; this._liberar?.(); this.events.emit('session.state.changed', { details: { next: 'STOPPED' } }); }
  async getHostNumber() { return '5511900000000'; }
  async getMe() { return { pushname: 'Studio Teste', me: { _serialized: '5511900000000@c.us' } }; }
  async getProfilePic() { return null; }
  async checkNumberStatus(id) {
    if (id.startsWith('5599')) return { id: { _serialized: id }, status: 404, numberExists: false, canReceiveMessage: false };
    return { id: { _serialized: id }, status: 200, numberExists: true, canReceiveMessage: true };
  }
  async sendText(chatId, texto) { this.enviados.push({ chatId, texto }); return `true_${chatId}_3EB0TEXTO${this.enviados.length}`; }
  async sendFile(chatId, dataUrl, nome, opcoes) { this.enviados.push({ chatId, nome, opcoes }); return `true_${chatId}_3EB0MIDIA${this.enviados.length}`; }
  async decryptMedia() { return 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64'); }
  async getAllChats() { return this.chats; }
  async getAllMessages(chatId) { return this.mensagens[chatId] || []; }
  async loadEarlierMessages() { return false; }
  async evaluate() { return null; }
}
