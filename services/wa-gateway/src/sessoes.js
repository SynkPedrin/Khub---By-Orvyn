// Gerenciador de sessões: um Chromium (open-wa) por sessionId, todos no mesmo
// processo Node. API verificada contra @open-wa/{core,client,driver-puppeteer}
// 5.12.1 (os pacotes que compõem @open-wa/wa-automate 5.12.1).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { log } from './log.js';
import { erroIncerto } from './idempotencia.js';
import {
  mascarar,
  normalizarNumero,
  idCanonico,
  chatIdSerializado,
  ehChatIndividual,
  partirDataUrl,
  tamanhoBase64,
  estadoDoAck,
  comTimeout,
  agoraSeg,
  TIPOS_COM_MIDIA,
} from './util.js';
import {
  chatDaMensagem,
  deveIgnorar,
  numeroDoChat,
  paraMensagemWa,
  selecionarHistorico,
  AcumuladorLotes,
} from './mensagens.js';

export const MIDIA_MAX_BYTES = 2 * 1024 * 1024;
// Observado com WhatsApp Web em 2026-11: o 1º QR de um ciclo dura ~60 s, os seguintes ~20 s.
const qrExpiraSeg = (tentativa) => (tentativa === 1 ? 60 : 20);
const FOTO_TTL_MS = 24 * 60 * 60 * 1000;
const ENVIO_TIMEOUT_MS = 60_000;

