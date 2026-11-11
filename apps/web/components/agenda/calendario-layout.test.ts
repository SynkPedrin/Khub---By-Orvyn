import { describe, expect, it } from 'vitest';
import {
  ALTURA_HORA,
  diasDaVisao,
  eventosDoDia,
  janelaDaVisao,
  minutosDoPixel,
  moverEvento,
  navegar,
  posicionarDia,
  redimensionarEvento,
} from './calendario-layout';

const dia = new Date(2026, 10, 10); // 10/11/2026, terça (local)
const ev = (id: string, h1: number, m1: number, h2: number, m2: number, d = dia) => ({
  id,
  inicio: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h1, m1).toISOString(),
  fim: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h2, m2).toISOString(),
});

describe('posicionarDia', () => {
  it('posiciona pelo horário e pela duração', () => {
    const [b] = posicionarDia([ev('a', 9, 30, 11, 0)], dia);
    expect(b.topoMin).toBe(570);
    expect(b.alturaMin).toBe(90);
    expect([b.coluna, b.colunas]).toEqual([0, 1]);
  });

  it('sobrepostos ficam lado a lado; o que não sobrepõe usa a largura toda', () => {
    const blocos = posicionarDia([ev('a', 9, 0, 10, 0), ev('b', 9, 30, 10, 30), ev('c', 9, 45, 10, 15), ev('d', 14, 0, 15, 0)], dia);
    const por = Object.fromEntries(blocos.map((b) => [b.evento.id, b]));
    expect(por.a.colunas).toBe(3);
    expect(new Set([por.a.coluna, por.b.coluna, por.c.coluna]).size).toBe(3);
    expect([por.d.coluna, por.d.colunas]).toEqual([0, 1]);
  });

  it('coluna liberada é reaproveitada dentro do grupo', () => {
    const blocos = posicionarDia([ev('a', 9, 0, 12, 0), ev('b', 9, 0, 10, 0), ev('c', 10, 0, 11, 0)], dia);
    const por = Object.fromEntries(blocos.map((b) => [b.evento.id, b]));
    expect(por.a.colunas).toBe(2);
    expect(por.c.coluna).toBe(por.b.coluna);
  });

  it('evento que atravessa a meia-noite é recortado e marcado nos dois dias', () => {
    const noite = { id: 'n', inicio: new Date(2026, 10, 10, 23, 0).toISOString(), fim: new Date(2026, 10, 11, 1, 0).toISOString() };
    const [hoje] = posicionarDia([noite], dia);
    expect([hoje.topoMin, hoje.alturaMin, hoje.continuaDepois]).toEqual([1380, 60, true]);
    const [amanha] = posicionarDia([noite], new Date(2026, 10, 11));
    expect([amanha.topoMin, amanha.alturaMin, amanha.continuaAntes]).toEqual([0, 60, true]);
  });

  it('evento curto ganha altura mínima legível e não encobre o vizinho', () => {
    const blocos = posicionarDia([ev('a', 9, 0, 9, 5), ev('b', 9, 10, 9, 15)], dia);
    expect(blocos.every((b) => b.alturaMin >= 20)).toBe(true);
    expect(blocos[0].colunas).toBe(2);
  });
});

describe('arraste e redimensionamento', () => {
  it('mover mantém a duração e troca de dia', () => {
    const r = moverEvento(ev('a', 9, 0, 10, 0), 30, 1);
    expect(new Date(r.inicio).getHours()).toBe(9);
    expect(new Date(r.inicio).getMinutes()).toBe(30);
    expect(new Date(r.inicio).getDate()).toBe(11);
    expect(+new Date(r.fim) - +new Date(r.inicio)).toBe(3_600_000);
  });

  it('redimensionar não deixa ficar menor que 15 min', () => {
    const r = redimensionarEvento(ev('a', 9, 0, 10, 0), -120);
    expect(+new Date(r.fim) - +new Date(r.inicio)).toBe(15 * 60_000);
  });

  it('pixel vira minuto encaixado de 30 em 30 e limitado ao dia', () => {
    expect(minutosDoPixel(ALTURA_HORA * 9 + 10)).toBe(540);
    expect(minutosDoPixel(ALTURA_HORA * 9.6)).toBe(570);
    expect(minutosDoPixel(-5)).toBe(0);
    expect(minutosDoPixel(ALTURA_HORA * 30)).toBe(1410);
  });
});

describe('visões e navegação', () => {
  it('semana começa na segunda; mês tem 6 semanas; lista 30 dias', () => {
    expect(diasDaVisao('semana', dia)[0].getDay()).toBe(1);
    expect(diasDaVisao('mes', dia)).toHaveLength(42);
    expect(diasDaVisao('mes', dia)[0].getDay()).toBe(1);
    expect(diasDaVisao('lista', dia)).toHaveLength(30);
  });

  it('janela cobre do primeiro dia 00:00 ao último 23:59:59.999', () => {
    const { de, ate } = janelaDaVisao('dia', dia);
    expect(de.getHours()).toBe(0);
    expect(+ate - +de).toBe(24 * 3_600_000 - 1);
  });

  it('anterior/próximo anda um dia, uma semana ou um mês', () => {
    expect(navegar('dia', dia, 1).getDate()).toBe(11);
    expect(navegar('semana', dia, -1).getDate()).toBe(3);
    const mes = navegar('mes', new Date(2026, 0, 31), 1);
    expect([mes.getMonth(), mes.getDate()]).toEqual([1, 1]);
  });

  it('eventosDoDia ordena e inclui quem atravessa o dia', () => {
    const lista = eventosDoDia([ev('b', 15, 0, 16, 0), ev('a', 8, 0, 9, 0), ev('x', 8, 0, 9, 0, new Date(2026, 10, 12))], dia);
    expect(lista.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
