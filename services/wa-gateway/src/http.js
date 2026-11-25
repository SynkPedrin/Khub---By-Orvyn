// Rotas HTTP do contrato (CONTRATO.md §1) sobre node:http, sem framework.
import http from 'node:http';
import { chaveConfere, sessionIdValido, normalizarNumero } from './util.js';
import { log } from './log.js';

export const VERSAO = '1.0.0';
const LIMITE_CORPO = 40 * 1024 * 1024; // mídia em base64 cabe folgado

function responder(res, status, corpo) {
  const s = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function erro(res, status, codigo, mensagem) {
  responder(res, status, { erro: codigo, mensagem: mensagem || codigo });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tam = 0;
    req.on('data', (c) => {
      tam += c.length;
      if (tam > LIMITE_CORPO) {
        const e = new Error('corpo grande demais');
        e.status = 413;
        e.erro = 'corpo_grande_demais';
        reject(e);
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      const bruto = Buffer.concat(partes).toString('utf8');
      if (!bruto.trim()) return resolve({});
      try {
        const v = JSON.parse(bruto);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        const e = new Error('JSON inválido');
        e.status = 400;
        e.erro = 'requisicao_invalida';
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function invalida(msg) {
  const e = new Error(msg);
  e.status = 400;
  e.erro = 'requisicao_invalida';
  return e;
}

/** Baixa `url` para base64 com limite de tamanho e timeout. */
async function baixarUrl(url, maxBytes, fetchImpl = fetch) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw invalida('url inválida');
  }
  if (!/^https?:$/.test(u.protocol)) throw invalida('url precisa ser http(s)');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetchImpl(u, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw invalida(`download da mídia falhou (${r.status})`);
    const tam = Number(r.headers.get('content-length') || 0);
    if (tam > maxBytes) throw invalida('mídia grande demais');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw invalida('mídia grande demais');
    return buf.toString('base64');
  } catch (e) {
    if (e.status) throw e;
    throw invalida('download da mídia falhou');
  } finally {
    clearTimeout(t);
  }
}

/** Validação do corpo de mídia (puro, testável). */
export function validarMidia(b) {
  if (typeof b.to !== 'string' && typeof b.to !== 'number') throw invalida('to obrigatório');
  if (!['imagem', 'documento', 'audio'].includes(b.tipo)) throw invalida("tipo deve ser 'imagem', 'documento' ou 'audio'");
  if (typeof b.mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+/.test(b.mime)) throw invalida('mime obrigatório');
  if (typeof b.nome !== 'string' || !b.nome.trim()) throw invalida('nome obrigatório');
  const temUrl = typeof b.url === 'string' && b.url.length > 0;
  const temB64 = typeof b.base64 === 'string' && b.base64.length > 0;
  if (temUrl === temB64) throw invalida('envie exatamente um de url ou base64');
  if (temB64 && b.base64.startsWith('data:')) throw invalida('base64 sem prefixo data:');
  if (b.legenda !== undefined && typeof b.legenda !== 'string') throw invalida('legenda deve ser texto');
  if (typeof b.idempotencyKey !== 'string' || !b.idempotencyKey.trim()) throw invalida('idempotencyKey obrigatório');
}

/**
 * @param {{ config, gerenciador, idem, fila }} deps — `gerenciador` pode ser um falso em testes.
 */
export function criarServidor({ config, gerenciador, idem, fila, fetchImpl = fetch }) {
  const maxMidia = config.maxMidiaMb * 1024 * 1024;

  async function rotear(req, res) {
    const url = new URL(req.url, 'http://x');
    const partes = url.pathname.split('/').filter(Boolean);
    const m = req.method;

    if (!chaveConfere(req.headers['x-gateway-key'], config.chave)) return erro(res, 401, 'nao_autorizado', 'x-gateway-key ausente ou errada');

    if (m === 'GET' && url.pathname === '/health') {
      return responder(res, 200, { ok: true, sessoes: gerenciador.vivas(), versao: VERSAO, filaWebhook: fila?.pendentes?.() ?? 0 });
    }

    if (partes[0] !== 'sessions' || partes.length < 2) return erro(res, 404, 'rota_inexistente');
    const sessionId = partes[1];
    if (!sessionIdValido(sessionId)) return erro(res, 400, 'session_id_invalido', 'sessionId deve casar com ^khub-[0-9a-f-]{36}$');
    const resto = partes.slice(2).join('/');

    if (m === 'POST' && resto === 'start') {
      await lerCorpo(req);
      return responder(res, 200, await gerenciador.iniciar(sessionId));
    }
    if (m === 'GET' && resto === '') {
      const e = gerenciador.obterEstado(sessionId);
      return e ? responder(res, 200, e) : erro(res, 404, 'sessao_inexistente', 'Sessão nunca iniciada');
    }
    if (m === 'DELETE' && resto === '') {
      return responder(res, 200, await gerenciador.remover(sessionId));
    }
    if (m === 'POST' && resto === 'messages/text') {
      const b = await lerCorpo(req);
      if (typeof b.to !== 'string' && typeof b.to !== 'number') throw invalida('to obrigatório');
      if (typeof b.texto !== 'string' || !b.texto.length) throw invalida('texto obrigatório');
      if (typeof b.idempotencyKey !== 'string' || !b.idempotencyKey.trim()) throw invalida('idempotencyKey obrigatório');
      const r = await idem.executar(sessionId, b.idempotencyKey, () => gerenciador.enviarTexto(sessionId, { to: String(b.to), texto: b.texto }));
      return responder(res, 200, { providerId: r.providerId });
    }
    if (m === 'POST' && resto === 'messages/media') {
      const b = await lerCorpo(req);
      validarMidia(b);
      const est = gerenciador.obterEstado(sessionId);
      if (!est || est.estado !== 'conectado') return erro(res, 409, 'sessao_desconectada', 'Sessão não está conectada');
      const r = await idem.executar(sessionId, b.idempotencyKey, async () => {
        const base64 = b.base64 ? b.base64.replace(/\s+/g, '') : await baixarUrl(b.url, maxMidia, fetchImpl);
        if (Buffer.byteLength(base64) * 0.75 > maxMidia) throw invalida('mídia grande demais');
        const dataUrl = `data:${b.mime};base64,${base64}`;
        return gerenciador.enviarMidia(sessionId, { to: String(b.to), tipo: b.tipo, mime: b.mime, nome: b.nome, legenda: b.legenda || undefined, dataUrl });
      });
      return responder(res, 200, { providerId: r.providerId });
    }
    if (m === 'POST' && resto === 'historico') {
      const b = await lerCorpo(req);
      const dias = b.dias === undefined ? 90 : Number(b.dias);
      const maxPorChat = b.maxPorChat === undefined ? 300 : Number(b.maxPorChat);
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw invalida('dias entre 1 e 365');
      if (!Number.isInteger(maxPorChat) || maxPorChat < 1 || maxPorChat > 2000) throw invalida('maxPorChat entre 1 e 2000');
      return responder(res, 202, gerenciador.iniciarHistorico(sessionId, { dias, maxPorChat }));
    }
    if (m === 'GET' && partes[2] === 'foto' && partes.length === 4) {
      const numero = normalizarNumero(decodeURIComponent(partes[3]));
      if (!numero) throw invalida('numero inválido');
      return responder(res, 200, await gerenciador.foto(sessionId, numero));
    }
    return erro(res, 404, 'rota_inexistente');
  }

  const servidor = http.createServer((req, res) => {
    const inicio = Date.now();
    rotear(req, res)
      .catch((e) => {
        if (e?.status) return erro(res, e.status, e.erro || 'erro', e.message);
        log.error('erro_interno', { metodo: req.method, rota: rotaParaLog(req.url), erro: e });
        return erro(res, 500, 'erro_interno', 'Erro interno do gateway');
      })
      .finally(() => {
        log.debug('http', { metodo: req.method, rota: rotaParaLog(req.url), status: res.statusCode, ms: Date.now() - inicio });
      });
  });
  servidor.requestTimeout = 180_000;
  return servidor;
}

/** Rota sem o número da foto (logs nunca levam número). */
function rotaParaLog(u) {
  return String(u || '').split('?')[0].replace(/\/foto\/[^/]+$/, '/foto/:numero');
}
