import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import {
  MAX_ITENS_GRUPO,
  MIN_ITENS_GRUPO,
  deltaReagendamento,
  detalheChoque,
  erroDasLinhas,
  fimDaLinha,
  montarItensGrupo,
  sugerirInicioEncadeado,
  type LinhaGrupo,
} from './agenda-grupo';

const linha = (over: Partial<LinhaGrupo> = {}): LinhaGrupo => ({
  servicoId: 'sv1',
  profissionalId: 'pf1',
  inicio: new Date(2026, 10, 24, 14, 0, 0, 0),
  duracaoMin: 60,
  valorCentavos: null,
  ...over,
});

describe('fimDaLinha (fim derivado = início + duração)', () => {
  it('soma a duração em minutos ao início', () => {
    const fim = fimDaLinha(linha({ duracaoMin: 90 }));
    expect(fim?.getHours()).toBe(15);
    expect(fim?.getMinutes()).toBe(30);
  });

  it.each<[string, Partial<LinhaGrupo>]>([
    ['sem início', { inicio: null }],
    ['início inválido', { inicio: new Date('não é data') }],
    ['duração zero', { duracaoMin: 0 }],
    ['duração negativa', { duracaoMin: -30 }],
  ])('incompleta (%s) → null', (_, over) => {
    expect(fimDaLinha(linha(over))).toBeNull();
  });
});

describe('sugerirInicioEncadeado', () => {
  it('sugere o fim da última linha para a próxima', () => {
    const sugestao = sugerirInicioEncadeado([linha({ duracaoMin: 45 })]);
    expect(sugestao?.getHours()).toBe(14);
    expect(sugestao?.getMinutes()).toBe(45);
  });

  it('usa a última linha válida quando a do meio está incompleta', () => {
    const sugestao = sugerirInicioEncadeado([linha({ duracaoMin: 60 }), linha({ inicio: null })]);
    expect(sugestao?.getHours()).toBe(15);
    expect(sugestao?.getMinutes()).toBe(0);
  });

  it('sem nenhuma linha com início → null', () => {
    expect(sugerirInicioEncadeado([])).toBeNull();
    expect(sugerirInicioEncadeado([linha({ inicio: null })])).toBeNull();
  });
});

describe('erroDasLinhas', () => {
  it('duas linhas completas passam', () => {
    expect(erroDasLinhas([linha(), linha({ servicoId: 'sv2' })])).toBeNull();
  });

  it(`menos de ${MIN_ITENS_GRUPO} serviços não forma grupo`, () => {
    expect(erroDasLinhas([linha()])).toMatch(/pelo menos/);
  });

  it(`mais de ${MAX_ITENS_GRUPO} serviços é recusado antes de chamar a API`, () => {
    expect(erroDasLinhas(Array.from({ length: MAX_ITENS_GRUPO + 1 }, () => linha()))).toMatch(/no máximo/);
  });

  it('aponta a linha sem serviço ou profissional', () => {
    expect(erroDasLinhas([linha(), linha({ servicoId: '' })])).toBe('Escolha o serviço e a profissional no serviço 2.');
    expect(erroDasLinhas([linha({ profissionalId: '' }), linha()])).toBe('Escolha o serviço e a profissional no serviço 1.');
  });

  it('aponta a linha com data/duração inválida', () => {
    expect(erroDasLinhas([linha(), linha({ duracaoMin: 0 })])).toBe('Data, horário ou duração inválidos no serviço 2.');
  });
});

describe('montarItensGrupo', () => {
  it('gera início/fim em ISO com o fim derivado da duração', () => {
    const [item] = montarItensGrupo([linha({ duracaoMin: 30 })]);
    expect(item.inicio).toBe(new Date(2026, 10, 24, 14, 0).toISOString());
    expect(item.fim).toBe(new Date(2026, 10, 24, 14, 30).toISOString());
    expect(item.servicoId).toBe('sv1');
    expect(item.profissionalId).toBe('pf1');
  });

  it('valor só vai quando é maior que zero', () => {
    const [semValor] = montarItensGrupo([linha({ valorCentavos: null })]);
    const [zero] = montarItensGrupo([linha({ valorCentavos: 0 })]);
    const [comValor] = montarItensGrupo([linha({ valorCentavos: 12000 })]);
    expect(semValor).not.toHaveProperty('valorCentavos');
    expect(zero).not.toHaveProperty('valorCentavos');
    expect(comValor.valorCentavos).toBe(12000);
  });

  it('título vai aparado e some quando vazio', () => {
    const [com] = montarItensGrupo([linha({ titulo: '  Corte + barba  ' })]);
    const [sem] = montarItensGrupo([linha({ titulo: '   ' })]);
    expect(com.titulo).toBe('Corte + barba');
    expect(sem).not.toHaveProperty('titulo');
  });
});

describe('deltaReagendamento', () => {
  const atual = new Date(2026, 10, 24, 14, 0).toISOString();

  it('diferença entre o novo início e o início atual do primeiro item', () => {
    expect(deltaReagendamento(atual, new Date(2026, 10, 25, 9, 30))).toBe(19 * 60 + 30);
    expect(deltaReagendamento(atual, new Date(2026, 10, 24, 13, 0))).toBe(-60);
  });

  it('mesmo horário → delta zero', () => {
    expect(deltaReagendamento(atual, new Date(2026, 10, 24, 14, 0))).toBe(0);
  });
});

describe('detalheChoque (409 do grupo mostra a mensagem da API)', () => {
  it('repassa o title da API com pontuação', () => {
    const e = new ApiError(409, { title: 'Maria já tem atendimento das 14h às 15h' });
    expect(detalheChoque(e)).toBe('Maria já tem atendimento das 14h às 15h.');
  });

  it('aceita detail/message e não duplica pontuação final', () => {
    expect(detalheChoque(new ApiError(409, { detail: 'Horário ocupado.' }))).toBe('Horário ocupado.');
    expect(detalheChoque(new ApiError(409, { message: 'Conflito na agenda do João' }))).toBe('Conflito na agenda do João.');
  });

  it('409 sem mensagem útil cai no texto padrão de choque', () => {
    expect(detalheChoque(new ApiError(409, {}))).toMatch(/choca com outro atendimento/);
  });

  it('outros erros → null (o chamador usa o mensagemErro de sempre)', () => {
    expect(detalheChoque(new ApiError(500, { title: 'boom' }))).toBeNull();
    expect(detalheChoque(new Error('rede'))).toBeNull();
  });
});
