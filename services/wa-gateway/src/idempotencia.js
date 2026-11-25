// Chave de idempotência → providerId, em memória + disco (JSONL), por 24 h.
// Mesma chave nunca envia duas vezes: pedidos concorrentes com a mesma chave
// esperam o primeiro terminar e recebem o mesmo resultado.
import fs from 'node:fs';
import path from 'node:path';

export const VALIDADE_MS = 24 * 60 * 60 * 1000;

export function erroIncerto(mensagem = 'O WhatsApp Web não confirmou o envio a tempo; pode ter sido enviado.') {
  const e = new Error(mensagem);
  e.status = 504;
  e.erro = 'aceite_incerto';
  e.incerto = true;
  return e;
}

export class Idempotencia {
  constructor(arquivo, { agora = () => Date.now() } = {}) {
    this.arquivo = arquivo;
    this.agora = agora;
    this.mapa = new Map(); // `${sessionId}|${chave}` → { providerId, em }
    this.emVoo = new Map(); // mesma chave → Promise
    this._carregar();
  }

  _k(sessionId, chave) {
    return `${sessionId}|${chave}`;
  }

  _carregar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    if (!fs.existsSync(this.arquivo)) return;
    const limite = this.agora() - VALIDADE_MS;
    for (const linha of fs.readFileSync(this.arquivo, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try {
        const r = JSON.parse(linha);
        if (r.em >= limite) this.mapa.set(r.k, { providerId: r.providerId ?? null, em: r.em, incerto: !!r.incerto });
      } catch {
        /* linha corrompida (queda no meio da escrita): ignora */
      }
    }
    this._compactar();
  }

  /** Reescreve o arquivo só com as entradas válidas (no boot e a cada hora). */
  _compactar() {
    const limite = this.agora() - VALIDADE_MS;
    for (const [k, v] of this.mapa) if (v.em < limite) this.mapa.delete(k);
    const tmp = this.arquivo + '.tmp';
    const linhas = [...this.mapa].map(([k, v]) => JSON.stringify({ k, providerId: v.providerId, em: v.em, ...(v.incerto ? { incerto: true } : {}) }));
    fs.writeFileSync(tmp, linhas.length ? linhas.join('\n') + '\n' : '');
    fs.renameSync(tmp, this.arquivo);
  }

  /** `{ providerId, incerto }` ou null. */
  obter(sessionId, chave) {
    const v = this.mapa.get(this._k(sessionId, chave));
    if (!v) return null;
    if (v.em < this.agora() - VALIDADE_MS) {
      this.mapa.delete(this._k(sessionId, chave));
      return null;
    }
    return v;
  }

  gravar(sessionId, chave, providerId, { incerto = false } = {}) {
    const k = this._k(sessionId, chave);
    const em = this.agora();
    this.mapa.set(k, { providerId, em, incerto });
    fs.appendFileSync(this.arquivo, JSON.stringify({ k, providerId, em, ...(incerto ? { incerto: true } : {}) }) + '\n');
  }

  /**
   * Executa `enviar()` no máximo uma vez por chave em 24 h.
   * - sucesso → grava o providerId (a mesma chave devolve o mesmo id);
   * - erro com `incerto: true` (504 aceite_incerto) → grava a chave como
   *   incerta: repetir a chave devolve 504 de novo, nunca reenvia;
   * - outro erro ("nada foi enviado": 400/409/422/429) → não grava, o KHUB
   *   pode tentar de novo com a mesma chave.
   */
  async executar(sessionId, chave, enviar) {
    const existente = this.obter(sessionId, chave);
    if (existente?.incerto) throw erroIncerto();
    if (existente) return { providerId: existente.providerId, repetido: true };
    const k = this._k(sessionId, chave);
    if (this.emVoo.has(k)) return this.emVoo.get(k).then((r) => ({ ...r, repetido: true }));
    const p = (async () => {
      let providerId;
      try {
        providerId = await enviar();
      } catch (e) {
        if (e?.incerto) this.gravar(sessionId, chave, null, { incerto: true });
        throw e;
      }
      this.gravar(sessionId, chave, providerId);
      return { providerId, repetido: false };
    })();
    this.emVoo.set(k, p);
    try {
      return await p;
    } finally {
      this.emVoo.delete(k);
    }
  }

  iniciarLimpeza() {
    this._timer = setInterval(() => {
      try {
        this._compactar();
      } catch {
        /* tenta de novo na próxima hora */
      }
    }, 60 * 60 * 1000);
    this._timer.unref();
  }

  parar() {
    clearInterval(this._timer);
  }
}