export function erroHttp(status, erro, mensagem, extra = {}) {
  const e = new Error(mensagem || erro);
  e.status = status;
  e.erro = erro;
  Object.assign(e, extra);
  return e;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Carrega open-wa só quando a primeira sessão sobe (testes não precisam do Chromium). */
let libs;
async function carregarOpenWa(openwaLogLevel) {
  if (libs) return libs;
  const [{ createClient }, { Client }, { PuppeteerDriver }, logger] = await Promise.all([
    import('@open-wa/core'),
    import('@open-wa/client'),
    import('@open-wa/driver-puppeteer'),
    import('@open-wa/logger'),
  ]);
  try {
    // O logger interno do open-wa é winston; deixamos só avisos/erros.
    logger.rootLogger.instance.level = openwaLogLevel;
  } catch {
    /* sem impacto funcional */
  }
  libs = { createClient, Client, PuppeteerDriver };
  return libs;
}

export class GerenciadorSessoes {
  /**
   * @param {{ config: ReturnType<import('./config.js').lerConfig>, fila: import('./webhook.js').FilaWebhook, fabricaCliente?: Function }} deps
   * `fabricaCliente(sessionId, dir)` pode ser injetada em testes.
   */
  constructor({ config, fila, fabricaCliente }) {
    this.config = config;
    this.fila = fila;
    this.sessoes = new Map();
    this.fabricaCliente = fabricaCliente || ((id, dir) => this._criarClienteOpenWa(id, dir));
    this.encerrando = false;
    fs.mkdirSync(config.sessoesDir, { recursive: true });
  }

  dir(id) {
    return path.join(this.config.sessoesDir, id);
  }

  vivas() {
    let n = 0;
    for (const s of this.sessoes.values()) if (s.client || s.iniciando) n += 1;
    return n;
  }

  // ---------- persistência mínima do estado (para restaurar no boot) ----------

  _gravarMeta(s) {
    if (this.encerrando) return;
    try {
      fs.mkdirSync(this.dir(s.id), { recursive: true });
      const meta = { estado: s.estado, motivo: s.motivo || null, atualizadoEm: new Date().toISOString(), jaConectou: !!s.jaConectou };
      const arq = path.join(this.dir(s.id), 'estado.json');
      fs.writeFileSync(arq + '.tmp', JSON.stringify(meta));
      fs.renameSync(arq + '.tmp', arq);
    } catch (e) {
      log.warn('meta_falhou', { sessionId: s.id, erro: e });
    }
  }

  _lerMeta(id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(id), 'estado.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Sessões que estavam conectadas voltam sozinhas (sem QR) usando o arquivo de sessão do open-wa. */
  async restaurar() {
    let nomes = [];
    try {
      nomes = fs.readdirSync(this.config.sessoesDir);
    } catch {
      return;
    }
    for (const id of nomes) {
      if (!/^khub-[0-9a-f-]{36}$/.test(id)) continue;
      const meta = this._lerMeta(id);
      const temDados = fs.existsSync(path.join(this.dir(id), `${id}.data.json`));
      const deslogada = meta?.motivo === 'deslogado';
      if (meta?.jaConectou && temDados && !deslogada) {
        if (this.vivas() >= this.config.maxSessoes) {
          log.warn('restauracao_sem_vaga', { sessionId: id });
          continue;
        }
        log.info('restaurando_sessao', { sessionId: id });
        this.iniciar(id).catch((e) => log.error('restauracao_falhou', { sessionId: id, erro: e }));
      }
    }
  }

  // ---------- estado público ----------

  estadoPublico(s) {
    const o = { estado: s.estado };
    if (s.estado === 'aguardando_qr' && s.qr) {
      o.qr = s.qr;
      o.qrAtualizadoEm = s.qrAtualizadoEm;
    }
    if (s.estado === 'conectado') {
      if (s.numero) o.numero = s.numero;
      if (s.nome) o.nome = s.nome;
      if (s.fotoUrl) o.fotoUrl = s.fotoUrl;
    }
    if (s.estado === 'erro' && s.erro) o.erro = s.erro;
    return o;
  }

  obterEstado(id) {
    const s = this.sessoes.get(id);
    if (s) return this.estadoPublico(s);
    if (fs.existsSync(this.dir(id))) return { estado: 'desconectado' };
    return null;
  }

  /** Muda o estado, grava meta e (se mudou estado ou motivo) publica `sessao.estado`. */
  _mudarEstado(s, estado, { motivo } = {}) {
    const mudou = s.estado !== estado || (s.motivo || null) !== (motivo || null);
    const anterior = s.estado;
    s.estado = estado;
    s.motivo = motivo;
    if (estado !== 'aguardando_qr') s.qr = null;
    if (estado === 'conectado') s.jaConectou = true;
    this._gravarMeta(s);
    if (!mudou || this.encerrando) return;
    log.info('sessao_estado', { sessionId: s.id, de: anterior, para: estado, motivo });
    const dados = { estado };
    if (estado === 'conectado') {
      if (s.numero) dados.numero = s.numero;
      if (s.nome) dados.nome = s.nome;
      if (s.fotoUrl) dados.fotoUrl = s.fotoUrl;
    }
    if (motivo) dados.motivo = motivo;
    this.fila.publicar(s.id, 'sessao.estado', dados);
  }

  // ---------- ciclo de vida ----------

  /**
   * Idempotente: se já existe sessão viva, só devolve o estado. Uma chamada
   * enquanto outra está iniciando NÃO cria um segundo navegador.
   * Espera até `esperaMs` pela sessão sair de "iniciando" (QR ou conectado).
   */
  async iniciar(id, { esperaMs = 20_000 } = {}) {
    let s = this.sessoes.get(id);
    if (!s || (!s.client && !s.iniciando)) {
      if (this.vivas() >= this.config.maxSessoes) throw erroHttp(429, 'limite_sessoes', `Limite de ${this.config.maxSessoes} sessões neste gateway`);
      s = s || {
        id,
        estado: null,
        qr: null,
        qrAtualizadoEm: null,
        numero: null,
        nome: null,
        fotoUrl: null,
        erro: null,
        fotos: new Map(),
        historico: null,
        tentativasReinicio: 0,
        jaConectou: !!this._lerMeta(id)?.jaConectou,
      };
      this.sessoes.set(id, s);
      s.paradaIntencional = false;
      s.erro = null;
      this._mudarEstado(s, 'iniciando');
      s.iniciando = this._subir(s).finally(() => {
        s.iniciando = null;
      });
    }
    if (s.estado === 'iniciando' && esperaMs > 0) {
      const ate = Date.now() + esperaMs;
      while (s.estado === 'iniciando' && Date.now() < ate) await espera(250);
    }
    return this.estadoPublico(s);
  }

  async _subir(s) {
    fs.mkdirSync(this.dir(s.id), { recursive: true });
    let client;
    try {
      client = await this.fabricaCliente(s.id, this.dir(s.id));
      if (s.paradaIntencional) {
        await client.stop('removida').catch(() => {});
        return;
      }
      s.client = client;
      this._ligarEventos(s, client);
      await client.start(); // resolve quando READY (depois do QR) — ou quando é parado no meio
      if (s.paradaIntencional || this.encerrando) return;
      // Mesmo critério do create() do @open-wa/wa-automate: start() terminar não garante READY.
      if (typeof client.getState === 'function' && client.getState() !== 'READY') throw new Error('WhatsApp Web terminou a inicialização sem ficar pronto');
      s.tentativasReinicio = 0;
      await this._atualizarPerfil(s);
      this._mudarEstado(s, 'conectado');
    } catch (e) {
      if (client) await client.stop('startup-failure').catch(() => {});
      s.client = null;
      if (s.paradaIntencional || this.encerrando) return;
      log.error('sessao_falhou', { sessionId: s.id, erro: e });
      s.erro = String(e?.message || e).slice(0, 200).replace(/\d{8,}/g, (d) => mascarar(d));
      this._mudarEstado(s, 'erro', { motivo: 'falha_ao_iniciar' });
    }
  }

  async _criarClienteOpenWa(id, dir) {
    const { createClient, Client, PuppeteerDriver } = await carregarOpenWa(this.config.openwaLogLevel);
    const args = ['--disable-dev-shm-usage'];
    if (this.config.chromeSemSandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');
    const core = await createClient({
      sessionId: id,
      driver: new PuppeteerDriver(),
      sessionDataPath: dir, // arquivo: <dir>/<sessionId>.data.json
      headless: this.config.headless,
      qrTimeoutMs: 0, // espera o QR para sempre (o KHUB decide quando desistir)
      authTimeoutMs: 0,
      executablePath: this.config.chromePath,
      browser: this.config.chromePath ? { download: 'never' } : { download: 'auto' },
      browserArgs: args,
      licenseKey: this.config.licenca,
      killClientOnLogout: true,
      deleteSessionDataOnLogout: true,
      eventMode: false, // não espalha eventos no emissor global `ev`
      estimatedMemoryMb: 512,
    });
    return new Client({ client: core, transport: core.getTransport() });
  }

  _ligarEventos(s, client) {
    const ev = client.events;

    ev.on('launch.auth.qr.generated', async (p) => {
      const bruto = p?.details?.qr;
      if (!bruto) return;
      try {
        const dataUrl = await QRCode.toDataURL(bruto, { errorCorrectionLevel: 'L', margin: 2, width: 300 });
        s.qr = dataUrl;
        s.qrAtualizadoEm = new Date().toISOString();
        if (s.estado !== 'aguardando_qr') this._mudarEstado(s, 'aguardando_qr');
        this.fila.publicar(s.id, 'sessao.qr', { qr: dataUrl, expiraEmSeg: qrExpiraSeg(p?.details?.attemptInThisCycle) });
        log.info('qr_novo', { sessionId: s.id });
      } catch (e) {
        log.warn('qr_falhou', { sessionId: s.id, erro: e });
      }
    });

    ev.on('launch.auth.qr.scanned', () => this._mudarEstado(s, 'iniciando', { motivo: 'qr_lido' }));

    ev.on('session.state.changed', async (p) => {
      const prox = p?.details?.next;
      if (prox === 'READY' && s.estado !== 'conectado' && !s.iniciando) {
        await this._atualizarPerfil(s).catch(() => {});
        this._mudarEstado(s, 'conectado', { motivo: 'reconectado' });
      } else if (prox === 'DISCONNECTED') {
        this._mudarEstado(s, 'desconectado', { motivo: 'conexao_caiu' });
      } else if (prox === 'STOPPED') {
        this._aoParar(s);
      }
    });

    ev.on('session.logout', () => {
      log.warn('sessao_deslogada', { sessionId: s.id });
      s.paradaIntencional = true; // killClientOnLogout encerra o navegador
      s.client = null;
      this._mudarEstado(s, 'desconectado', { motivo: 'deslogado' });
    });

    client.onAnyMessage((msg) => this._aoReceberMensagem(s, msg).catch((e) => log.warn('mensagem_falhou', { sessionId: s.id, erro: e })));
    client.onAck((msg) => this._aoAck(s, msg));
  }

  _aoParar(s) {
    if (this.encerrando || s.paradaIntencional) return;
    if (s.iniciando) return; // _subir trata
    s.client = null;
    this._mudarEstado(s, 'desconectado', { motivo: 'navegador_parou' });
    if (!s.jaConectou) return;
    // Reinício automático com backoff (30 s, 1 min, 2 min … até 10 min).
    const atraso = Math.min(30_000 * 2 ** s.tentativasReinicio, 600_000);
    s.tentativasReinicio += 1;
    log.warn('reinicio_agendado', { sessionId: s.id, emSeg: Math.round(atraso / 1000) });
    clearTimeout(s.timerReinicio);
    s.timerReinicio = setTimeout(() => {
      if (this.sessoes.get(s.id) === s && !s.client && !s.iniciando && !s.paradaIntencional) {
        this.iniciar(s.id, { esperaMs: 0 }).catch((e) => log.error('reinicio_falhou', { sessionId: s.id, erro: e }));
      }
    }, atraso);
    s.timerReinicio.unref?.();
  }

  async _atualizarPerfil(s) {
    const c = s.client;
    if (!c) return;
    try {
      const host = await comTimeout(c.getHostNumber(), 10_000);
      s.numero = normalizarNumero(host) || s.numero;
    } catch {
      /* best effort */
    }
    try {
      const me = await comTimeout(c.getMe(), 10_000);
      s.nome = me?.pushname || me?.pushName || me?.name || me?.verifiedName || s.nome;
      if (!s.numero) s.numero = normalizarNumero(chatIdSerializado(me?.me) || me?.id);
    } catch {
      /* best effort */
    }
    if (s.numero) {
      try {
        s.fotoUrl = (await comTimeout(c.getProfilePic(`${s.numero}@c.us`), 10_000)) || null;
      } catch {
        s.fotoUrl = s.fotoUrl || null;
      }
    }
  }

  /** DELETE: logout no WhatsApp (melhor esforço) + para o navegador + apaga a pasta. */
  async remover(id) {
    const s = this.sessoes.get(id);
    if (s) {
      s.paradaIntencional = true;
      clearTimeout(s.timerReinicio);
      if (s.iniciando) await Promise.race([s.iniciando, espera(1_000)]);
      const c = s.client;
      if (c) {
        await comTimeout(this._logoutWhatsApp(c), 15_000).catch((e) => log.warn('logout_falhou', { sessionId: id, erro: e }));
        await comTimeout(c.stop('removida'), 20_000).catch((e) => log.warn('stop_falhou', { sessionId: id, erro: e }));
      }
      s.client = null;
      this.sessoes.delete(id);
    }
    fs.rmSync(this.dir(id), { recursive: true, force: true });
    log.info('sessao_removida', { sessionId: id });
    return { ok: true };
  }

  /**
   * open-wa 5.12.1 não expõe `logout()` no Client. Tentamos os pontos internos
   * conhecidos do WhatsApp Web; se nenhum existir, o aparelho some da lista de
   * "Aparelhos conectados" quando o WhatsApp expirar o vínculo (ou o cliente
   * remove manualmente). As credenciais locais são apagadas de qualquer forma.
   */
  async _logoutWhatsApp(c) {
    const r = await c.evaluate(async () => {
      const w = globalThis;
      const tentar = [
        () => w.Store?.AppState?.logout?.(),
        () => w.Store?.Socket?.logout?.(),
        () => (typeof w.require === 'function' ? w.require('WAWebSocketModel')?.Socket?.logout?.() : undefined),
      ];
      for (const t of tentar) {
        try {
          const v = t();
          if (v !== undefined) {
            await v;
            return true;
          }
        } catch {
          /* próximo */
        }
      }
      return false;
    }, null);
    if (r) await espera(2_000);
    return r;
  }

  async pararTodas() {
    this.encerrando = true;
    await Promise.all(
      [...this.sessoes.values()].map(async (s) => {
        clearTimeout(s.timerReinicio);
        if (s.client) await comTimeout(s.client.stop('shutdown'), 15_000).catch(() => {});
      }),
    );
  }

  // ---------- mensagens recebidas ----------

  async _resolverNumero(s, chatId, msg) {
    if (!chatId.endsWith('@lid')) return numeroDoChat(chatId);
    const candidatos = [msg?.chat?.contact?.phoneNumber, msg?.sender?.phoneNumber];
    for (const c of candidatos) {
      const v = chatIdSerializado(c);
      if (v && !v.endsWith('@lid')) return normalizarNumero(v);
    }
    try {
      const pn = await comTimeout(
        s.client.evaluate((lid) => {
          try {
            const c = globalThis.Store?.Contact?.get?.(lid);
            const p = c?.phoneNumber;
            return p?._serialized || (p?.user ? `${p.user}@c.us` : null);
          } catch {
            return null;
          }
        }, chatId),
        5_000,
      );
      return pn ? normalizarNumero(pn) : null;
    } catch {
      return null;
    }
  }

  async _aoReceberMensagem(s, msg) {
    if (deveIgnorar(msg)) return;
    const chatId = chatDaMensagem(msg);
    const numero = await this._resolverNumero(s, chatId, msg);
    if (!numero) {
      log.warn('mensagem_sem_numero', { sessionId: s.id, tipoChat: chatId.split('@')[1] });
      return;
    }
    if (s.numero && numero === s.numero) return; // conversa consigo mesmo
    const dados = paraMensagemWa(msg, { numero });
    const fotoCache = s.fotos.get(numero);
    if (fotoCache?.url) dados.fotoUrl = fotoCache.url;

    if (TIPOS_COM_MIDIA.has(msg.type)) {
      const midia = await this._baixarMidia(s, msg);
      if (midia) dados.midia = midia;
    }
    this.fila.publicar(s.id, 'mensagem', dados);
    log.info('mensagem', { sessionId: s.id, numero: mascarar(numero), deMim: dados.deMim, tipo: dados.tipo, midia: !!dados.midia });

    if (!fotoCache || Date.now() - fotoCache.em > FOTO_TTL_MS) this._atualizarFotoContato(s, numero, chatId);
  }

  async _baixarMidia(s, msg) {
    const declarado = Number(msg.size ?? msg.mediaData?.size ?? 0);
    if (declarado > MIDIA_MAX_BYTES) return null;
    try {
      const dataUrl = await comTimeout(s.client.decryptMedia(msg), 60_000);
      const p = partirDataUrl(dataUrl);
      if (!p || tamanhoBase64(p.base64) > MIDIA_MAX_BYTES) return null;
      const mime = msg.mimetype || p.mime;
      return { mime, nome: msg.filename || nomePadrao(mime, msg.type), base64: p.base64 };
    } catch (e) {
      log.warn('midia_falhou', { sessionId: s.id, tipo: msg.type, erro: e });
      return null;
    }
  }

  async _atualizarFotoContato(s, numero, chatId) {
    const anterior = s.fotos.get(numero);
    s.fotos.set(numero, { url: anterior?.url ?? null, em: Date.now() });
    try {
      const url = (await comTimeout(s.client.getProfilePic(chatId), 10_000)) || null;
      s.fotos.set(numero, { url, em: Date.now() });
      if (url && url !== anterior?.url) this.fila.publicar(s.id, 'contato.foto', { numero, fotoUrl: url });
    } catch {
      /* best effort */
    }
  }

  _aoAck(s, msg) {
    const estado = estadoDoAck(msg?.ack);
    if (!estado) return;
    if (msg?.isGroupMsg) return;
    const chat = chatDaMensagem(msg);
    if (chat && !ehChatIndividual(chat)) return;
    const id = idCanonico(msg?.id);
    if (!id) return;
    this.fila.publicar(s.id, 'mensagem.status', { ids: [id], estado });
  }

  // ---------- envio ----------

  _sessaoConectada(id) {
    const s = this.sessoes.get(id);
    // Sessão nunca iniciada também é "não conectada" (409): o KHUB trata 409 como "nada foi enviado".
    if (!s || s.estado !== 'conectado' || !s.client) throw erroHttp(409, 'sessao_desconectada', 'Sessão não está conectada');
    return s;
  }

  /** Confere se o número tem WhatsApp e devolve o chatId certo (resolve o 9º dígito). */
  async _destino(s, to) {
    const n = normalizarNumero(to);
    if (n.length < 8 || n.length > 15) throw erroHttp(422, 'numero_invalido', 'Número inválido');
    const chatId = `${n}@c.us`;
    let r;
    try {
      r = await comTimeout(s.client.checkNumberStatus(chatId), 15_000);
    } catch {
      return chatId; // verificação indisponível (versão/licença): segue com o número como veio
    }
    if (!r || typeof r !== 'object') return chatId;
    if (r.numberExists === false || Number(r.status) === 404) throw erroHttp(422, 'numero_invalido', 'Número sem WhatsApp');
    const real = chatIdSerializado(r.id);
    return real && real.includes('@') ? real : chatId;
  }

  async enviarTexto(sessionId, { to, texto }) {
    const s = this._sessaoConectada(sessionId);
    const chatId = await this._destino(s, to);
    let id;
    try {
      id = await comTimeout(s.client.sendText(chatId, texto), ENVIO_TIMEOUT_MS);
    } catch (e) {
      throw traduzirErroEnvio(e);
    }
    const providerId = idCanonico(id);
    if (!providerId) throw erroIncerto();
    log.info('texto_enviado', { sessionId, numero: mascarar(chatId) });
    return providerId;
  }

  /** @param {{to, tipo, mime, nome, legenda?, dataUrl}} m */
  async enviarMidia(sessionId, m) {
    const s = this._sessaoConectada(sessionId);
    const chatId = await this._destino(s, m.to);
    const opcoes = opcoesDeMidia(m);
    const inicio = agoraSeg();
    let r;
    try {
      r = await comTimeout(s.client.sendFile(chatId, m.dataUrl, m.nome, opcoes), ENVIO_TIMEOUT_MS * 2);
    } catch (e) {
      throw traduzirErroEnvio(e);
    }
    if (r === false) throw erroHttp(422, 'envio_recusado', 'O WhatsApp Web recusou a mídia');
    let providerId = typeof r === 'string' ? r : idCanonico(r);
    if (!providerId) providerId = await this._ultimoIdMeu(s, chatId, inicio); // sendFile devolveu só `true`
    if (!providerId) throw erroIncerto('Mídia aceita, mas o id da mensagem não pôde ser confirmado.');
    log.info('midia_enviada', { sessionId, numero: mascarar(chatId), tipo: m.tipo });
    return providerId;
  }

  async _ultimoIdMeu(s, chatId, desdeSeg) {
    try {
      const r = await comTimeout(
        s.client.evaluate((cid) => {
          const c = globalThis.Store?.Chat?.get?.(cid);
          const ms = c?.msgs?._models || c?.msgs?.models || [];
          for (let i = ms.length - 1; i >= 0; i -= 1) {
            const x = ms[i];
            if (x?.id?.fromMe) return { id: x.id._serialized, t: x.t };
          }
          return null;
        }, chatId),
        5_000,
      );
      if (r?.id && Number(r.t) >= desdeSeg - 5) return r.id;
    } catch {
      /* incerto */
    }
    return null;
  }

  // ---------- foto ----------

  async foto(sessionId, numero) {
    const s = this._sessaoConectada(sessionId);
    const n = normalizarNumero(numero);
    if (!n) throw erroHttp(400, 'numero_invalido', 'Número inválido');
    try {
      const url = (await comTimeout(s.client.getProfilePic(`${n}@c.us`), 10_000)) || null;
      return { url: typeof url === 'string' ? url : null };
    } catch {
      return { url: null };
    }
  }

  // ---------- histórico ----------

  iniciarHistorico(sessionId, { dias, maxPorChat }) {
    const s = this._sessaoConectada(sessionId);
    if (s.historico) return { loteId: s.historico }; // já rodando: mesmo lote
    const loteId = randomUUID();
    s.historico = loteId;
    log.info('historico_inicio', { sessionId, loteId, dias, maxPorChat });
    this._rodarHistorico(s, loteId, { dias, maxPorChat })
      .catch((e) => {
        log.error('historico_falhou', { sessionId, loteId, erro: e });
        this.fila.publicar(s.id, 'historico.lote', { loteId, chats: [], progresso: { feitos: 0, total: 0 }, ultimo: true });
      })
      .finally(() => {
        if (s.historico === loteId) s.historico = null;
      });
    return { loteId };
  }

  async _rodarHistorico(s, loteId, { dias, maxPorChat }) {
    const desdeSeg = agoraSeg() - dias * 86_400;
    const todos = (await comTimeout(s.client.getAllChats(), 120_000)) || [];
    const candidatos = todos
      .map((c) => ({ c, id: chatIdSerializado(c.id) }))
      .filter(({ c, id }) => !c.isGroup && ehChatIndividual(id) && Number(c.t || 0) >= desdeSeg)
      .sort((a, b) => Number(b.c.t || 0) - Number(a.c.t || 0));
    const total = candidatos.length;
    const acc = new AcumuladorLotes();
    let feitos = 0;
    let lotes = 0;
    let interrompido = false;

    for (const { c, id } of candidatos) {
      if (!s.client || s.estado !== 'conectado') {
        interrompido = true;
        break;
      }
      try {
        const numero = await this._resolverNumero(s, id, { chat: c });
        if (numero && numero !== s.numero) {
          const msgs = await this._carregarMensagens(s, id, desdeSeg, maxPorChat);
          const mensagens = selecionarHistorico(msgs, { desdeSeg, maxPorChat });
          if (mensagens.length) {
            let fotoUrl = null;
            try {
              fotoUrl = (await comTimeout(s.client.getProfilePic(id), 5_000)) || null;
            } catch {
              /* best effort */
            }
            const nome = c.contact?.name || c.contact?.pushname || c.name || c.formattedTitle || undefined;
            const item = { numero, mensagens };
            if (nome) item.nome = nome;
            if (fotoUrl) item.fotoUrl = fotoUrl;
            const pronto = acc.adicionar(item);
            if (pronto) {
              this.fila.publicar(s.id, 'historico.lote', { loteId, chats: pronto, progresso: { feitos, total }, ultimo: false });
              lotes += 1;
            }
          }
        }
      } catch (e) {
        log.warn('historico_chat_falhou', { sessionId: s.id, loteId, erro: e });
      }
      feitos += 1;
      await espera(150); // não martelar o WhatsApp Web
    }
    this.fila.publicar(s.id, 'historico.lote', { loteId, chats: acc.restante(), progresso: { feitos, total }, ultimo: true });
    log.info('historico_fim', { sessionId: s.id, loteId, feitos, total, lotes: lotes + 1, interrompido });
  }

  /** Mensagens carregadas do chat; pede mais antigas ao celular até cobrir a janela ou o limite. */
  async _carregarMensagens(s, chatId, desdeSeg, maxPorChat) {
    const ler = async () => (await comTimeout(s.client.getAllMessages(chatId, true, false), 60_000)) || [];
    let msgs = await ler().catch(() => []);
    for (let rodada = 0; rodada < 50; rodada += 1) {
      const ts = msgs.map((m) => Number(m.t ?? m.timestamp) || 0);
      const naJanela = ts.filter((t) => t >= desdeSeg).length;
      const maisAntiga = ts.length ? Math.min(...ts) : Infinity;
      if (naJanela >= maxPorChat || maisAntiga < desdeSeg) break;
      let novas;
      try {
        novas = await comTimeout(s.client.loadEarlierMessages(chatId), 20_000);
      } catch {
        break;
      }
      if (!Array.isArray(novas) || novas.length === 0) break;
      msgs = await ler().catch(() => msgs);
    }
    return msgs;
  }
}

// ---------- helpers de envio (puros) ----------

export function opcoesDeMidia({ tipo, mime, legenda }) {
  if (tipo === 'imagem') {
    if (!/^image\//.test(mime)) throw erroHttp(400, 'requisicao_invalida', 'tipo imagem exige mime image/*');
    return legenda ? { type: 'image', caption: legenda } : { type: 'image' };
  }
  if (tipo === 'documento') return legenda ? { type: 'document', caption: legenda } : { type: 'document' };
  if (tipo === 'audio') {
    if (!/^audio\//.test(mime)) throw erroHttp(400, 'requisicao_invalida', 'tipo audio exige mime audio/*');
    // ogg/opus vai como mensagem de voz (PTT); outros formatos como arquivo de áudio. Áudio não aceita legenda.
    return /^audio\/ogg/.test(mime) ? { type: 'audio', ptt: true } : { type: 'audio' };
  }
  throw erroHttp(400, 'requisicao_invalida', 'tipo deve ser imagem, documento ou audio');
}

const VALIDACAO_RE = /requires|must resolve|Could not resolve|do not support|presentation|Invalid|invalid/;

/** Erro do open-wa → erro HTTP do contrato. Incerto (504) quando não dá pra saber se saiu. */
export function traduzirErroEnvio(e) {
  if (e?.status) return e;
  if (e?.code === 'TIMEOUT') return erroIncerto();
  if (e?.name === 'SendTextError') {
    if (e.outcome === 'unknown') return erroIncerto();
    if (e.code === 'LICENSE_REQUIRED') return erroHttp(422, 'licenca_necessaria', 'Iniciar conversa com número que nunca escreveu exige licença open-wa');
    if (e.code === 'INVALID_ARGUMENT') return erroHttp(400, 'requisicao_invalida', 'Texto ou destino vazio');
    return erroHttp(422, 'envio_recusado', 'O WhatsApp Web recusou o envio');
  }
  if (e?.name === 'ZodError' || VALIDACAO_RE.test(String(e?.message || ''))) return erroHttp(400, 'requisicao_invalida', 'Mídia inválida para o tipo pedido');
  return erroIncerto();
}

function nomePadrao(mime, tipoWa) {
  const ext = (mime || '').split('/')[1]?.split(';')[0] || 'bin';
  return `${tipoWa || 'arquivo'}.${ext}`;
}
