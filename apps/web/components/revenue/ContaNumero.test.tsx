import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ContaNumero, formatarParte, partesDoNumero } from './ContaNumero';

describe('ContaNumero (ADR-0034)', () => {
  afterEach(cleanup);

  it.each(['R$ 48.200', 'R$ 48,2 mil', '404', '4 min', '12,5%', '1234 leads', 'R$ 1.234.567,89'])(
    'termina exatamente no texto original: %s',
    (texto) => {
      const p = partesDoNumero(texto)!;
      expect(p).not.toBeNull();
      expect(formatarParte(p, p.alvo)).toBe(texto);
    },
  );

  it('anima só o número, preservando prefixo e sufixo', () => {
    const p = partesDoNumero('R$ 48,2 mil')!;
    expect(formatarParte(p, 0)).toBe('R$ 0,0 mil');
  });

  it('texto sem número não é animado', () => {
    expect(partesDoNumero('—')).toBeNull();
    render(<ContaNumero value="—" />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('leitor de tela recebe o valor final, não a contagem', () => {
    render(<ContaNumero value="R$ 48.200" />);
    expect(screen.getByText('R$ 48.200', { selector: '.sr-only' })).toBeTruthy();
  });
});
