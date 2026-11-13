import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * EXTRAÇÃO E LIMPEZA DE TEXTO (Knowledge Engine §7.2, passos 2–5)
 * ==============================================================
 * Converte cada tipo de fonte em Markdown limpo e estruturado — o formato que
 * o ChunkingService do RAG já entende (headings viram breadcrumb, tabelas e
 * listas não são cortadas ao meio).
 *
 * O conteúdo extraído é DADO: ele entra no prompt dentro de <documento> com
 * aviso anti-injection (invariante RAG 3). Nada aqui interpreta instruções.
 */

export const TIPOS_FONTE = ['pdf', 'docx', 'txt', 'markdown', 'csv', 'url', 'texto', 'faq', 'catalogo', 'comercial'] as const;
export type TipoFonte = (typeof TIPOS_FONTE)[number];

export const LIMITE_ARQUIVO_BYTES = 15 * 1024 * 1024;
export const LIMITE_TEXTO_CHARS = 600_000;

export class ErroExtracao extends Error {}

/** Normaliza espaços, remove caracteres de controle e linhas vazias em excesso. */
export function limparTexto(t: string): string {
  return t
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Identificação de estrutura em texto corrido (PDF/TXT): linha curta, sem
 * ponto final, seguida de parágrafo → heading; "1. ", "- ", "• " → lista.
 */
export function estruturarTexto(t: string): string {
  const linhas = limparTexto(t).split('\n');
  const out: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    const prox = (linhas[i + 1] ?? '').trim();
    const pareceTitulo =
      l.length >= 3 && l.length <= 80 && !/[.;,:]$/.test(l) && !/^[-•*\d]/.test(l) && prox.length > 40 && (/^[A-ZÀ-Ú0-9]/.test(l) || l === l.toUpperCase());
    if (pareceTitulo && !l.startsWith('#')) out.push(`## ${l.replace(/\s+/g, ' ')}`);
    else out.push(l.replace(/^[•▪●◦]\s*/, '- '));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** CSV → Markdown: cada linha vira um bloco "Coluna: valor" (bom para busca lexical e semântica). */
export function csvParaMarkdown(csv: string, titulo: string): string {
  const linhas = parseCsv(csv);
  if (!linhas.length) return '';
  const [cab, ...dados] = linhas;
  const header = cab.map((c, i) => c.trim() || `coluna_${i + 1}`);
  const blocos = dados
    .filter((r) => r.some((c) => c.trim()))
    .map((r, idx) => {
      const pares = header.map((h, i) => (r[i]?.trim() ? `- ${h}: ${r[i].trim()}` : '')).filter(Boolean);
      const nome = r[0]?.trim() || `Item ${idx + 1}`;
      return `## ${nome}\n${pares.join('\n')}`;
    });
  return `# ${titulo}\n\n${blocos.join('\n\n')}`;
}

/** Parser CSV RFC 4180 (aspas, vírgula ou ponto-e-vírgula detectado). */
export function parseCsv(csv: string): string[][] {
  const texto = csv.replace(/^﻿/, '');
  const primeira = texto.split('\n')[0] ?? '';
  const sep = (primeira.match(/;/g) ?? []).length > (primeira.match(/,/g) ?? []).length ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®' };

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** HTML → Markdown legível: descarta script/style/nav/footer; preserva títulos, listas e parágrafos. */
export function htmlParaMarkdown(html: string): { titulo: string | null; markdown: string } {
  const titulo = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let h = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n');
  const corpo = h.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? h.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? h;
  h = corpo
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(Math.min(Number(n) + 1, 6))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => `\n- ${t.replace(/<[^>]+>/g, '').trim()}`)
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  return { titulo: titulo ? limparTexto(decodificarEntidades(titulo)) : null, markdown: limparTexto(decodificarEntidades(h)) };
}

// ------------------------------------------------------------------ binários

export async function extrairPdf(buf: Buffer): Promise<string> {
  // unpdf = build serverless do pdf.js (sem canvas nem worker nativo).
  const { extractText, getDocumentProxy } = await import('unpdf');
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const paginas = Array.isArray(text) ? text : [text];
    return paginas.map((p) => limparTexto(p)).filter(Boolean).join('\n\n');
  } catch (e) {
    throw new ErroExtracao(`não foi possível ler o PDF: ${(e as Error).message.slice(0, 160)}`);
  }
}

export async function extrairDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  try {
    // convertToMarkdown preserva títulos e listas (estrutura para o chunking).
    const conv = (mammoth as unknown as { convertToMarkdown?: typeof mammoth.extractRawText }).convertToMarkdown;
    const r = conv ? await conv({ buffer: buf }) : await mammoth.extractRawText({ buffer: buf });
    return limparTexto(r.value.replace(/\\([.\-()#*_!])/g, '$1').replace(/__([^_]+)__/g, '$1'));
  } catch (e) {
    throw new ErroExtracao(`não foi possível ler o DOCX: ${(e as Error).message.slice(0, 160)}`);
  }
}

// ------------------------------------------------------------------ URL (SSRF)

function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

/** Recusa URL que aponte para rede interna (SSRF): checa o host e cada IP resolvido. */
export async function validarUrlPublica(bruta: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    throw new ErroExtracao('URL inválida');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ErroExtracao('só URLs http(s) são aceitas');
  if (u.username || u.password) throw new ErroExtracao('URL com credencial não é aceita');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new ErroExtracao('endereço interno não é permitido');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new ErroExtracao('não foi possível resolver o endereço');
  if (ips.some(ipPrivado)) throw new ErroExtracao('endereço de rede interna não é permitido');
  return u;
}

export async function baixarPagina(url: string, fetcher: typeof fetch = fetch): Promise<{ titulo: string | null; markdown: string; urlFinal: string }> {
  let atual = await validarUrlPublica(url);
  // Segue redirecionamentos manualmente para revalidar cada destino (SSRF por redirect).
  for (let saltos = 0; saltos < 4; saltos++) {
    const r = await fetcher(atual.toString(), {
      redirect: 'manual',
      headers: { 'user-agent': 'KHUB-KnowledgeBot/1.0', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      atual = await validarUrlPublica(new URL(r.headers.get('location')!, atual).toString());
      continue;
    }
    if (!r.ok) throw new ErroExtracao(`a página respondeu ${r.status}`);
    const tipo = r.headers.get('content-type') ?? '';
    if (!/text\/(html|plain|markdown)|application\/xhtml/.test(tipo)) throw new ErroExtracao(`tipo de conteúdo não suportado: ${tipo.split(';')[0] || 'desconhecido'}`);
    const tamanho = Number(r.headers.get('content-length') ?? 0);
    if (tamanho > LIMITE_ARQUIVO_BYTES) throw new ErroExtracao('página grande demais');
    const corpo = (await r.text()).slice(0, LIMITE_ARQUIVO_BYTES);
    if (/text\/html|xhtml/.test(tipo)) {
      const { titulo, markdown } = htmlParaMarkdown(corpo);
      return { titulo, markdown, urlFinal: atual.toString() };
    }
    return { titulo: null, markdown: limparTexto(corpo), urlFinal: atual.toString() };
  }
  throw new ErroExtracao('redirecionamentos demais');
}

/** Dispatcher: tipo + conteúdo → Markdown pronto para o chunking. */
export async function extrairConteudo(input: { tipo: TipoFonte; titulo: string; texto?: string; arquivo?: Buffer }): Promise<string> {
  const { tipo } = input;
  if (input.arquivo && input.arquivo.length > LIMITE_ARQUIVO_BYTES) throw new ErroExtracao('arquivo maior que 15 MB');
  let md: string;
  if (tipo === 'pdf') {
    if (!input.arquivo) throw new ErroExtracao('arquivo PDF ausente');
    if (input.arquivo.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroExtracao('o arquivo não é um PDF válido');
    md = estruturarTexto(await extrairPdf(input.arquivo));
  } else if (tipo === 'docx') {
    if (!input.arquivo) throw new ErroExtracao('arquivo DOCX ausente');
    if (input.arquivo.subarray(0, 2).toString('latin1') !== 'PK') throw new ErroExtracao('o arquivo não é um DOCX válido');
    md = await extrairDocx(input.arquivo);
  } else {
    const bruto = input.texto ?? input.arquivo?.toString('utf8') ?? '';
    if (tipo === 'csv') md = csvParaMarkdown(bruto, input.titulo);
    else if (tipo === 'txt') md = estruturarTexto(bruto);
    else md = limparTexto(bruto); // markdown, texto manual, FAQ, catálogo, comercial
  }
  if (!md.trim()) throw new ErroExtracao('nenhum texto encontrado (PDF escaneado sem OCR?)');
  if (md.length > LIMITE_TEXTO_CHARS) throw new ErroExtracao(`texto extraído excede ${LIMITE_TEXTO_CHARS.toLocaleString('pt-BR')} caracteres; divida a fonte`);
  return tipo === 'faq' && !/^#/m.test(md) ? `# ${input.titulo}\n\n${md}` : md;
}
