// Webhook gateway → KHUB (CONTRATO.md §2) com fila persistente em disco.
//
// Cada evento vira um arquivo `<DATA_DIR>/fila/<criadoEm>-<eventId>.json`
// (escrita atômica: tmp + rename) ANTES de qualquer tentativa de entrega, então
// reinício do processo não perde evento. Entregue (2xx) → arquivo apagado.
// 5xx / timeout / erro de rede / 408 / 429 → nova tentativa com backoff
// 2 s, 10 s, 60 s, 5 min, 5 min, 5 min (até 6 novas tentativas), sempre com o
// MESMO eventId e o mesmo corpo; só timestamp e assinatura são refeitos.
// Outros 4xx ou tentativas esgotadas → move para `<DATA_DIR>/fila-falhas/`.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assinar, agoraSeg } from './util.js';
import { log } from './log.js';

export const BACKOFF_MS = [2_000, 10_000, 60_000, 300_000, 300_000, 300_000];
const TIMEOUT_MS = 15_000;
const CONCORRENCIA = 4;

/** Envelope do contrato. */
export function criarEnvelope(sessionId, tipo, dados, { eventId = randomUUID(), criadoEm = new Date() } = {}) {
  return { eventId, sessionId, tipo, criadoEm: criadoEm.toISOString(), dados };
}

/** Cabeçalhos assinados para um corpo cru. */
export function cabecalhosAssinados(segredo, corpoCru, ts = agoraSeg()) {
  return {
    'content-type': 'application/json',
    'x-khub-timestamp': String(ts),
    'x-khub-signature': assinar(segredo, ts, corpoCru),
  };
}

export function deveRetentar(status) {
  return status === 0 || status >= 500 || status === 408 || status === 429;
}

export class FilaWebhook {
  constructor({ dataDir, url, segredo, fetchImpl = fetch, agora = () => Date.now() }) {
    this.dir = path.join(dataDir, 'fila');
    this.dirFalhas = path.join(dataDir, 'fila-falhas');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.dirFalhas, { recursive: true });
    this.url = url;
    this.segredo = segredo;
    this.fetch = fetchImpl;
    this.agora = agora;
    this.itens = new Map(); // arquivo → { envelope, corpo, tentativas, proximaEm }
    this.ativos = new Set();
    this.timer = null;
    this.parado = true; // só entrega depois de iniciar()
    this._carregar();
  }

  _carregar() {
    for (const nome of fs.readdirSync(this.dir).sort()) {
      if (!nome.endsWith('.json')) continue;
      const arq = path.join(this.dir, nome);
      try {
        const item = JSON.parse(fs.readFileSync(arq, 'utf8'));
        this.itens.set(arq, { ...item, proximaEm: 0 });
      } catch {
        fs.renameSync(arq, path.join(this.dirFalhas, nome));
      }
    }
    if (this.itens.size) log.info('fila_webhook_restaurada', { pendentes: this.itens.size });
  }

  pendentes() {
    return this.itens.size;
  }

  /** Persiste e agenda. Retorna o envelope (com eventId). */
  publicar(sessionId, tipo, dados) {
    const envelope = criarEnvelope(sessionId, tipo, dados);
    const corpo = JSON.stringify(envelope);
    const nome = `${Date.now().toString().padStart(14, '0')}-${envelope.eventId}.json`;
    const arq = path.join(this.dir, nome);
    const item = { corpo, tentativas: 0, tipo, sessionId, eventId: envelope.eventId };
    const tmp = arq + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(item));
    fs.renameSync(tmp, arq);
    this.itens.set(arq, { ...item, proximaEm: 0 });
    this._bombear();
    return envelope;
  }

  iniciar() {
    this.parado = false;
    this.timer = setInterval(() => this._bombear(), 1_000);
    this.timer.unref();
    this._bombear();
  }

  async parar() {
    this.parado = true;
    clearInterval(this.timer);
  }

  _bombear() {
    if (this.parado) return;
    const agora = this.agora();
    for (const [arq, item] of this.itens) {
      if (this.ativos.size >= CONCORRENCIA) break;
      if (this.ativos.has(arq) || item.proximaEm > agora) continue;
      this.ativos.add(arq);
      this._entregar(arq, item).finally(() => {
        this.ativos.delete(arq);
        setImmediate(() => this._bombear());
      });
    }
  }

  async _entregar(arq, item) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const r = await this.fetch(this.url, {
          method: 'POST',
          headers: cabecalhosAssinados(this.segredo, item.corpo),
          body: item.corpo,
          signal: ctrl.signal,
        });
        status = r.status;
        await r.arrayBuffer().catch(() => {});
      } finally {
        clearTimeout(t);
      }
    } catch {
      status = 0; // rede/timeout
    }

    if (status >= 200 && status < 300) {
      this.itens.delete(arq);
      fs.rmSync(arq, { force: true });
      log.debug('webhook_entregue', { tipo: item.tipo, eventId: item.eventId, sessionId: item.sessionId });
      return;
    }

    item.tentativas += 1;
    if (deveRetentar(status) && item.tentativas <= BACKOFF_MS.length) {
      item.proximaEm = this.agora() + BACKOFF_MS[item.tentativas - 1];
      const tmp = arq + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ corpo: item.corpo, tentativas: item.tentativas, tipo: item.tipo, sessionId: item.sessionId, eventId: item.eventId }));
      fs.renameSync(tmp, arq);
      log.warn('webhook_retentativa', { tipo: item.tipo, eventId: item.eventId, sessionId: item.sessionId, status, tentativa: item.tentativas });
      return;
    }
    this.itens.delete(arq);
    try {
      fs.renameSync(arq, path.join(this.dirFalhas, path.basename(arq)));
    } catch {
      /* já removido */
    }
    log.error('webhook_desistiu', { tipo: item.tipo, eventId: item.eventId, sessionId: item.sessionId, status, tentativas: item.tentativas });
  }
}
