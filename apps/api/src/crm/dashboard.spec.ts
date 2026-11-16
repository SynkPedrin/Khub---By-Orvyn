import {
  agruparFontes,
  construirInsights,
  deltaPct,
  diaSP,
  dividirPeriodos,
  grupoDaFonte,
  inicioDoPeriodo,
  periodoDashboard,
  serieDiaria,
  somarDias,
} from './dashboard';

describe('dashboard (regras puras)', () => {
  it('periodoDashboard valida a querystring e cai no padrão de 30d', () => {
    expect(periodoDashboard('7d')).toBe('7d');
    expect(periodoDashboard('90d')).toBe('90d');
    expect(periodoDashboard(undefined)).toBe('30d');
    expect(periodoDashboard('365d')).toBe('30d');
  });

  it('diaSP formata no fuso de São Paulo', () => {
    // 2026-11-16 01:30 UTC ainda é 15/11 em SP (UTC-3).
    expect(diaSP(new Date('2026-11-16T01:30:00Z'))).toBe('2026-11-15');
    expect(diaSP(new Date('2026-11-16T03:30:00Z'))).toBe('2026-11-16');
  });

  it('somarDias cruza mês e ano sem fuso', () => {
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('inicioDoPeriodo inclui hoje na janela', () => {
    expect(inicioDoPeriodo('2026-11-16', 7)).toBe('2026-11-10');
    expect(inicioDoPeriodo('2026-11-16', 30)).toBe('2026-10-18');
  });

  it('serieDiaria preenche zeros nos dias sem movimento', () => {
    const s = serieDiaria([{ dia: '2026-11-15', valor: 3 }], '2026-11-14', '2026-11-16');
    expect(s).toEqual([
      { dia: '2026-11-14', valor: 0 },
      { dia: '2026-11-15', valor: 3 },
      { dia: '2026-11-16', valor: 0 },
    ]);
  });

  it('deltaPct: base zero não inventa número; sinal e casa decimal corretos', () => {
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPct(135, 100)).toBe(35);
    expect(deltaPct(80, 100)).toBe(-20);
    expect(deltaPct(1, 3)).toBe(-66.7);
  });

  it('dividirPeriodos separa atual e anterior pelo dia de início', () => {
    const rows = [
      { dia: '2026-10-01', valor: 5 },
      { dia: '2026-10-18', valor: 2 },
      { dia: '2026-11-16', valor: 3 },
    ];
    expect(dividirPeriodos(rows, '2026-10-18')).toEqual({ atual: 5, anterior: 5 });
  });

  describe('grupoDaFonte', () => {
    it('atribuição gravada tem prioridade sobre o texto de origem', () => {
      expect(grupoDaFonte('meta_ads', 'Qualquer coisa')).toBe('Meta Ads');
      expect(grupoDaFonte('google_ads', null)).toBe('Google Ads');
      expect(grupoDaFonte('indicacao', null)).toBe('Indicação');
      expect(grupoDaFonte('importacao', 'Meta Ads')).toBe('Importação');
      expect(grupoDaFonte('whatsapp_direto', null)).toBe('Orgânico');
      expect(grupoDaFonte('formulario', null)).toBe('Orgânico');
      expect(grupoDaFonte('tiktok_ads', null)).toBe('Outros');
    });

    it('sem atribuição, infere pelo texto legado de origem', () => {
      expect(grupoDaFonte(null, 'Meta Lead Ads')).toBe('Meta Ads');
      expect(grupoDaFonte(null, 'google ads')).toBe('Google Ads');
      expect(grupoDaFonte(null, 'Tráfego')).toBe('Tráfego Pago');
      expect(grupoDaFonte(null, 'trafego pago')).toBe('Tráfego Pago');
      expect(grupoDaFonte(null, 'Indicação da Maria')).toBe('Indicação');
      expect(grupoDaFonte(null, 'WhatsApp')).toBe('Orgânico');
      expect(grupoDaFonte(null, 'Instagram')).toBe('Orgânico');
      expect(grupoDaFonte(null, 'Panfleto')).toBe('Outros');
      expect(grupoDaFonte(null, null)).toBe('Outros');
    });

    it('valores reais da base importada: "importacao" e "Avec" são Importação, não Outros', () => {
      expect(grupoDaFonte(null, 'importacao')).toBe('Importação');
      expect(grupoDaFonte(null, 'Avec')).toBe('Importação');
      expect(grupoDaFonte(null, 'Formulário: Contato QA')).toBe('Orgânico');
      expect(grupoDaFonte(null, 'Agendamento: Consulta QA')).toBe('Orgânico');
    });
  });

  it('agruparFontes soma por grupo, ordenado do maior para o menor', () => {
    const f = agruparFontes([
      { fonte: 'meta_ads', origem: '', total: 68 },
      { fonte: 'google_ads', origem: '', total: 18 },
      { fonte: '', origem: 'Indicação', total: 9 },
      { fonte: 'manual', origem: '', total: 5 },
    ]);
    expect(f.map((x) => [x.rotulo, x.valor, x.pct])).toEqual([
      ['Meta Ads', 68, 68],
      ['Google Ads', 18, 18],
      ['Indicação', 9, 9],
      ['Orgânico', 5, 5],
    ]);
    expect(agruparFontes([])).toEqual([]);
  });

  it('mais de 4 grupos: ficam os 4 maiores e o resto vira Outros (limite da rosca)', () => {
    const f = agruparFontes([
      { fonte: '', origem: 'importacao', total: 3310 },
      { fonte: '', origem: 'Avec', total: 3222 },
      { fonte: '', origem: 'Instagram', total: 56 },
      { fonte: '', origem: 'Meta Ads', total: 26 },
      { fonte: '', origem: 'Indicação', total: 22 },
      { fonte: '', origem: 'Google Ads', total: 21 },
      { fonte: '', origem: 'Tráfego', total: 10 },
    ]);
    expect(f.map((x) => x.rotulo)).toEqual(['Importação', 'Orgânico', 'Meta Ads', 'Indicação', 'Outros']);
    // Google Ads (21) e Tráfego Pago (10) dobraram em Outros.
    expect(f.find((x) => x.rotulo === 'Outros')!.valor).toBe(31);
    expect(f.reduce((s, x) => s + x.valor, 0)).toBe(6667);
  });

  describe('construirInsights', () => {
    const base = {
      receitaDelta: 67.2,
      receitaTotal: 278450,
      leadsMes: 142,
      leadsMesAnterior: 106,
      conversao: 11,
      conversaoBase: 'fechados' as const,
      tarefasHoje: 8,
    };

    it('monta as quatro frases do mockup com números reais', () => {
      const textos = construirInsights(base).map((i) => i.texto);
      expect(textos[0]).toContain('cresceu 67,2%');
      expect(textos[1]).toContain('142 novos leads este mês (+34%)');
      expect(textos[2]).toContain('11%');
      expect(textos[3]).toContain('8 tarefas pendentes');
    });

    it('sem base de comparação não inventa delta', () => {
      const r = construirInsights({ ...base, receitaDelta: null, leadsMesAnterior: 0 });
      expect(r.map((i) => i.texto).join(' ')).not.toContain('período anterior');
      expect(r[0].texto).toContain('142 novos leads este mês.');
    });

    it('conversão por aproximação (etapa final) não vira frase afirmativa', () => {
      const r = construirInsights({ ...base, conversaoBase: 'etapa_final' });
      expect(r.some((i) => i.texto.includes('taxa de conversão'))).toBe(false);
    });

    it('tudo zerado = nenhum insight (a tela mostra o estado vazio)', () => {
      expect(
        construirInsights({ receitaDelta: null, receitaTotal: 0, leadsMes: 0, leadsMesAnterior: 0, conversao: null, conversaoBase: null, tarefasHoje: 0 }),
      ).toEqual([]);
    });
  });
});
