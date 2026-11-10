import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AreaReceita, BarrasHorizontais } from './charts';
import { dolar, duracao } from '@/lib/format';
import { criarCsv } from '@/lib/export-csv';
afterEach(cleanup);

describe('integridade da visualização', () => {
  it('trocar uma série longa por curta não quebra o ponto selecionado', () => {
    const { rerender } = render(<AreaReceita dados={[{ rotulo: 'Jan', valor: 10 }, { rotulo: 'Fev', valor: 20 }, { rotulo: 'Mar', valor: 30 }]} />);
    fireEvent.focus(screen.getByRole('button', { name: /Mar:/ }));
    expect(() => rerender(<AreaReceita dados={[{ rotulo: 'Abr', valor: 5 }]} />)).not.toThrow();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('1 pontos');
  });
  it('tooltip, eixo e leitura acessível usam a unidade informada', () => {
    render(<AreaReceita dados={[{ rotulo: 'Hoje', valor: 3.5 }]} formatar={dolar} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('US$');
    expect(screen.queryByText(/R\$/)).toBeNull();
  });
  it('zero não desenha uma barra positiva', () => {
    render(<BarrasHorizontais dados={[{ rotulo: 'Sem vendas', valor: 0 }, { rotulo: 'Vendas', valor: 20 }]} />);
    expect(screen.getByRole('img', { name: 'Sem vendas: 0 min' }).style.width).toBe('0%');
  });
  it('formata dólar sem esconder custos abaixo de um centavo', () => {
    expect(dolar(0.0012)).toContain('0,0012');
    expect(dolar(5)).toContain('US$');
    expect(dolar(null)).toBe('-');
  });
  it('normaliza arredondamento de duração sem produzir 1h 60min', () => {
    expect(duracao(119.9)).toBe('2h');
    expect(duracao(59.9)).toBe('1h');
  });
  it('exporta CSV com aspas, separadores e fórmulas neutralizadas', () => {
    const csv = criarCsv([['Nome', 'Valor'], ['=HYPERLINK("url")', 1.5], [' +CMD', -2], ['a;b\nc', null]]);
    expect(csv).toContain('"\'=HYPERLINK(""url"")"');
    expect(csv).toContain('"\' +CMD";"-2"');
    expect(csv).toContain('"a;b\nc";""');
  });
});
