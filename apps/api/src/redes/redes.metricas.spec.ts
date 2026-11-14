import { comEngajamento, crescimento, duracaoIso, engajamentoMedio, noPeriodo, rankear, serieAcumulada, serieDeSnapshots, somar, taxaEngajamento, variacao } from './redes.metricas';
import type { PostRede } from './redes.tipos';

const post = (id: string, m: Partial<PostRede['metricas']>, publicadoEm: string | null = '2026-11-01T10:00:00Z'): PostRede => ({
  id,
  tipo: 'imagem',
  legenda: '',
  miniatura: null,
  link: null,
  publicadoEm,
  duracaoSeg: null,
  metricas: comEngajamento({ visualizacoes: null, alcance: null, curtidas: null, comentarios: null, compartilhamentos: null, salvamentos: null, ...m }),
});

describe('taxaEngajamento', () => {
  it('usa o alcance como base quando existe', () => {
    expect(taxaEngajamento({ curtidas: 80, comentarios: 10, compartilhamentos: 5, salvamentos: 5, alcance: 1000, visualizacoes: 5000 })).toBe(10);
  });
  it('cai para visualizações sem alcance (TikTok/YouTube)', () => {
    expect(taxaEngajamento({ curtidas: 30, comentarios: 3, compartilhamentos: 0, salvamentos: null, alcance: null, visualizacoes: 1100 })).toBe(3);
  });
  it('ignora interação ausente, mas não inventa: sem nenhuma interação ou sem base devolve null', () => {
    expect(taxaEngajamento({ curtidas: null, comentarios: 4, compartilhamentos: null, salvamentos: null, alcance: 200, visualizacoes: null })).toBe(2);
    expect(taxaEngajamento({ curtidas: null, comentarios: null, compartilhamentos: null, salvamentos: null, alcance: 200, visualizacoes: null })).toBeNull();
    expect(taxaEngajamento({ curtidas: 10, comentarios: 1, compartilhamentos: null, salvamentos: null, alcance: 0, visualizacoes: null })).toBeNull();
  });
  it('arredonda em 2 casas', () => {
    expect(taxaEngajamento({ curtidas: 1, comentarios: 0, compartilhamentos: 0, salvamentos: 0, alcance: 3, visualizacoes: null })).toBe(33.33);
  });
});

describe('variacao e crescimento', () => {
  it('variação % com base real', () => {
    expect(variacao(120, 100)).toBe(20);
    expect(variacao(80, 100)).toBe(-20);
    expect(variacao(5, -10)).toBe(150);
  });
  it('sem base (null ou zero) não há variação', () => {
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(null, 10)).toBeNull();
    expect(variacao(10, undefined)).toBeNull();
  });
  it('crescimento entre o primeiro e o último dia, mesmo fora de ordem', () => {
    expect(crescimento([{ dia: '2026-11-03', valor: 130 }, { dia: '2026-11-01', valor: 100 }, { dia: '2026-11-02', valor: 110 }])).toEqual({ absoluto: 30, percentual: 30 });
  });
  it('um ponto só não é crescimento', () => {
    expect(crescimento([{ dia: '2026-11-01', valor: 100 }])).toEqual({ absoluto: null, percentual: null });
  });
});

describe('séries', () => {
  it('fotos diárias viram série ordenada sem dias vazios', () => {
    expect(serieDeSnapshots([{ dia: '2026-11-02', seguidores: 12 }, { dia: '2026-11-01', seguidores: 10 }, { dia: '2026-11-03', seguidores: null }])).toEqual([
      { dia: '2026-11-01', valor: 10 },
      { dia: '2026-11-02', valor: 12 },
    ]);
  });
  it('acumulado do YouTube termina no total atual', () => {
    const s = serieAcumulada([{ dia: '2026-11-02', ganho: 5, perda: 1 }, { dia: '2026-11-01', ganho: 10, perda: 0 }], 1000);
    expect(s).toEqual([{ dia: '2026-11-01', valor: 996 }, { dia: '2026-11-02', valor: 1000 }]);
  });
  it('sem total (inscritos escondidos) não monta curva', () => {
    expect(serieAcumulada([{ dia: '2026-11-01', ganho: 1, perda: 0 }], null)).toEqual([]);
  });
});

describe('ranking e somas', () => {
  const a = post('a', { curtidas: 50, alcance: 1000 }); // 5%
  const b = post('b', { curtidas: 50, alcance: 500 }); // 10%
  const c = post('c', { visualizacoes: 900 }); // sem engajamento, com views
  const d = post('d', {}); // sem número nenhum
  it('ordena por engajamento, depois visualizações; descarta post sem número', () => {
    expect(rankear([a, b, c, d]).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });
  it('respeita o limite', () => {
    expect(rankear([a, b, c], 1).map((p) => p.id)).toEqual(['b']);
  });
  it('soma só o que existe e devolve null quando nada existe', () => {
    expect(somar([a, b, c], 'curtidas')).toBe(100);
    expect(somar([d], 'curtidas')).toBeNull();
  });
  it('engajamento médio', () => {
    expect(engajamentoMedio([a, b, d])).toBe(7.5);
    expect(engajamentoMedio([d])).toBeNull();
  });
  it('filtra por período', () => {
    const antigo = post('x', { curtidas: 1 }, '2026-01-01T00:00:00Z');
    expect(noPeriodo([a, antigo], new Date('2026-10-15T00:00:00Z')).map((p) => p.id)).toEqual(['a']);
  });
});

describe('duracaoIso', () => {
  it.each([
    ['PT15M33S', 933],
    ['PT1H2M3S', 3723],
    ['P1DT2S', 86402],
    ['PT45S', 45],
  ])('%s = %i s', (iso, seg) => expect(duracaoIso(iso)).toBe(seg));
  it('inválida devolve null', () => {
    expect(duracaoIso('15 minutos')).toBeNull();
    expect(duracaoIso('PT')).toBeNull();
    expect(duracaoIso(null)).toBeNull();
  });
});
