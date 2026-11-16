import { describe, expect, it } from 'vitest';
import { FormatoNaoSuportado, comOcorrencia, decodificarTexto, lerPlanilha, lotes, relatorioProblemasCsv } from './importacao-planilha';

const buf = (bytes: number[]) => new Uint8Array(bytes).buffer;
const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('decodificarTexto', () => {
  it('UTF-8 com e sem BOM', () => {
    expect(decodificarTexto(utf8('descrição;valor'))).toBe('descrição;valor');
    expect(decodificarTexto(buf([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ção')]))).toBe('ção');
  });
  it('Latin-1/Windows-1252 (export do Avec) cai no fallback', () => {
    // "Serviço;Mês" em windows-1252: ç = 0xE7, ê = 0xEA
    const bytes = [0x53, 0x65, 0x72, 0x76, 0x69, 0xe7, 0x6f, 0x3b, 0x4d, 0xea, 0x73];
    expect(decodificarTexto(buf(bytes))).toBe('Serviço;Mês');
  });
});

describe('lerPlanilha', () => {
  it('CSV pt-BR com ponto e vírgula em Latin-1', async () => {
    const bytes = [...new TextEncoder().encode('Descri'), 0xe7, 0xe3, 0x6f, ...new TextEncoder().encode(';Valor\r\nCorte;50,00\r\n')];
    expect(await lerPlanilha('caixa.csv', buf(bytes))).toEqual([['Descrição', 'Valor'], ['Corte', '50,00']]);
  });
  it('.xls antigo é recusado com orientação', async () => {
    await expect(lerPlanilha('relatorio.xls', buf([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toBeInstanceOf(FormatoNaoSuportado);
  });
});

describe('lotes', () => {
  it('fatia em blocos com o índice inicial de cada um', () => {
    const r = lotes([1, 2, 3, 4, 5], 2);
    expect(r).toEqual([{ inicio: 0, itens: [1, 2] }, { inicio: 2, itens: [3, 4] }, { inicio: 4, itens: [5] }]);
    expect(lotes([], 500)).toEqual([]);
    expect(lotes(Array.from({ length: 1001 }, (_, i) => i)).map((l) => [l.inicio, l.itens.length])).toEqual([[0, 500], [500, 500], [1000, 1]]);
  });
});

describe('comOcorrencia', () => {
  it('linhas idênticas recebem 1, 2...; diferença de caixa/espaço não conta', () => {
    const r = comOcorrencia([
      { descricao: 'Corte', valor: '50,00', data: '01/11/2026' },
      { descricao: 'Escova', valor: '40,00', data: '01/11/2026' },
      { descricao: ' corte ', valor: '50,00', data: '01/11/2026' },
      { data: '01/11/2026', valor: '50,00', descricao: 'CORTE' },
    ]);
    expect(r.map((l) => l.ocorrencia)).toEqual([1, 1, 2, 3]);
  });
  it('mesmo arquivo gera as mesmas ocorrências (reimportação estável)', () => {
    const linhas = [{ a: 'x' }, { a: 'x' }, { a: 'y' }];
    expect(comOcorrencia(linhas)).toEqual(comOcorrencia(linhas));
  });
});

describe('relatorioProblemasCsv', () => {
  it('ordena por linha e escapa o motivo', () => {
    const csv = relatorioProblemasCsv([{ linha: 7, motivo: 'valor inválido: "abc"' }], [{ linha: 3, motivo: 'profissional não encontrado; sem comissão' }]);
    expect(csv.split('\r\n')).toEqual([
      'linha;tipo;motivo',
      '3;aviso;"profissional não encontrado; sem comissão"',
      '7;erro;"valor inválido: ""abc"""',
    ]);
  });
});
