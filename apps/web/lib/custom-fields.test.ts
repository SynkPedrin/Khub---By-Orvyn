import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { agrupar, checarValor, errosDosCampos, formatarValor, paraApi, paraFormulario, type CampoDef } from './custom-fields';

const def = (tipo: CampoDef['tipo'], extra: Partial<CampoDef> = {}): CampoDef => ({
  id: tipo, entidade: 'contact', chave: tipo, rotulo: tipo, tipo, opcoes: [], obrigatorio: false, ordem: 0, grupo: null, arquivado: false, arquivadoEm: null, ...extra,
});

describe('custom-fields (web)', () => {
  it('formata valores no padrão brasileiro', () => {
    expect(formatarValor(def('money'), 1234.5)).toBe('R$ 1.234,50');
    expect(formatarValor(def('date'), '2026-02-28')).toBe('28/02/2026');
    expect(formatarValor(def('boolean'), false)).toBe('Não');
    expect(formatarValor(def('multiselect'), ['A', 'B'])).toBe('A, B');
    expect(formatarValor(def('text'), null)).toBe('');
  });

  it('formulário ida e volta: vazio vira null (limpar), número aceita vírgula', () => {
    expect(paraApi(def('number'), '10,5')).toBe(10.5);
    expect(paraApi(def('text'), '   ')).toBeNull();
    expect(paraApi(def('multiselect'), [])).toBeNull();
    expect(paraApi(def('boolean'), true)).toBe(true);
    expect(paraFormulario(def('multiselect'), 'lixo')).toEqual([]);
  });

  it('checagem rápida: obrigatório, número e e-mail', () => {
    expect(checarValor(def('text', { obrigatorio: true }), '')).toBe('Campo obrigatório');
    expect(checarValor(def('number'), 'abc')).toBe('Informe um número');
    expect(checarValor(def('email'), 'ana@')).toBe('E-mail inválido');
    expect(checarValor(def('email'), '')).toBeNull();
  });

  it('lê os erros por campo da extensão `campos` do RFC 7807', () => {
    const e = new ApiError(400, { title: 'Campos personalizados inválidos', campos: [{ chave: 'idade', rotulo: 'Idade', erro: 'esperado número' }] });
    expect(errosDosCampos(e)).toEqual({ idade: 'esperado número' });
    expect(errosDosCampos(new Error('x'))).toEqual({});
  });

  it('agrupa mantendo a ordem, sem grupo primeiro', () => {
    const g = agrupar([def('text', { id: '1', grupo: 'Clínico' }), def('date', { id: '2' }), def('url', { id: '3', grupo: 'Clínico' })]);
    expect(g.map((x) => [x.grupo, x.campos.map((c) => c.id)])).toEqual([[null, ['2']], ['Clínico', ['1', '3']]]);
  });
});
