import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { TipoEntrada } from './midia-entrada';

/**
 * MÍDIA DO WHATSAPP (motor SM v2 / whatsmeow): achar, baixar e decifrar.
 *
 * O evento normalizado da Stevo não traz URL pública da mídia: o que existe é
 * o `raw` do whatsmeow, com o endereço do arquivo CIFRADO no CDN do WhatsApp
 * (`URL` / `directPath`) e a chave (`mediaKey`). Medido em produção
 * (2026-11-16): 486 mídias recebidas, nenhuma com `media.url`.
 *
 * Este arquivo é só função pura + download com `fetch` injetável:
 *  - `extrairMidiaDoRaw`  → do `raw` (objeto, invólucro ou string cortada) só os
 *    campos de download — nunca o raw inteiro, nunca miniatura (LGPD);
 *  - `baixarMidiaWhatsApp` → download com guarda de SSRF + decifragem verificada;
 *  - `baixarMidiaAberta`   → mídia por URL https comum (API oficial);
 *  - `estruturaDoRaw`      → só NOMES de chaves, para diagnóstico em log.
 *
 * Nada aqui escreve log: quem chama decide o que registrar (nunca URL, chave,
 * telefone ou texto).
 */

/** Família de chaves do WhatsApp (define o `info` do HKDF). */
export type ClasseMidia = 'image' | 'video' | 'audio' | 'document';

/** O mínimo para baixar e decifrar uma mídia. É o que viaja no outbox. */
export interface CriptoMidia {
  /** URL https do CDN (já validada: host `*.whatsapp.net`). */
  url: string | null;
  /** Caminho no CDN; serve de reserva: `https://mmg.whatsapp.net` + directPath. */
  directPath: string | null;
  /** Chave da mídia em base64 (32 bytes). */
  mediaKey: string;
  /** sha256 (base64) do arquivo CIFRADO, quando o evento informa. */
  fileEncSha256: string | null;
  /** sha256 (base64) do arquivo em claro, quando o evento informa. */
  fileSha256: string | null;
  /** Tamanho em claro, em bytes, quando o evento informa. */
  fileLength: number | null;
  classe: ClasseMidia;
}

/** O que dá para tirar do `raw` de uma mensagem de mídia. */
export interface MidiaDoRaw {
  cripto: CriptoMidia;
  mime: string | null;
  nome: string | null;
  legenda: string | null;
  segundos: number | null;
  notaDeVoz: boolean;
}

/** Teto de mídia que o KHUB baixa (o mesmo do download antigo por URL). */
export const TETO_MIDIA_BYTES = 15 * 1024 * 1024;
export const HOST_CDN_WHATSAPP = 'mmg.whatsapp.net';

const INFO_HKDF: Record<ClasseMidia, string> = {
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

/** Nó do protobuf (`imageMessage`…) → família de chaves. Figurinha usa as de imagem. */
const CLASSE_DO_NO: Record<string, ClasseMidia> = {
  imagemessage: 'image',
  stickermessage: 'image',
  videomessage: 'video',
  ptvmessage: 'video',
  audiomessage: 'audio',
  documentmessage: 'document',
};

const CLASSE_DO_TIPO: Record<TipoEntrada, ClasseMidia> = {
  figurinha: 'image',
  imagem: 'image',
  audio: 'audio',
  video: 'video',
  documento: 'document',
};

/**
 * Chaves em que a busca NÃO entra: carregam a mensagem CITADA (que tem a
 * própria mediaKey) — baixar por engano a mídia de outra mensagem seria ler o
 * arquivo errado.
 */
const NAO_DESCER = new Set(['contextinfo', 'messagecontextinfo', 'quotedmessage']);

/* ------------------------------------------------------------------ */
/* Erros                                                                */
/* ------------------------------------------------------------------ */

/** Motivo curto e sem dado pessoal — vai para `anexo.leitura.motivo` e para o log. */
export type MotivoMidia =
  | 'sem_dados_de_download'
  | 'origem_recusada'
  | 'grande_demais'
  | 'vazio'
  | 'rede'
  | 'tempo_esgotado'
  | 'chave_invalida'
  | 'integridade'
  | 'mac_invalido'
  | 'decifragem'
  | `http_${number}`;

export class ErroMidia extends Error {
  constructor(readonly motivo: MotivoMidia) {
    super(`midia: ${motivo}`);
    this.name = 'ErroMidia';
  }
}

/* ------------------------------------------------------------------ */
/* Guardas de URL (SSRF: o valor vem de terceiros)                      */
/* ------------------------------------------------------------------ */

function urlHttpsLimpa(valor: string): URL | null {
  if (valor.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  return u;
}

/** Só https e host `mmg.whatsapp.net` ou terminado em `.whatsapp.net`. */
export function urlWhatsAppSegura(valor: string | null | undefined): string | null {
  const u = typeof valor === 'string' ? urlHttpsLimpa(valor.trim()) : null;
  if (!u) return null;
  const host = u.hostname;
  return host === HOST_CDN_WHATSAPP || host.endsWith('.whatsapp.net') ? u.toString() : null;
}

/** `directPath` → URL no CDN do WhatsApp (ou `null` se o caminho for estranho). */
export function urlDoDirectPath(directPath: string | null | undefined): string | null {
  if (typeof directPath !== 'string' || !directPath.startsWith('/') || directPath.length > 1024) return null;
  return urlWhatsAppSegura(`https://${HOST_CDN_WHATSAPP}${directPath}`);
}

/**
 * URL https "aberta" (API oficial): sem credencial embutida, sem IP literal e
 * sem nome interno. Não substitui a lista fechada do WhatsApp — é o piso para
 * um endereço que vem do provedor.
 */
export function urlPublicaSegura(valor: string | null | undefined): string | null {
  const u = typeof valor === 'string' ? urlHttpsLimpa(valor.trim()) : null;
  if (!u) return null;
  const host = u.hostname;
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host)) return null;
  return u.toString();
}

