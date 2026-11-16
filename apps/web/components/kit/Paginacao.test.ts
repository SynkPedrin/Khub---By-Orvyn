import { describe, expect, it } from 'vitest';
import { janelaDePaginas } from './Paginacao';

describe('janelaDePaginas', () => {
  it('poucas páginas: mostra todas', () => {
    expect(janelaDePaginas(1, 1)).toEqual([1]);
    expect(janelaDePaginas(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('muitas páginas: primeira, última e vizinhas da atual, com reticências nos buracos', () => {
    expect(janelaDePaginas(1, 20)).toEqual([1, 2, '…', 20]);
    expect(janelaDePaginas(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(janelaDePaginas(20, 20)).toEqual([1, '…', 19, 20]);
  });
  it('sem reticências quando não falta nenhuma página no meio', () => {
    expect(janelaDePaginas(2, 8)).toEqual([1, 2, 3, '…', 8]);
    expect(janelaDePaginas(7, 8)).toEqual([1, '…', 6, 7, 8]);
  });
  it('nunca repete número nem sai do intervalo', () => {
    for (let total = 1; total <= 40; total++) {
      for (let atual = 1; atual <= total; atual++) {
        const nums = janelaDePaginas(atual, total).filter((x): x is number => x !== '…');
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums.every((n) => n >= 1 && n <= total)).toBe(true);
        expect(nums).toContain(atual);
        expect(nums).toContain(1);
        expect(nums).toContain(total);
      }
    }
  });
});
