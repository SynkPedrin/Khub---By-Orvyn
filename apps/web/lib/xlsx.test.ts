import { describe, expect, it } from 'vitest';
import { colunaDaRef, desescaparXml, lerXlsx, serialParaTexto, XlsxInvalido } from './xlsx';

/** Comprime em deflate-raw (o mesmo formato que o Excel grava no ZIP). */
async function deflateRaw(dados: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  const fim = w.write(dados).then(() => w.close());
  const r = cs.readable.getReader();
  const partes: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    partes.push(value);
  }
  await fim;
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

/** ZIP mínimo (sem CRC: o leitor não o confere). `comprimir` usa deflate; senão, armazenado. */
async function zip(arquivos: Record<string, string>, comprimir: boolean): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locais: number[] = [];
  const central: number[] = [];
  const le16 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff);
  const le32 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  let n = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const nomeB = enc.encode(nome);
    const cru = enc.encode(conteudo);
    const dados = comprimir ? await deflateRaw(cru) : cru;
    const offset = locais.length;
    le32(locais, 0x04034b50); le16(locais, 20); le16(locais, 0); le16(locais, comprimir ? 8 : 0); le16(locais, 0); le16(locais, 0);
    le32(locais, 0); le32(locais, dados.length); le32(locais, cru.length); le16(locais, nomeB.length); le16(locais, 0);
    locais.push(...nomeB, ...dados);
    le32(central, 0x02014b50); le16(central, 20); le16(central, 20); le16(central, 0); le16(central, comprimir ? 8 : 0); le16(central, 0); le16(central, 0);
    le32(central, 0); le32(central, dados.length); le32(central, cru.length); le16(central, nomeB.length); le16(central, 0); le16(central, 0);
    le16(central, 0); le16(central, 0); le32(central, 0); le32(central, offset);
    central.push(...nomeB);
    n++;
  }
  const fim: number[] = [];
  le32(fim, 0x06054b50); le16(fim, 0); le16(fim, 0); le16(fim, n); le16(fim, n); le32(fim, central.length); le32(fim, locais.length); le16(fim, 0);
  return new Uint8Array([...locais, ...central, ...fim]).buffer;
}

const PLANILHA = {
  'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Caixa" sheetId="1" r:id="rId7"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="styles.xml" Type="x"/><Relationship Target="worksheets/dados.xml" Type="x" Id="rId7"/></Relationships>',
  'xl/sharedStrings.xml':
    '<sst count="4"><si><t>Descrição</t></si><si><t>Valor</t></si><si><r><t>Corte </t></r><r><rPr><b/></rPr><t xml:space="preserve">&amp; escova</t></r><rPh><t>fonetica</t></rPh></si><si><t>Data</t></si></sst>',
  'xl/styles.xml':
    '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>',
  'xl/worksheets/dados.xml':
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="3"><v>120.5</v></c><c r="D2" s="1"><v>46339</v></c></row>' +
    '<row r="3"/>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Produto &lt;X&gt;</t></is></c><c r="B4"><v>35</v></c><c r="C4" t="b"><v>1</v></c><c r="D4" s="2"><v>46339.375</v></c></row>' +
    '</sheetData></worksheet>',
};

describe('lerXlsx', () => {
  it.each([true, false])('textos compartilhados, rich text, inline, números, datas e lacunas (deflate=%s)', async (comprimir) => {
    const linhas = await lerXlsx(await zip(PLANILHA, comprimir));
    expect(linhas).toEqual([
      ['Descrição', 'Valor', '', 'Data'],
      ['Corte & escova', '120.5', '', '13/11/2026'],
      ['Produto <X>', '35', 'VERDADEIRO', '13/11/2026 09:00'],
    ]);
  });

  it('sem os rels, cai no caminho padrão da primeira planilha', async () => {
    const linhas = await lerXlsx(await zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="A" sheetId="1"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>a</t></is></c><c><v>1</v></c></row></sheetData></worksheet>',
    }, false));
    expect(linhas).toEqual([['a', '1']]);
  });

  it('arquivo que não é ZIP é recusado', async () => {
    await expect(lerXlsx(new TextEncoder().encode('nome;valor').buffer as ArrayBuffer)).rejects.toBeInstanceOf(XlsxInvalido);
  });
});

describe('auxiliares', () => {
  it('colunaDaRef', () => {
    expect(colunaDaRef('A1')).toBe(0);
    expect(colunaDaRef('Z9')).toBe(25);
    expect(colunaDaRef('AA10')).toBe(26);
    expect(colunaDaRef('AB2')).toBe(27);
  });
  it('desescaparXml', () => {
    expect(desescaparXml('a &amp; b &lt;c&gt; &#233; &#xE7; &quot;')).toBe('a & b <c> é ç "');
  });
  it('serialParaTexto (base 1900 e 1904, só hora)', () => {
    expect(serialParaTexto(45658, 'data')).toBe('01/01/2025');
    expect(serialParaTexto(0.75, 'hora')).toBe('18:00');
    expect(serialParaTexto(45658.5, 'dataHora')).toBe('01/01/2025 12:00');
    expect(serialParaTexto(0, 'data', true)).toBe('01/01/1904');
  });
});