/* ------------------------------------------------------------------ */
/* Extração do raw                                                      */
/* ------------------------------------------------------------------ */

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** base64 (ou vetor de bytes) com exatamente `n` bytes → base64 canônico. */
function bytesB64(v: unknown, n: number): string | null {
  let buf: Buffer | null = null;
  if (typeof v === 'string' && v.length <= 4 * n && /^[A-Za-z0-9+/_=-]+$/.test(v)) buf = Buffer.from(v, 'base64');
  else if (Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) buf = Buffer.from(v as number[]);
  return buf && buf.length === n ? buf.toString('base64') : null;
}

function inteiro(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** Campos crus (nomes em minúsculas) → mídia validada. `null` se não dá para baixar. */
function montar(campos: Record<string, unknown>, classe: ClasseMidia): MidiaDoRaw | null {
  const mediaKey = bytesB64(campos.mediakey, 32);
  if (!mediaKey) return null;
  const url = urlWhatsAppSegura(texto(campos.url, 2048));
  const direct = texto(campos.directpath, 1024);
  const directPath = direct && urlDoDirectPath(direct) ? direct : null;
  if (!url && !directPath) return null;
  return {
    cripto: {
      url,
      directPath,
      mediaKey,
      fileEncSha256: bytesB64(campos.fileencsha256, 32),
      fileSha256: bytesB64(campos.filesha256, 32),
      fileLength: inteiro(campos.filelength, Number.MAX_SAFE_INTEGER),
      classe,
    },
    mime: texto(campos.mimetype, 120),
    nome: texto(campos.filename, 200) ?? texto(campos.title, 200),
    legenda: texto(campos.caption, 4000),
    segundos: inteiro(campos.seconds, 86_400),
    notaDeVoz: campos.ptt === true,
  };
}

const minusculas = (o: Record<string, unknown>): Record<string, unknown> => {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) r[k.toLowerCase()] = v;
  return r;
};

/**
 * Busca em largura por um objeto com `mediaKey` + (`URL` | `directPath`).
 * Largura (e não profundidade) para o nó mais raso vencer; cobre os invólucros
 * `ephemeralMessage`, `viewOnceMessage(V2)` e `documentWithCaptionMessage`
 * sem listar cada um.
 */
function buscarNoObjeto(raiz: Record<string, unknown>, esperada: ClasseMidia): { achado: MidiaDoRaw | null; textos: string[] } {
  const fila: { valor: unknown; pai: string; prof: number }[] = [{ valor: raiz, pai: '', prof: 0 }];
  const textos: string[] = [];
  let reserva: MidiaDoRaw | null = null;
  let visitados = 0;
  while (fila.length && visitados < 3000) {
    const { valor, pai, prof } = fila.shift()!;
    visitados++;
    if (typeof valor === 'string') {
      // Raw cortado guardado como texto dentro de um objeto: tenta por regex depois.
      if (valor.length > 60 && /mediaKey/i.test(valor) && textos.length < 4) textos.push(valor);
      continue;
    }
    if (Array.isArray(valor)) {
      if (prof < 10) for (const item of valor.slice(0, 20)) fila.push({ valor: item, pai, prof: prof + 1 });
      continue;
    }
    if (!ehObjeto(valor)) continue;
    const campos = minusculas(valor);
    if (campos.mediakey !== undefined) {
      const doNo = CLASSE_DO_NO[pai];
      const midia = montar(campos, doNo ?? esperada);
      if (midia) {
        // O nome do nó é a verdade sobre a família de chaves; o tipo normalizado desempata.
        if (!doNo || doNo === esperada) return { achado: midia, textos };
        reserva ??= midia;
      }
    }
    if (prof >= 10) continue;
    for (const [k, v] of Object.entries(valor)) {
      const chave = k.toLowerCase();
      if (NAO_DESCER.has(chave)) continue;
      if (v && (typeof v === 'object' || typeof v === 'string')) fila.push({ valor: v, pai: chave, prof: prof + 1 });
    }
  }
  return { achado: reserva, textos };
}

