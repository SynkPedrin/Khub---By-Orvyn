import { diaFechado, acharProfissional, acharServico, duracaoTipica, horariosLivres, inferirExpedientes, instanteNoFuso, partesLocais, profissionaisDoServico, type AtendimentoHist } from './agenda-salao';

const SP = 'America/Sao_Paulo';
const em = (data: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return instanteNoFuso(data, h * 60 + m, SP);
};
const atend = (prof: string, data: string, ini: string, fim: string, servicoId: string | null = 's-corte'): AtendimentoHist => ({ profissionalId: prof, servicoId, inicio: em(data, ini), fim: em(data, fim) });

describe('agenda de salão: fuso', () => {
  it('converte data/hora local de São Paulo e volta', () => {
    const t = em('2026-11-18', '09:30');
    expect(new Date(t).toISOString()).toBe('2026-11-18T12:30:00.000Z');
    expect(partesLocais(t, SP)).toEqual({ data: '2026-11-18', diaSemana: 3, minutos: 570 });
  });
});

describe('agenda de salão: expediente deduzido do histórico', () => {
  // Rita: quartas 08:00–18:00 em 3 semanas; um encaixe isolado num sábado.
  const hist: AtendimentoHist[] = [
    atend('rita', '2026-10-28', '08:00', '10:00'), atend('rita', '2026-10-28', '16:00', '18:00'),
    atend('rita', '2026-11-04', '09:00', '11:00'), atend('rita', '2026-11-04', '15:00', '17:30'),
    atend('rita', '2026-11-11', '08:30', '12:00', 's-escova'), atend('rita', '2026-11-11', '14:00', '18:00'),
    atend('rita', '2026-11-07', '10:00', '11:00'),
    atend('gabi', '2026-11-05', '13:00', '19:00', 's-sobrancelha'), atend('gabi', '2026-11-12', '13:00', '20:00', 's-sobrancelha'),
  ];
  const exp = inferirExpedientes(hist, SP);

  it('quarta da Rita vira expediente; sábado isolado não', () => {
    const rita = exp.get('rita')!;
    expect(rita.get(3)).toEqual({ iniMin: 8 * 60, fimMin: 18 * 60 });
    expect(rita.has(6)).toBe(false);
  });

  it('quinta da Gabi pega o fim mais tarde (percentil 90)', () => {
    expect(exp.get('gabi')!.get(4)).toEqual({ iniMin: 13 * 60, fimMin: 20 * 60 });
  });

  it('duração típica = mediana do histórico (mínimo 3 atendimentos)', () => {
    expect(duracaoTipica(hist, 's-corte')).toBe(120);
    expect(duracaoTipica(hist, 's-sobrancelha')).toBeNull();
  });

  it('quem faz cada serviço sai do histórico', () => {
    expect([...profissionaisDoServico(hist, 's-sobrancelha')]).toEqual(['gabi']);
    expect(profissionaisDoServico(hist, 's-escova').has('rita')).toBe(true);
  });
});

describe('agenda de salão: horários livres', () => {
  const base = { data: '2026-11-18', janela: { iniMin: 8 * 60, fimMin: 12 * 60 }, fuso: SP, agora: em('2026-11-17', '10:00') };

  it('serviço inteiro cabe na janela e pula o que está ocupado', () => {
    const livres = horariosLivres({ ...base, duracaoMin: 90, ocupados: [{ inicio: em('2026-11-18', '09:00'), fim: em('2026-11-18', '10:00') }] });
    const hhmm = livres.map((t) => partesLocais(t, SP).minutos / 60);
    // 08:00 colide (até 09:30); 10:00, 10:30 cabem (até 12:00); 11:00 não cabe.
    expect(hhmm).toEqual([10, 10.5]);
  });

  it('não oferece horário em cima da hora (antecedência de 60 min)', () => {
    const livres = horariosLivres({ ...base, agora: em('2026-11-18', '08:10'), duracaoMin: 30, ocupados: [] });
    expect(partesLocais(livres[0], SP).minutos).toBe(9 * 60 + 30);
  });
});

