/**
 * Leitor mínimo de .xlsx (primeira planilha) sem dependência externa.
 *
 * Um .xlsx é um ZIP de XMLs. Lemos o diretório central do ZIP, inflamos as
 * entradas com `DecompressionStream('deflate-raw')` (nativo do navegador) e
 * extraímos: textos compartilhados (inclusive rich text), texto inline,
 * números, booleanos e fórmulas com valor em cache. Células de data (pelo
 * formato numérico do estilo) viram "dd/mm/aaaa", "dd/mm/aaaa hh:mm" ou
 * "hh:mm", como a pessoa vê no Excel. Células vazias no meio da linha viram ''.
 *
 * Fora do escopo: .xls binário antigo (o chamador pede para salvar como .xlsx
 * ou CSV), fórmulas sem valor em cache e planilhas protegidas por senha.
 */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

interface EntradaZip { nome: string; metodo: number; tamanho: number; offsetLocal: number }

export class XlsxInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'XlsxInvalido';
  }
}

function diretorioCentral(b: Uint8Array): Map<string, EntradaZip> {
  // End Of Central Directory: assinatura 0x06054b50, nos últimos 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxInvalido('o arquivo não é um .xlsx válido');
  const total = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const nomes = new TextDecoder('utf-8');
  const entradas = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new XlsxInvalido('diretório do .xlsx corrompido');
    const metodo = u16(b, p + 10);
    const tamanho = u32(b, p + 20);
    const lenNome = u16(b, p + 28);
    const lenExtra = u16(b, p + 30);
    const lenComentario = u16(b, p + 32);
    const offsetLocal = u32(b, p + 42);
    const nome = nomes.decode(b.subarray(p + 46, p + 46 + lenNome));
    entradas.set(nome, { nome, metodo, tamanho, offsetLocal });
    p += 46 + lenNome + lenExtra + lenComentario;
  }
  return entradas;
}

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const escrita = writer.write(dados).then(() => writer.close());
  const reader = ds.readable.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    partes.push(value);
    total += value.length;
  }
  await escrita;
  const out = new Uint8Array(total);
  let o = 0;
  for (const parte of partes) { out.set(parte, o); o += parte.length; }
  return out;
}

async function lerEntrada(b: Uint8Array, e: EntradaZip): Promise<string> {
  const p = e.offsetLocal;
  if (u32(b, p) !== 0x04034b50) throw new XlsxInvalido(`entrada ${e.nome} corrompida`);
  const inicio = p + 30 + u16(b, p + 26) + u16(b, p + 28);
  const bruto = b.subarray(inicio, inicio + e.tamanho);
  let dados: Uint8Array;
  if (e.metodo === 0) dados = bruto;
  else if (e.metodo === 8) dados = await inflar(bruto);
  else throw new XlsxInvalido('compressão do .xlsx não suportada');
  return new TextDecoder('utf-8').decode(dados);
}

/** &amp; &lt; &#233; &#xE9; → caracteres. */
export function desescaparXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, ent: string) => {
    const e = ent.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const cp = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
  });
}

function atributos(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = desescaparXml(m[2]);
  return out;
}

/** Texto de um <si> ou <is>: junta todos os <t>, ignora a guia fonética <rPh>. */
function textoRico(xml: string): string {
  const semFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let s = '';
  for (const m of semFonetica.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) s += desescaparXml(m[1] ?? '');
  return s;
}

