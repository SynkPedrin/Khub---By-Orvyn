import { avaliarCriativo, baseDeMercado, simular, REFERENCIA, type CriativoSim, type EntradaSimulacao } from './ads-simulator.engine';

const forte: CriativoSim = {
  nome: 'A',
  formato: 'video',
  hook: 'Você ainda sente dor ao sorrir? Veja como resolver em 1 consulta',
  copy: 'Mais de 1.200 pacientes atendidos em Araçatuba.\n\nAvaliação completa e plano sem surpresa no preço.\n\nRestam 8 vagas esta semana: chame no WhatsApp e agende.',
  titulo: 'Avaliação odontológica',
  cta: 'enviar_mensagem',
  videoSegundos: 15,
  legendas: true,
  rosto: true,
};
const fraco: CriativoSim = {
  nome: 'B',
  formato: 'imagem',
  hook: 'CONHEÇA A NOSSA EMPRESA!!!',
  copy: 'Somos uma empresa.',
  titulo: '',
  cta: 'comprar',
  textoNaImagem: 'muito',
};
const entrada = (over: Partial<EntradaSimulacao> = {}): EntradaSimulacao => ({
  objetivo: 'mensagens',
  orcamentoDia: 50,
  dias: 14,
  publico: 300_000,
  posicionamento: 'automatico',
  ticketMedio: 400,
  taxaFechamento: 20,
  criativos: [forte],
  ...over,
});

describe('simulador de campanhas — nota do criativo', () => {
  it('criativo forte pontua bem acima do fraco, com motivos explicados', () => {
    const a = avaliarCriativo(forte, 'mensagens', 'automatico');
    const b = avaliarCriativo(fraco, 'mensagens', 'automatico');
    expect(a.geral).toBeGreaterThan(70);
    expect(b.geral).toBeLessThan(45);
    expect(b.hook.motivos.some((m) => !m.ok && /empresa/.test(m.texto))).toBe(true);
    expect(b.cta.motivos[0].texto).toMatch(/Enviar mensagem/);
  });

  it('detecta risco de reprovação na política da Meta', () => {
    const n = avaliarCriativo({ ...forte, copy: 'Você é gordo? Resultado garantido em 10 dias.' }, 'leads', 'feed');
    expect(n.riscoReprovacao).toBe(true);
    expect(n.copy.motivos.filter((m) => !m.ok).map((m) => m.texto).join(' ')).toMatch(/atributo pessoal/);
  });

  it('vídeo longo sem legenda perde nota de criativo', () => {
    const curto = avaliarCriativo(forte, 'mensagens', 'stories_reels').criativo.nota;
    const longo = avaliarCriativo({ ...forte, videoSegundos: 90, legendas: false }, 'mensagens', 'stories_reels').criativo.nota;
    expect(longo).toBeLessThan(curto - 20);
  });
});

describe('simulador de campanhas — projeção', () => {
  it('é determinístico: mesma entrada, mesmo resultado', () => {
    expect(simular(entrada())).toEqual(simular(entrada()));
  });

  it('gasta exatamente a verba e entrega faixa ordenada p10 ≤ p50 ≤ p90', () => {
    const r = simular(entrada());
    expect(r.total.investimento).toBe(50 * 14);
    expect(r.serie).toHaveLength(14);
    expect(r.total.resultados.p10).toBeLessThanOrEqual(r.total.resultados.p50);
    expect(r.total.resultados.p50).toBeLessThanOrEqual(r.total.resultados.p90);
    expect(r.total.resultados.p50).toBeGreaterThan(0);
    expect(r.total.receita).not.toBeNull();
  });

  it('números na ordem de grandeza de mercado (mensagens, R$ 50/dia)', () => {
    const r = simular(entrada());
    // Referência: CPM ~R$ 20, custo por conversa entre ~R$ 2 e ~R$ 40.
    expect(r.total.cpm).toBeGreaterThan(8);
    expect(r.total.cpm).toBeLessThan(45);
    expect(r.total.custoPorResultado.p50).toBeGreaterThan(2);
    expect(r.total.custoPorResultado.p50).toBeLessThan(40);
  });

  it('criativo melhor entrega mais com a mesma verba e vence o A/B', () => {
    const r = simular(entrada({ criativos: [forte, fraco] }));
    const [a, b] = r.criativos;
    expect(a.resultados.p50).toBeGreaterThan(b.resultados.p50 * 1.5);
    expect(a.chanceMelhor).toBeGreaterThan(0.9);
    expect(r.vencedor).toBe('A');
    expect(a.orcamentoDia).toBe(25);
  });

  it('retorno decrescente: dobrar a verba não dobra o resultado num público pequeno', () => {
    const r = simular(entrada({ publico: 20_000 }));
    const p1 = r.curvaVerba.find((p) => p.orcamentoDia === 50)!;
    const p5 = r.curvaVerba.find((p) => p.orcamentoDia === 250)!;
    expect(p5.custoPorResultado).toBeGreaterThan(p1.custoPorResultado);
    expect(r.total.frequencia).toBeGreaterThan(1);
  });

  it('verba baixa avisa aprendizado limitado', () => {
    const r = simular(entrada({ objetivo: 'conversoes', orcamentoDia: 20 }));
    expect(r.alertas.some((a) => /Aprendizado limitado/.test(a.texto))).toBe(true);
  });

  it('alcance e tráfego não inventam receita', () => {
    expect(simular(entrada({ objetivo: 'alcance' })).total.receita).toBeNull();
    expect(simular(entrada({ objetivo: 'trafego' })).total.roas).toBeNull();
  });
});

describe('simulador de campanhas — base de mercado', () => {
  it('sem histórico usa a referência', () => {
    const b = baseDeMercado('leads', null);
    expect(b.fonte).toBe('referencia');
    expect(b.cpm).toBe(REFERENCIA.leads.cpm);
  });

  it('calibra com a conta por encolhimento (mais impressões, mais peso)', () => {
    const pouco = baseDeMercado('leads', { impressoes: 5000, cliques: 150, gasto: 250, resultados: 10 });
    const muito = baseDeMercado('leads', { impressoes: 200_000, cliques: 6000, gasto: 10_000, resultados: 400 });
    expect(pouco.fonte).toBe('mista');
    expect(muito.fonte).toBe('conta');
    // CPM da conta = R$ 50; com mais impressões a base chega mais perto dele.
    expect(Math.abs(muito.cpm - 50)).toBeLessThan(Math.abs(pouco.cpm - 50));
  });

  it('premissa manual vence a calibração', () => {
    const b = baseDeMercado('leads', { impressoes: 200_000, cliques: 6000, gasto: 10_000, resultados: 400 }, { cpm: 18 });
    expect(b.cpm).toBe(18);
    expect(b.fonte).toBe('manual');
  });
});
