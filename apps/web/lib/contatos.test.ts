import { describe, expect, it } from 'vitest';
import { contarFiltros, queryDoFiltro } from './contatos';

describe('contatos (Q2.2): filtro da lista de Leads', () => {
  it('monta a query: vazios fora, cf vira cf_<chave>, extras no fim', () => {
    const qs = queryDoFiltro({ q: 'ana', tag: 'vip', origem: '', cf: { plano: 'ouro', idade_min: '18', vazio: '' } }, { ordem: 'nome_az', cursor: undefined, limit: 50 });
    const p = new URLSearchParams(qs);
    expect(p.get('q')).toBe('ana');
    expect(p.get('tag')).toBe('vip');
    expect(p.has('origem')).toBe(false);
    expect(p.get('cf_plano')).toBe('ouro');
    expect(p.get('cf_idade_min')).toBe('18');
    expect(p.has('cf_vazio')).toBe(false);
    expect(p.has('cf')).toBe(false);
    expect(p.get('ordem')).toBe('nome_az');
    expect(p.get('limit')).toBe('50');
    expect(p.has('cursor')).toBe(false);
  });

  it('conta filtros ativos sem contar a busca; cada campo personalizado conta um', () => {
    expect(contarFiltros({})).toBe(0);
    expect(contarFiltros({ q: 'x' })).toBe(0);
    expect(contarFiltros({ tag: 'vip', naoPerturbe: 'sim', cf: { a: '1', b: '' } })).toBe(3);
  });
});