/** Valor de string JSON (com escapes do Go: `&` no lugar de `&`) → texto. */
function decodificarJson(valor: string): string | null {
  try {
    const v: unknown = JSON.parse(`"${valor}"`);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Raw que chegou como STRING JSON cortada: não dá para fazer parse, então os
 * campos saem por regex. Só vale valor COMPLETO (com a aspa de fechamento) —
 * URL cortada no meio não serve. A janela vai do nó da mídia até o
 * `contextInfo` (onde começa a mensagem citada).
 */
function buscarNoTexto(bruto: string, esperada: ClasseMidia): MidiaDoRaw | null {
  let t = bruto.length > 400_000 ? bruto.slice(0, 400_000) : bruto;
  // JSON dentro de JSON: desfaz um nível de escape.
  if (!/"mediaKey"/i.test(t) && /\\"mediaKey\\"/i.test(t)) t = t.replace(/\\(["\\/])/g, '$1');
  const iChave = t.search(/"mediaKey"\s*:/i);
  if (iChave < 0) return null;
  let inicio = 0;
  let no = '';
  const reNo = /"(\w+Message)"\s*:\s*\{/g;
  for (let m = reNo.exec(t); m && m.index < iChave; m = reNo.exec(t)) {
    const nome = m[1].toLowerCase();
    if (NAO_DESCER.has(nome)) continue;
    inicio = m.index;
    no = nome;
  }
  // A mediaKey achada está dentro de uma mensagem citada (não é a mídia desta mensagem).
  const antes = t.slice(inicio, iChave);
  if (/"(contextInfo|quotedMessage)"\s*:/i.test(antes)) return null;
  const resto = t.slice(iChave);
  const iFim = resto.search(/"(contextInfo|quotedMessage)"\s*:/i);
  const janela = t.slice(inicio, iFim < 0 ? t.length : iChave + iFim);

  const str = (nome: string): string | null => {
    const m = new RegExp(`"${nome}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(janela);
    return m ? decodificarJson(m[1]) : null;
  };
  const num = (nome: string): string | null => new RegExp(`"${nome}"\\s*:\\s*"?(\\d{1,15})"?\\s*[,}]`, 'i').exec(janela)?.[1] ?? null;
  return montar(
    {
      mediakey: str('mediaKey'),
      url: str('URL'),
      directpath: str('directPath'),
      fileencsha256: str('fileEncSHA256'),
      filesha256: str('fileSHA256'),
      filelength: num('fileLength'),
      mimetype: str('mimetype'),
      filename: str('fileName'),
      title: str('title'),
      caption: str('caption'),
      seconds: num('seconds'),
      ptt: /"PTT"\s*:\s*true/i.test(janela),
    },
    CLASSE_DO_NO[no] ?? esperada,
  );
}

/**
 * Tira do `raw` do evento os dados de download da mídia.
 * Aceita: objeto do whatsmeow (`{Info, Message:{imageMessage…}}`), mídia dentro
 * de invólucro, objeto com o JSON cortado guardado em texto, e string JSON
 * (inteira ou cortada). Devolve `null` quando não há como baixar.
 */
export function extrairMidiaDoRaw(raw: unknown, tipo: TipoEntrada): MidiaDoRaw | null {
  const esperada = CLASSE_DO_TIPO[tipo];
  if (typeof raw === 'string') {
    let inteiro_: unknown = null;
    try {
      inteiro_ = JSON.parse(raw);
    } catch {
      inteiro_ = null;
    }
    if (ehObjeto(inteiro_)) {
      const r = buscarNoObjeto(inteiro_, esperada);
      if (r.achado) return r.achado;
    }
    return buscarNoTexto(raw, esperada);
  }
  if (!ehObjeto(raw)) return null;
  const r = buscarNoObjeto(raw, esperada);
  if (r.achado) return r.achado;
  for (const t of r.textos) {
    const m = extrairMidiaDoRaw(t, tipo);
    if (m) return m;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Diagnóstico: só a estrutura                                          */
/* ------------------------------------------------------------------ */

const nomeSeguro = (k: string) => (/^[A-Za-z0-9_]{1,40}$/.test(k) ? k : '?');

/**
 * Estrutura de chaves do raw (nomes e tipos, profundidade ≤ `profMax`) — nunca
 * valores. Chave fora do padrão de nome de campo vira `?` (poderia ser um dado).
 */
export function estruturaDoRaw(raw: unknown, profMax = 4): string {
  const ver = (v: unknown, prof: number): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return `str(${v.length})`;
    if (typeof v !== 'object') return typeof v;
    if (Array.isArray(v)) return `[${v.length}${v.length && prof < profMax ? `:${ver(v[0], prof + 1)}` : ''}]`;
    const chaves = Object.keys(v as Record<string, unknown>);
    if (prof >= profMax) return `{${chaves.length}}`;
    const partes = chaves.slice(0, 30).map((k) => `${nomeSeguro(k)}:${ver((v as Record<string, unknown>)[k], prof + 1)}`);
    return `{${partes.join(',')}${chaves.length > 30 ? ',…' : ''}}`;
  };
  if (typeof raw === 'string') {
    const nomes = new Set<string>();
    for (const m of raw.slice(0, 200_000).matchAll(/"([A-Za-z0-9_]{1,40})"\s*:/g)) {
      nomes.add(m[1]);
      if (nomes.size >= 60) break;
    }
    return `str(${raw.length}) chaves:[${[...nomes].join(',')}]`;
  }
  return ver(raw, 0).slice(0, 1500);
}

/* ------------------------------------------------------------------ */
/* Decifragem                                                           */
/* ------------------------------------------------------------------ */

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

/**
 * Decifra o arquivo baixado do CDN (ciphertext + 10 bytes de MAC).
 *
 *   chave = HKDF-SHA256(mediaKey, salt = 32 zeros, info = "WhatsApp <Classe> Keys", 112 bytes)
 *   iv = [0,16) · cipherKey = [16,48) · macKey = [48,80)
 *   MAC = HMAC-SHA256(macKey, iv || ciphertext) truncado em 10 bytes
 *   claro = AES-256-CBC(cipherKey, iv)
 *
 * Confere o MAC sempre e os dois sha256 quando informados. Qualquer divergência
 * lança `ErroMidia` — arquivo adulterado nunca chega ao leitor.
 */
export function decifrarMidiaWhatsApp(arquivo: Buffer, c: Pick<CriptoMidia, 'mediaKey' | 'classe' | 'fileEncSha256' | 'fileSha256' | 'fileLength'>): Buffer {
  const mediaKey = Buffer.from(c.mediaKey, 'base64');
  if (mediaKey.length !== 32) throw new ErroMidia('chave_invalida');
  if (arquivo.length < 26 || (arquivo.length - 10) % 16 !== 0) throw new ErroMidia('integridade');
  if (c.fileEncSha256 && !sha256(arquivo).equals(Buffer.from(c.fileEncSha256, 'base64'))) throw new ErroMidia('integridade');

  const chaves = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), INFO_HKDF[c.classe], 112));
  const iv = chaves.subarray(0, 16);
  const cipherKey = chaves.subarray(16, 48);
  const macKey = chaves.subarray(48, 80);
  const corpo = arquivo.subarray(0, arquivo.length - 10);
  const mac = arquivo.subarray(arquivo.length - 10);
  const esperado = createHmac('sha256', macKey).update(iv).update(corpo).digest().subarray(0, 10);
  if (!timingSafeEqual(esperado, mac)) throw new ErroMidia('mac_invalido');

  let claro: Buffer;
  try {
    const d = createDecipheriv('aes-256-cbc', cipherKey, iv);
    claro = Buffer.concat([d.update(corpo), d.final()]);
  } catch {
    throw new ErroMidia('decifragem');
  }
  if (c.fileSha256 && !sha256(claro).equals(Buffer.from(c.fileSha256, 'base64'))) throw new ErroMidia('integridade');
  if (c.fileLength !== null && c.fileLength !== undefined && claro.length !== c.fileLength) throw new ErroMidia('integridade');
  return claro;
}

/* ------------------------------------------------------------------ */
/* Download                                                             */
/* ------------------------------------------------------------------ */

/** Subconjunto do `fetch` que usamos — injetável nos testes. */
export type BuscarHttp = (url: string, init: { signal: AbortSignal; redirect: 'error' | 'manual' }) => Promise<Response>;

export interface OpcoesDownload {
  buscar?: BuscarHttp;
  /** Tempo máximo por tentativa (cabeçalhos + corpo). */
  timeoutMs?: number;
  /** Teto do arquivo em claro. */
  tetoBytes?: number;
}

const buscarPadrao: BuscarHttp = (url, init) => fetch(url, init);

/** Lê o corpo sem nunca passar do teto (o `content-length` pode mentir ou faltar). */
async function lerCorpo(res: Response, teto: number): Promise<Buffer> {
  const declarado = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > teto) throw new ErroMidia('grande_demais');
  if (!res.body) {
    const tudo = Buffer.from(await res.arrayBuffer());
    if (tudo.length > teto) throw new ErroMidia('grande_demais');
    return tudo;
  }
  const leitor = res.body.getReader();
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      throw new ErroMidia('grande_demais');
    }
    partes.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(partes, total);
}

function erroDeRede(e: unknown): ErroMidia {
  if (e instanceof ErroMidia) return e;
  const nome = e instanceof Error ? e.name : '';
  return new ErroMidia(nome === 'TimeoutError' || nome === 'AbortError' ? 'tempo_esgotado' : 'rede');
}

/** GET com timeout cobrindo cabeçalhos e corpo; status fora de 2xx vira `http_<n>`. */
async function baixarBytes(url: string, redirect: 'error' | 'manual', teto: number, o: OpcoesDownload): Promise<{ res: Response; corpo: Buffer | null }> {
  const buscar = o.buscar ?? buscarPadrao;
  try {
    const res = await buscar(url, { signal: AbortSignal.timeout(o.timeoutMs ?? 20_000), redirect });
    if (redirect === 'manual' && res.status >= 300 && res.status < 400) return { res, corpo: null };
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ErroMidia(`http_${res.status}`);
    }
    const corpo = await lerCorpo(res, teto);
    if (!corpo.length) throw new ErroMidia('vazio');
    return { res, corpo };
  } catch (e) {
    throw erroDeRede(e);
  }
}

/**
 * Baixa do CDN do WhatsApp e devolve o arquivo EM CLARO, já verificado.
 * Tenta a `url` e, se falhar, `https://mmg.whatsapp.net` + `directPath`.
 * Redirecionamento é erro (o CDN não redireciona; seguir seria abrir SSRF).
 */
export async function baixarMidiaWhatsApp(c: CriptoMidia, o: OpcoesDownload = {}): Promise<Buffer> {
  const teto = o.tetoBytes ?? TETO_MIDIA_BYTES;
  if (c.fileLength !== null && c.fileLength > teto) throw new ErroMidia('grande_demais');
  const candidatas = [urlWhatsAppSegura(c.url), urlDoDirectPath(c.directPath)].filter((u, i, todas): u is string => !!u && todas.indexOf(u) === i);
  if (!candidatas.length) throw new ErroMidia(c.url || c.directPath ? 'origem_recusada' : 'sem_dados_de_download');
  let ultimo: ErroMidia = new ErroMidia('rede');
  for (const url of candidatas) {
    try {
      // Cifrado = claro + preenchimento do AES (até 16) + MAC (10).
      const { corpo } = await baixarBytes(url, 'error', teto + 26, o);
      const claro = decifrarMidiaWhatsApp(corpo!, c);
      if (claro.length > teto) throw new ErroMidia('grande_demais');
      return claro;
    } catch (e) {
      ultimo = erroDeRede(e);
      if (ultimo.motivo === 'grande_demais' || ultimo.motivo === 'chave_invalida') throw ultimo;
    }
  }
  throw ultimo;
}

/**
 * Mídia por URL https comum (API oficial: o arquivo já vem em claro).
 * Redirecionamento é seguido À MÃO, no máximo 3 saltos, cada destino passando
 * de novo pela guarda — nunca se segue um redirect para endereço interno.
 */
export async function baixarMidiaAberta(urlInicial: string, o: OpcoesDownload = {}): Promise<Buffer> {
  const teto = o.tetoBytes ?? TETO_MIDIA_BYTES;
  let url = urlPublicaSegura(urlInicial);
  for (let salto = 0; salto <= 3; salto++) {
    if (!url) throw new ErroMidia('origem_recusada');
    const { res, corpo } = await baixarBytes(url, 'manual', teto, o);
    if (corpo) return corpo;
    const destino = res.headers.get('location');
    await res.body?.cancel().catch(() => undefined);
    let proxima: string | null = null;
    try {
      proxima = destino ? new URL(destino, url).toString() : null;
    } catch {
      proxima = null;
    }
    url = urlPublicaSegura(proxima);
  }
  throw new ErroMidia('origem_recusada');
}
