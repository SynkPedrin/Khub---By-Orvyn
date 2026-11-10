import { calcularScore, faixaDoScore, PESOS, SCORE_VERSION, type SinaisLead } from './lead-score';

const AGORA = new Date('2026-09-20T12:00:00Z');

describe('Score KHUB v0', () => {
  it('lead sem nenhum sinal não é "frio": é "sem_sinal"', () => {
    // Regra de produto: lead recém-criado não pode ser punido por ausência de
    // dado. Pintar de frio faria o vendedor despriorizar quem acabou de chegar.
    const r = calcularScore({}, AGORA);
    expect(r.score).toBe(0);
    expect(r.faixa).toBe('sem_sinal');
    expect(r.versao).toBe(SCORE_VERSION);
  });

  it('lead ideal satura em 100', () => {
    const ideal: SinaisLead = {
      mensagens30d: 30,
      tempoRespostaLeadMin: 2,
      etapaIndice: 4,
      etapaTotal: 5,
      minutosDesdeUltimaInteracao: 10,
      reuniaoRealizada: true,
      sinaisIntencao: 5,
      respondeuAlgumaVez: true,
    };
    const r = calcularScore(ideal, AGORA);
    expect(r.score).toBe(100);
    expect(r.faixa).toBe('quente');
  });

  it('é determinístico: mesmos sinais, mesmo score', () => {
    const s: SinaisLead = { mensagens30d: 6, tempoRespostaLeadMin: 30, minutosDesdeUltimaInteracao: 120 };
    expect(calcularScore(s, AGORA).score).toBe(calcularScore(s, AGORA).score);
  });

  it('nunca sai da faixa 0–100', () => {
    const absurdo: SinaisLead = {
      mensagens30d: 99999,
      tempoRespostaLeadMin: 0,
      etapaIndice: 100,
      etapaTotal: 3,
      minutosDesdeUltimaInteracao: 0,
      reuniaoRealizada: true,
      sinaisIntencao: 999,
    };
    const r = calcularScore(absurdo, AGORA);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('pesos somam 100', () => {
    const soma = Object.values(PESOS).reduce((a, b) => a + b, 0);
    expect(soma).toBe(100);
  });

  it('todo fator respeita o próprio máximo', () => {
    const r = calcularScore(
      { mensagens30d: 500, tempoRespostaLeadMin: 1, sinaisIntencao: 50, reuniaoRealizada: true },
      AGORA,
    );
    for (const f of r.fatores) {
      expect(f.pontos).toBeLessThanOrEqual(f.maximo);
      expect(f.pontos).toBeGreaterThanOrEqual(0);
    }
  });

  describe('atividade recente decai sozinha', () => {
    // O lead parado precisa PERDER score sem que nada aconteça — é isso que
    // alimenta o painel "Negócios em risco".
    const base: SinaisLead = { mensagens30d: 8, respondeuAlgumaVez: true, tempoRespostaLeadMin: 20 };

    it('hoje vale mais que há 10 dias', () => {
      const hoje = calcularScore({ ...base, minutosDesdeUltimaInteracao: 60 }, AGORA);
      const parado = calcularScore({ ...base, minutosDesdeUltimaInteracao: 60 * 24 * 10 }, AGORA);
      expect(hoje.score).toBeGreaterThan(parado.score);
    });

    it('acima de 14 dias zera o critério de recência', () => {
      const r = calcularScore({ ...base, minutosDesdeUltimaInteracao: 60 * 24 * 20 }, AGORA);
      const recencia = r.fatores.find((f) => f.chave === 'atividade_recente');
      expect(recencia?.pontos).toBe(0);
    });
  });

  describe('velocidade de resposta', () => {
    it('responder rápido pontua mais que responder devagar', () => {
      const rapido = calcularScore({ tempoRespostaLeadMin: 3 }, AGORA);
      const lento = calcularScore({ tempoRespostaLeadMin: 60 * 24 }, AGORA);
      expect(rapido.score).toBeGreaterThan(lento.score);
    });

    it('nunca ter respondido pontua 0 — e não é penalidade negativa', () => {
      const r = calcularScore({ tempoRespostaLeadMin: null }, AGORA);
      const f = r.fatores.find((x) => x.chave === 'velocidade_resposta');
      expect(f?.pontos).toBe(0);
      expect(r.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('posição no funil', () => {
    it('etapa final pontua o máximo do critério', () => {
      const r = calcularScore({ etapaIndice: 4, etapaTotal: 5 }, AGORA);
      const f = r.fatores.find((x) => x.chave === 'posicao_funil');
      expect(f?.pontos).toBe(PESOS.posicaoFunil);
    });

    it('funil de uma etapa só não pontua (não há progresso a medir)', () => {
      const r = calcularScore({ etapaIndice: 0, etapaTotal: 1 }, AGORA);
      const f = r.fatores.find((x) => x.chave === 'posicao_funil');
      expect(f?.pontos).toBe(0);
    });
  });

  describe('reunião', () => {
    it('realizada vale mais que agendada, que vale mais que nenhuma', () => {
      const nenhuma = calcularScore({}, AGORA).score;
      const agendada = calcularScore({ reuniaoAgendada: true }, AGORA).score;
      const realizada = calcularScore({ reuniaoRealizada: true }, AGORA).score;
      expect(realizada).toBeGreaterThan(agendada);
      expect(agendada).toBeGreaterThan(nenhuma);
    });
  });

  describe('faixas', () => {
    it('classifica quente / morno / frio pelos limiares', () => {
      expect(faixaDoScore(90)).toBe('quente');
      expect(faixaDoScore(75)).toBe('quente');
      expect(faixaDoScore(60)).toBe('morno');
      expect(faixaDoScore(45)).toBe('morno');
      expect(faixaDoScore(20)).toBe('frio');
    });
  });

  it('cada fator explica sua contribuição (o vendedor precisa saber o porquê)', () => {
    const r = calcularScore({ mensagens30d: 4, reuniaoAgendada: true }, AGORA);
    expect(r.fatores).toHaveLength(6);
    for (const f of r.fatores) {
      expect(f.detalhe.length).toBeGreaterThan(0);
      expect(f.rotulo.length).toBeGreaterThan(0);
    }
  });
});