describe('agenda de salão: nomes falados pela cliente', () => {
  const servicos = [
    { id: '1', nome: 'Design de Sobrancelha TP', duracaoMin: 30, precoCentavos: 5000 },
    { id: '2', nome: 'Design de Sobrancelha com Henna', duracaoMin: 45, precoCentavos: 7000 },
    { id: '3', nome: 'Pé', duracaoMin: 60, precoCentavos: 4000 },
    { id: '4', nome: 'Mão', duracaoMin: 45, precoCentavos: 3500 },
    { id: '5', nome: 'Coloração ou Tonalização', duracaoMin: 120, precoCentavos: 18000 },
  ];

  it('nome exato, sem acento e com palavra parcial', () => {
    expect(acharServico(servicos, 'pe').servico?.id).toBe('3');
    expect(acharServico(servicos, 'MÃO').servico?.id).toBe('4');
    expect(acharServico(servicos, 'tonalizacao').servico?.id).toBe('5');
  });

  it('variações do mesmo serviço: a mais feita no histórico, sem perguntar código interno', () => {
    const r = acharServico(servicos, 'design de sobrancelha', new Map([['2', 10], ['1', 40]]));
    expect(r.servico?.id).toBe('1');
    expect(r.variacoes).toEqual(['Design de Sobrancelha com Henna']);
  });

  it('jeito da cliente falar: pedicure, manicure, pé e mão', () => {
    const cat = [...servicos, { id: '6', nome: 'Mao e Pe', duracaoMin: 90, precoCentavos: 8000 }, { id: '7', nome: '1 esmalt pé', duracaoMin: 20, precoCentavos: 1500 }, { id: '8', nome: 'Design de Sobrancelha P', duracaoMin: 30, precoCentavos: 0 }];
    expect(acharServico(cat, 'pedicure').servico?.id).toBe('3');
    expect(acharServico(cat, 'manicure').servico?.id).toBe('4');
    expect(acharServico(cat, 'pé e mão').servico?.id).toBe('6');
    expect(acharServico(cat, 'mão e pé').servico?.id).toBe('6');
  });

  it('serviços diferentes com o termo continuam perguntando', () => {
    const cat = [{ id: 'a', nome: 'Escova', duracaoMin: 45, precoCentavos: 0 }, { id: 'b', nome: 'Corte e Escova', duracaoMin: 90, precoCentavos: 0 }];
    expect(acharServico(cat, 'escova').servico?.id).toBe('a');
    const r = acharServico([{ id: 'x', nome: 'Luzes com tonalização', duracaoMin: 180, precoCentavos: 0 }, { id: 'y', nome: 'Coloração ou Tonalização', duracaoMin: 120, precoCentavos: 0 }], 'tonalizacao');
    expect(r.servico).toBeNull();
    expect(r.candidatos.length).toBe(2);
  });

  it('profissional pelo primeiro nome', () => {
    const profs = [{ id: 'a', nome: 'Carmelita Ribeiro' }, { id: 'b', nome: 'cristina ribeiro' }, { id: 'c', nome: 'Rita' }];
    expect(acharProfissional(profs, 'carmelita')?.id).toBe('a');
    expect(acharProfissional(profs, 'Cristina')?.id).toBe('b');
    expect(acharProfissional(profs, 'Joana')).toBeNull();
  });
});

describe('agenda de salão: dia fechado (horário do agente)', () => {
  const comercial = [{ inicio: '08:00', fim: '18:00' }];
  const horario = { dias: { dom: [], seg: [], ter: comercial, qua: comercial, qui: comercial, sex: comercial, sab: [{ inicio: '08:00', fim: '12:00' }] }, feriados: ['2026-12-25'] };

  it('segunda e domingo sem faixa = fechado; terça a sábado abertos', () => {
    expect(diaFechado('2026-11-23', horario)).toBe(true); // segunda
    expect(diaFechado('2026-11-22', horario)).toBe(true); // domingo
    for (const d of ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']) expect(diaFechado(d, horario)).toBe(false);
  });

  it('feriado fecha mesmo em dia útil', () => {
    expect(diaFechado('2026-12-25', horario)).toBe(true); // sexta, feriado
  });

  it('sem horário configurado (ou dia sem chave) não fecha nada', () => {
    expect(diaFechado('2026-11-23', null)).toBe(false);
    expect(diaFechado('2026-11-23', { dias: { ter: comercial } })).toBe(false);
  });
});

