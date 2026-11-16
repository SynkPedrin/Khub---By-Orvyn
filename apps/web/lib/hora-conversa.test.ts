import { describe, expect, it } from 'vitest';
import { horaLista, horaMensagem } from './hora-conversa';

describe('hora das conversas', () => {
  const agora = new Date(2026, 10, 13, 15, 0);
  it('mensagem usa o instante, não o texto gravado pelo servidor', () => {
    const iso = new Date(2026, 10, 13, 11, 5).toISOString();
    expect(horaMensagem(iso, '14:05')).toBe('11:05');
  });
  it('sem data, cai no texto antigo', () => {
    expect(horaMensagem(null, '09:30')).toBe('09:30');
    expect(horaLista(undefined, '09:30')).toBe('09:30');
  });
  it('lista: hoje, ontem, semana e data', () => {
    expect(horaLista(new Date(2026, 10, 13, 8, 7).toISOString(), null, agora)).toBe('08:07');
    expect(horaLista(new Date(2026, 10, 12, 22, 0).toISOString(), null, agora)).toBe('Ontem');
    expect(horaLista(new Date(2026, 10, 10, 10, 0).toISOString(), null, agora)).toMatch(/^ter/);
    expect(horaLista(new Date(2026, 9, 2, 10, 0).toISOString(), null, agora)).toBe('02/10');
    expect(horaLista(new Date(2025, 9, 2, 10, 0).toISOString(), null, agora)).toBe('02/10/25');
  });
});
