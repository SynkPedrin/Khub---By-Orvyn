import { comparar, oportunidades, parseInspecao, parseLinhas, periodos, totais, variacao, type Linha } from './search-console-analise';

describe('períodos do Search Console', () => {
  it('28 dias atuais terminando 3 dias atrás (PT) e 28 anteriores colados', () => {
    // 2026-11-13 12:00 UTC = 2026-11-13 04:00 em Los Angeles.
    const p = periodos(new Date('2026-11-13T12:00:00Z'));
    expect(p.atual).toEqual({ inicio: '2026-10-14', fim: '2026-11-10' });
    expect(p.anterior).toEqual({ inicio: '2026-09-16', fim: '2026-10-13' });
  });

  it('usa a data do Pacífico, não a UTC', () => {
    // 2026-11-13 03:00 UTC ainda é 12/11 em Los Angeles.
    expect(periodos(new Date('2026-11-13T03:00:00Z')).atual.fim).toBe('2026-11-09');
  });
});

describe('linhas e comparativo', () => {
  it('lê rows[].keys/clicks/impressions/ctr/position', () => {
    const l = parseLinhas({ rows: [{ keys: ['clinica'], clicks: 10, impressions: 200, ctr: 0.05, position: 3.2 }] });
    expect(l).toEqual([{ chave: 'clinica', cliques: 10, impressoes: 200, ctr: 0.05, posicao: 3.2 }]);
    expect(parseLinhas({})).toEqual([]);
  });

  it('total sem dados é zero; variação sem base é null', () => {
    expect(totais({})).toEqual({ cliques: 0, impressoes: 0, ctr: 0, posicao: 0 });
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(15, 10)).toBeCloseTo(50);
    const c = comparar({ cliques: 20, impressoes: 100, ctr: 0.2, posicao: 5 }, { cliques: 10, impressoes: 100, ctr: 0.1, posicao: 10 });
    expect(c.variacao).toEqual({ cliques: 100, impressoes: 0, ctr: 100, posicao: -50 });
  });
});

describe('oportunidades', () => {
  const l = (chave: string, impressoes: number, ctr: number, posicao: number): Linha => ({ chave, impressoes, ctr, posicao, cliques: Math.round(impressoes * ctr) });

  it('só posição 4 a 15, impressões acima da mediana e CTR abaixo do CTR ponderado do site', () => {
    const consultas = [
      l('topo', 1000, 0.3, 1.5), // posição boa: fora
      l('oportunidade', 2000, 0.01, 7), // entra
      l('pagina2', 950, 0.005, 14), // entra
      l('longe', 900, 0.001, 30), // posição > 15: fora
      l('ctr-bom', 900, 0.2, 6), // CTR alto: fora
      l('pouca', 5, 0, 8), // poucas impressões: fora
    ];
    const r = oportunidades(consultas);
    expect(r.itens.map((o) => o.chave)).toEqual(['oportunidade', 'pagina2']);
    expect(r.criterios.posicaoMin).toBe(4);
    expect(r.criterios.posicaoMax).toBe(15);
    expect(r.criterios.impressoesMin).toBe(925);
    expect(r.itens[0]!.cliquesPotenciais).toBeGreaterThan(r.itens[1]!.cliquesPotenciais);
  });

  it('lista vazia não quebra', () => {
    expect(oportunidades([]).itens).toEqual([]);
  });
});

describe('inspeção de URL', () => {
  it('lê indexStatusResult e richResultsResult', () => {
    const r = parseInspecao({
      inspectionResult: {
        inspectionResultLink: 'https://search.google.com/x',
        indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', lastCrawlTime: '2026-11-01T10:00:00Z', pageFetchState: 'SUCCESSFUL', googleCanonical: 'https://a.com/', userCanonical: 'https://a.com/', crawledAs: 'MOBILE', sitemap: ['https://a.com/sitemap.xml'], referringUrls: [] },
        richResultsResult: { verdict: 'FAIL', detectedItems: [{ richResultType: 'Breadcrumbs', items: [{ name: 'x', issues: [{ issueMessage: 'Falta campo', severity: 'ERROR' }] }] }] },
      },
    });
    expect(r).toMatchObject({ veredito: 'PASS', busca: 'SUCCESSFUL', rastreadoComo: 'MOBILE', sitemaps: ['https://a.com/sitemap.xml'] });
    expect(r.resultadosAvancados?.tipos[0]).toEqual({ tipo: 'Breadcrumbs', problemas: [{ mensagem: 'Falta campo', severidade: 'ERROR' }] });
    expect(parseInspecao({}).resultadosAvancados).toBeNull();
  });
});
