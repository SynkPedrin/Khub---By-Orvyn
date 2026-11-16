import { describe, expect, it } from 'vitest';
import { ehMesAtual, mesAtual, mesDe, navegarMes, rotuloMes } from './fin-utils';

describe('mesDe', () => {
  it('devolve o primeiro e o último dia do mês', () => {
    expect(mesDe(new Date(2026, 10, 16))).toEqual({ de: '2026-11-01', ate: '2026-11-30' });
    expect(mesDe(new Date(2026, 1, 10))).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
});

describe('navegarMes', () => {
  it('anda para trás e para frente cruzando o ano', () => {
    expect(navegarMes({ de: '2026-11-01', ate: '2026-11-30' }, -1)).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    expect(navegarMes({ de: '2026-01-01', ate: '2026-01-31' }, -1)).toEqual({ de: '2025-12-01', ate: '2025-12-31' });
    expect(navegarMes({ de: '2026-12-01', ate: '2026-12-31' }, 1)).toEqual({ de: '2027-01-01', ate: '2027-01-31' });
  });

  it('três meses atrás em um passo (o "buscar 3 meses atrás" da recepção)', () => {
    expect(navegarMes(mesAtual(), -3).de.slice(0, 7)).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('rotuloMes / ehMesAtual', () => {
  it('rótulo em português e detecção do mês corrente', () => {
    expect(rotuloMes({ de: '2026-11-01' })).toBe('novembro de 2026');
    expect(ehMesAtual(mesAtual())).toBe(true);
    expect(ehMesAtual({ de: '2020-01-01', ate: '2020-01-31' })).toBe(false);
  });
});
