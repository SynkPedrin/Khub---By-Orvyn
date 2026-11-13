import { digitosDaBusca, filtroDaQuery, orderByDaOrdem, parseFiltro, parseOrdem, whereDoFiltro } from './contatos-filtro';

const U = '7c1e6a52-3f0b-4c1a-9d3e-2b8f4a6c9e01';

describe('contatos-filtro (Q2.2 — contrato único de filtro)', () => {
  it('query string: chaves conhecidas, cf_<chave> e o resto ignorado', () => {
    const f = filtroDaQuery({ q: 'ana', tag: 'vip', cf_plano: 'ouro', cursor: 'x', limit: '25', _t: '123', naoPerturbe: 'sim' });
    expect(f).toEqual({ q: 'ana', tag: 'vip', naoPerturbe: 'sim', cf: { plano: 'ouro' } });
  });

  it('valor vazio é ausente, valor inválido é 400', () => {
    expect(filtroDaQuery({ tag: '', ownerId: '' })).toEqual({});
    expect(() => filtroDaQuery({ ownerId: 'nao-e-uuid' })).toThrow(/filtro inválido/);
    expect(() => filtroDaQuery({ criadoDe: '10/11/2026' })).toThrow(/filtro inválido/);
    expect(() => parseFiltro({ desconhecido: 1 })).toThrow(/filtro inválido/);
    expect(() => parseFiltro({ criadoDe: '2026-11-10', criadoAte: '2026-11-01' })).toThrow(/depois/);
  });

  it('where: cada filtro vira condição no AND (sem SQL cru)', () => {
    const w = whereDoFiltro({ stageId: U, ownerId: 'nenhum', naoPerturbe: 'nao', tag: 'vip', origem: 'Meta' });
    const and = (w.AND as object[]).map((c) => JSON.stringify(c));
    expect(and).toContain(JSON.stringify({ deals: { some: { stageId: U, status: 'aberto' } } }));
    expect(and).toContain(JSON.stringify({ ownerId: null }));
    expect(and).toContain(JSON.stringify({ optedOutAt: null }));
    expect(and.some((c) => c.includes('"has":"vip"'))).toBe(true);
    expect(and.some((c) => c.includes('lead_origem'))).toBe(true);
    expect(whereDoFiltro({})).toEqual({});
  });

  it('datas: dia inteiro em Brasília (UTC-3)', () => {
    const w = whereDoFiltro({ criadoDe: '2026-11-01', criadoAte: '2026-11-01' });
    const [de, ate] = w.AND as { createdAt: { gte?: Date; lt?: Date } }[];
    expect(de.createdAt.gte!.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(ate.createdAt.lt!.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });

  it('busca por telefone normalizado só quando o termo tem cara de telefone', () => {
    expect(digitosDaBusca('(11) 97777-1234')).toBe('11977771234');
    expect(digitosDaBusca('ana 1234')).toBeNull();
    expect(digitosDaBusca('123')).toBeNull();
    const w = whereDoFiltro({ q: '97777' }, [U]);
    expect(JSON.stringify(w)).toContain(`"in":["${U}"]`);
  });

  it('cf: sem definições, igualdade textual; com definições (Q2.3), usa as condições tipadas', () => {
    expect(JSON.stringify(whereDoFiltro({ cf: { plano: 'ouro' } }))).toContain('"path":["plano"]');
    const tipada = whereDoFiltro({ cf: { idade_min: '18' } }, [], [{ camposCustom: { path: ['idade'], gte: 18 } }]);
    expect(JSON.stringify(tipada)).toContain('"gte":18');
    expect(JSON.stringify(tipada)).not.toContain('idade_min');
  });

  it('ordenação sempre com id de desempate (keyset estável) e só colunas NOT NULL', () => {
    for (const o of ['recentes', 'antigos', 'nome_az', 'nome_za', 'valor_desc', 'atualizados'] as const) {
      const ob = orderByDaOrdem(o);
      expect(Object.keys(ob[ob.length - 1])).toEqual(['id']);
    }
    expect(parseOrdem(undefined)).toBe('recentes');
    expect(() => parseOrdem('score')).toThrow(/ordem inválida/);
  });
});
