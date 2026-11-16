import { describe, expect, it } from 'vitest';
import { MAX_CENTAVOS, lerPercentual, lerValor, parseValor, valorParaCampo } from './dinheiro';

describe('lerValor (centavos exatos, sem float)', () => {
  it.each([
    ['199,90', 19990],
    ['R$ 1.234,56', 123456],
    ['1234,5', 123450],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['1,234.56', 123456],
    ['  R$  0,99 ', 99],
    ['10', 1000],
    ['0,1', 10],
    ['0.29', 29],
    ['1,005', 101],
    ['1,004', 100],
  ])('%s → %i', (entrada, centavos) => {
    expect(lerValor(entrada)).toBe(centavos);
  });

  it('valores que somariam errado em float continuam exatos', () => {
    expect(lerValor('1.005,07')).toBe(100507);
    expect(lerValor('4,35')).toBe(435);
  });

  it.each(['', 'abc', '-50,00', '1,2,3', '12.34.5', '1.23,4,5', ',', 'R$'])('inválido: %s', (entrada) => {
    expect(lerValor(entrada)).toBeNull();
  });

  it('acima do limite do INTEGER do banco é inválido', () => {
    expect(lerValor('21.474.836,47')).toBe(MAX_CENTAVOS);
    expect(lerValor('21.474.836,48')).toBeNull();
  });

  it('parseValor devolve 0 para inválido e para zero', () => {
    expect(parseValor('abc')).toBe(0);
    expect(parseValor('0,00')).toBe(0);
    expect(parseValor('5')).toBe(500);
  });

  it('valorParaCampo volta ao formato digitável', () => {
    expect(valorParaCampo(123456)).toBe('1.234,56');
    expect(valorParaCampo(5)).toBe('0,05');
    expect(lerValor(valorParaCampo(987654321))).toBe(987654321);
  });
});

describe('lerPercentual', () => {
  it('aceita vírgula, ponto, % e vazio', () => {
    expect(lerPercentual('12,5')).toBe(12.5);
    expect(lerPercentual('33.33')).toBe(33.33);
    expect(lerPercentual('40%')).toBe(40);
    expect(lerPercentual('')).toBe(0);
    expect(lerPercentual('100')).toBe(100);
  });
  it('recusa fora de 0 a 100 e mais de 2 casas', () => {
    expect(lerPercentual('100,01')).toBeNull();
    expect(lerPercentual('12,345')).toBeNull();
    expect(lerPercentual('-1')).toBeNull();
    expect(lerPercentual('abc')).toBeNull();
  });
});