/** "C5" → 2 (índice de coluna base 0). */
export function colunaDaRef(ref: string): number {
  const letras = /^([A-Z]+)/i.exec(ref)?.[1]?.toUpperCase() ?? '';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

const FORMATOS_DATA_EMBUTIDOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Formato numérico de data/hora? (ignora o que está entre aspas e colchetes de cor). */
function formatoEhData(codigo: string): boolean {
  const limpo = codigo.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(limpo) && !/[0#?]/.test(limpo.replace(/[dmyhs]/gi, ''));
}

type TipoData = 'data' | 'hora' | 'dataHora';

function estilosDeData(stylesXml: string | null): Map<number, 'hora' | 'data'> {
  const out = new Map<number, 'hora' | 'data'>();
  if (!stylesXml) return out;
  const personalizados = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = atributos(m[1]);
    personalizados.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(atributos(m[1]).numFmtId ?? 0);
    const codigo = personalizados.get(id);
    const ehData = codigo !== undefined ? formatoEhData(codigo) : FORMATOS_DATA_EMBUTIDOS.has(id);
    if (ehData) {
      const soHora = codigo !== undefined ? !/[dy]/i.test(codigo.replace(/"[^"]*"/g, '')) : [18, 19, 20, 21, 45, 46, 47].includes(id);
      out.set(i, soHora ? 'hora' : 'data');
    }
    i++;
  }
  return out;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** Número serial do Excel → texto no formato brasileiro. */
export function serialParaTexto(serial: number, tipo: TipoData, base1904 = false): string {
  const dias = Math.floor(serial);
  const minutos = Math.round((serial - dias) * 1440);
  const epoca = base1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoca + dias * 86_400_000 + minutos * 60_000);
  const data = `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const hora = `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
  if (tipo === 'hora') return hora;
  if (tipo === 'data') return data;
  return `${data} ${hora}`;
}

function resolverAlvo(alvo: string): string {
  if (alvo.startsWith('/')) return alvo.slice(1);
  const partes = `xl/${alvo}`.split('/');
  const pilha: string[] = [];
  for (const p of partes) {
    if (p === '..') pilha.pop();
    else if (p !== '.' && p !== '') pilha.push(p);
  }
  return pilha.join('/');
}

/** Primeira planilha do .xlsx como matriz de textos (linhas vazias descartadas). */
export async function lerXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const b = new Uint8Array(buf);
  if (b.length < 4 || u32(b, 0) !== 0x04034b50) throw new XlsxInvalido('o arquivo não é um .xlsx válido');
  const zip = diretorioCentral(b);
  const ler = async (nome: string) => {
    const e = zip.get(nome);
    return e ? lerEntrada(b, e) : null;
  };

  const workbook = await ler('xl/workbook.xml');
  if (!workbook) throw new XlsxInvalido('o arquivo não tem planilha (xl/workbook.xml ausente)');
  const base1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const primeira = /<sheet\b([^>]*)\/?>/.exec(workbook);
  let caminho = 'xl/worksheets/sheet1.xml';
  if (primeira) {
    const rid = atributos(primeira[1])['r:id'];
    const rels = await ler('xl/_rels/workbook.xml.rels');
    if (rid && rels) {
      for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const a = atributos(m[1]);
        if (a.Id === rid && a.Target) caminho = resolverAlvo(a.Target);
      }
    }
  }
  const planilha = await ler(caminho);
  if (!planilha) throw new XlsxInvalido('não achei a primeira planilha dentro do .xlsx');

  const compartilhadosXml = await ler('xl/sharedStrings.xml');
  const compartilhados = compartilhadosXml ? [...compartilhadosXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => textoRico(m[1] ?? '')) : [];
  const datas = estilosDeData(await ler('xl/styles.xml'));

  const linhas: string[][] = [];
  let proximaLinha = 0;
  for (const mr of planilha.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(atributos(mr[1]).r);
    const iLinha = Number.isInteger(r) && r > 0 ? r - 1 : proximaLinha;
    proximaLinha = iLinha + 1;
    const celulas: string[] = [];
    let proximaColuna = 0;
    for (const mc of (mr[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = atributos(mc[1]);
      const col = a.r ? colunaDaRef(a.r) : proximaColuna;
      proximaColuna = col + 1;
      const corpo = mc[2] ?? '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let texto = '';
      if (a.t === 's') texto = v !== undefined ? (compartilhados[Number(v)] ?? '') : '';
      else if (a.t === 'inlineStr') texto = textoRico(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(corpo)?.[1] ?? '');
      else if (a.t === 'b') texto = v === '1' ? 'VERDADEIRO' : v === '0' ? 'FALSO' : '';
      else if (a.t === 'str' || a.t === 'e' || a.t === 'd') texto = desescaparXml(v ?? '');
      else if (v !== undefined) {
        const n = Number(v);
        const tipo = a.s !== undefined ? datas.get(Number(a.s)) : undefined;
        if (tipo && Number.isFinite(n)) {
          texto = serialParaTexto(n, tipo === 'hora' ? 'hora' : n % 1 === 0 ? 'data' : 'dataHora', base1904);
        } else texto = v;
      }
      while (celulas.length < col) celulas.push('');
      celulas[col] = texto;
    }
    while (linhas.length < iLinha) linhas.push([]);
    linhas[iLinha] = celulas;
  }

  const largura = Math.max(0, ...linhas.map((l) => l.length));
  return linhas
    .filter((l) => l.some((v) => v.trim() !== ''))
    .map((l) => [...l, ...Array<string>(largura - l.length).fill('')]);
}
