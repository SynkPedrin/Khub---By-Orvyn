import { describe, expect, it } from 'vitest';
import type { FerramentaGenna } from './genna';
import { campos, formaDosDados, montarArgumentos, rotulo, textoValor, tipoDe, valoresIniciais } from './genna-formato';

const f = (parametros: FerramentaGenna['parametros']): FerramentaGenna => ({ nome: 'x', titulo: 'x', descricao: '', classe: 'leitura', parametros });

describe('genna-formato: formulário a partir do JSON Schema', () => {
  const ferr = f({
    type: 'object',
    properties: {
      limite: { type: 'integer', default: 10 },
      perfil: { type: 'string' },
      formato: { type: 'string', enum: ['carrossel', 'reels'] },
      incluir_stories: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      filtro: { type: 'object' },
    },
    required: ['perfil'],
  });

  it('tipos e ordem (obrigatórios primeiro)', () => {
    expect(campos(ferr).map((c) => c.chave)[0]).toBe('perfil');
    expect(tipoDe({ type: 'integer' })).toBe('inteiro');
    expect(tipoDe({ type: ['string', 'null'] })).toBe('texto');
    expect(tipoDe({ type: 'string', enum: ['a'] })).toBe('escolha');
    expect(tipoDe({ type: 'array', items: { type: 'object' } })).toBe('json');
  });

  it('valores iniciais usam o default', () => {
    expect(valoresIniciais(ferr)).toMatchObject({ limite: '10', perfil: '', incluir_stories: false });
  });

  it('monta argumentos com os tipos certos e omite vazios', () => {
    const r = montarArgumentos(ferr, { limite: '5', perfil: ' @cliente ', formato: 'reels', incluir_stories: false, tags: 'a, b,\nc', filtro: '{"de":"2026-11-01"}' });
    expect(r).toEqual({ ok: true, args: { perfil: '@cliente', limite: 5, formato: 'reels', tags: ['a', 'b', 'c'], filtro: { de: '2026-11-01' } } });
  });

  it('recusa obrigatório vazio, inteiro quebrado e JSON inválido', () => {
    expect(montarArgumentos(ferr, { perfil: '' })).toEqual({ ok: false, erro: 'Preencha "Perfil".' });
    expect(montarArgumentos(ferr, { perfil: 'x', limite: '2.5' })).toMatchObject({ ok: false });
    expect(montarArgumentos(ferr, { perfil: 'x', filtro: '{' })).toMatchObject({ ok: false });
  });
});

describe('genna-formato: desenho do resultado', () => {
  it('objeto com métricas e lista de posts → destaques + tabela', () => {
    const forma = formaDosDados({
      seguidores: 12000,
      alcance: { total: 50000, organico: 41000 },
      posts: [{ id: '1', formato: 'carrossel', salvamentos: 30 }, { id: '2', formato: 'reels', salvamentos: 12, extra: { a: 1 } }],
      bruto: { x: [1, 'a'] },
    });
    expect(forma.destaques).toEqual([
      { chave: 'seguidores', valor: 12000 },
      { chave: 'alcance.total', valor: 50000 },
      { chave: 'alcance.organico', valor: 41000 },
    ]);
    expect(forma.tabelas[0]).toMatchObject({ titulo: 'Posts', colunas: ['id', 'formato', 'salvamentos'] });
    expect(forma.resto).toEqual({ bruto: { x: [1, 'a'] } });
  });

  it('lista na raiz vira tabela; lista de escalares vai para o resto', () => {
    expect(formaDosDados([{ a: 1 }]).tabelas).toHaveLength(1);
    expect(formaDosDados([1, 2]).resto).toEqual([1, 2]);
    expect(formaDosDados(null)).toEqual({ destaques: [], tabelas: [], resto: null });
  });

  it('rótulos e valores em pt-BR', () => {
    expect(rotulo('follower_count')).toBe('Follower count');
    expect(rotulo('saveRate')).toBe('Save rate');
    expect(textoValor(1234567)).toBe('1.234.567');
    expect(textoValor(0.456)).toBe('0,46');
    expect(textoValor(true)).toBe('Sim');
    expect(textoValor(null)).toBe('—');
    expect(textoValor('2026-11-20')).toBe('20/11/2026');
  });
});
