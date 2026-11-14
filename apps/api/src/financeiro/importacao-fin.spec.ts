import {
  acharMembroPorNomeOuEmail,
  calcularComissaoCentavos,
  chaveImportacao,
  dataPlanilha,
  horaPlanilha,
  percentualEmPontosBase,
  statusAgendamento,
  statusLancamento,
  tipoLancamento,
  valorEmCentavos,
} from './importacao-fin';
import { horarioDaLinha } from '../agenda/agenda.service';

describe('valorEmCentavos (dinheiro sempre em centavo inteiro)', () => {
  it.each([
    ['R$ 1.234,56', 123456],
    ['1234,5', 123450],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['1,234.56', 123456],
    ['0,01', 1],
    ['199,90', 19990],
    ['  R$  50 ', 5000],
    ['10,005', 1001], // meio para cima no centavo
    ['10,004', 1000],
    ['0.1', 10],
  ])('%s → %i', (v, c) => expect(valorEmCentavos(v)).toBe(c));

  it.each([
    ['-50,00', -5000],
    ['50,00-', -5000],
    ['(1.000,00)', -100000],
    ['R$ -12,30', -1230],
  ])('negativo contábil %s → %i', (v, c) => expect(valorEmCentavos(v)).toBe(c));

  it.each(['', 'abc', '1,234,567', '12,3.4', '99999999999999', '1.23.4,5,6', undefined, null])('inválido %p → null', (v) =>
    expect(valorEmCentavos(v)).toBeNull(),
  );

  it('nunca passa por float: 0,1 + 0,2 somados em centavos dão 30', () => {
    expect((valorEmCentavos('0,1') ?? 0) + (valorEmCentavos('0,2') ?? 0)).toBe(30);
  });
});

describe('dataPlanilha (ordem brasileira dia/mês)', () => {
  it.each([
    ['03/04/2026', '2026-04-03'],
    ['3/4/2026', '2026-04-03'],
    ['03/04/26', '2026-04-03'],
    ['03-04-2026', '2026-04-03'],
    ['03.04.2026', '2026-04-03'],
    ['13/11/2026 14:30', '2026-11-13'],
    ['2026-11-13', '2026-11-13'],
    ['2026-11-13T09:00:00', '2026-11-13'],
    ['46339', '2026-11-13'], // série do Excel
    ['46339.5', '2026-11-13'],
  ])('%s → %s', (v, d) => expect(dataPlanilha(v)).toBe(d));

  it.each(['31/02/2026', '13/13/2026', '00/01/2026', 'ontem', '', '12345', '2026-02-30'])('inválida %p → null', (v) =>
    expect(dataPlanilha(v)).toBeNull(),
  );
});

describe('horaPlanilha', () => {
  it.each([
    ['14:30', 870],
    ['9:05', 545],
    ['09:05:00', 545],
    ['14h30', 870],
    ['14h', 840],
    ['13/11/2026 14:30', 870],
    ['0.5', 720], // fração de dia do Excel
  ])('%s → %i min', (v, m) => expect(horaPlanilha(v)).toBe(m));

  it.each(['', '25:00', '12:60', '13/11/2026', 'manhã'])('sem hora válida %p → null', (v) => expect(horaPlanilha(v)).toBeNull());
});

describe('tipo e status da linha', () => {
  it('tipo pelo texto ou pelo sinal do valor', () => {
    expect(tipoLancamento('Receita', false)).toBe('entrada');
    expect(tipoLancamento('Saída', false)).toBe('saida');
    expect(tipoLancamento('DÉBITO', false)).toBe('saida');
    expect(tipoLancamento('', true)).toBe('saida');
    expect(tipoLancamento(undefined, false)).toBe('entrada');
    expect(tipoLancamento('transferência', false)).toBeNull();
  });

  it('status do lançamento', () => {
    expect(statusLancamento('')).toBe('pago');
    expect(statusLancamento('Recebido')).toBe('pago');
    expect(statusLancamento('Em aberto')).toBe('pendente');
    expect(statusLancamento('A receber')).toBe('pendente');
    expect(statusLancamento('Cancelado')).toBe('cancelado');
    expect(statusLancamento('talvez')).toBeNull();
  });

  it('status do agendamento (Avec)', () => {
    expect(statusAgendamento('')).toBe('agendado');
    expect(statusAgendamento('Finalizado')).toBe('concluido');
    expect(statusAgendamento('Atendido')).toBe('concluido');
    expect(statusAgendamento('Não compareceu')).toBe('faltou');
    expect(statusAgendamento('Desmarcado')).toBe('cancelado');
    expect(statusAgendamento('Confirmado')).toBe('confirmado');
    expect(statusAgendamento('xpto')).toBeNull();
  });
});

describe('chaveImportacao (dedupe)', () => {
  const linha = { descricao: 'Corte  Maria', valor: '50,00', data: '01/11/2026' };
  it('mesma linha (espaços/caixa diferentes) e mesma ocorrência → mesma chave', () => {
    expect(chaveImportacao(linha, 1)).toBe(chaveImportacao({ descricao: ' corte maria ', valor: '50,00', data: '01/11/2026', categoria: '' }, 1));
  });
  it('linhas idênticas no mesmo arquivo: ocorrências diferentes → chaves diferentes', () => {
    expect(chaveImportacao(linha, 1)).not.toBe(chaveImportacao(linha, 2));
  });
  it('conteúdo diferente → chave diferente; ocorrência inválida vira 1', () => {
    expect(chaveImportacao(linha, 1)).not.toBe(chaveImportacao({ ...linha, valor: '50,01' }, 1));
    expect(chaveImportacao(linha, 0)).toBe(chaveImportacao(linha, 1));
  });
});

describe('comissão: arredondamento explícito (meio para cima no centavo)', () => {
  it.each([
    [10000, 30, 3000],
    [15000, '33.33', 5000], // 4999,5 → 5000
    [12345, 10, 1235], // 1234,5 → 1235
    [12344, 10, 1234], // 1234,4 → 1234
    [1, 50, 1], // 0,5 → 1
    [1, 49, 0], // 0,49 → 0
    [9999, 100, 9999],
    [100, '12.5', 13], // 12,5 → 13
    [2_000_000_00, '99.99', 199_980_000],
  ])('base %i × %s%% = %i', (base, p, esperado) => expect(calcularComissaoCentavos(base, p)).toBe(esperado));

  it('aceita o Decimal do Prisma (toString)', () => {
    expect(calcularComissaoCentavos(15000, { toString: () => '33.33' })).toBe(5000);
  });

  it('percentual inválido ou base inválida → 0', () => {
    expect(calcularComissaoCentavos(10000, 0)).toBe(0);
    expect(calcularComissaoCentavos(10000, '100.001')).toBe(0);
    expect(calcularComissaoCentavos(10000, 101)).toBe(0);
    expect(calcularComissaoCentavos(-100, 10)).toBe(0);
    expect(calcularComissaoCentavos(10.5, 10)).toBe(0);
  });

  it('pontos-base exatos (sem float)', () => {
    expect(percentualEmPontosBase('33.33')).toBe(3333);
    expect(percentualEmPontosBase(12.5)).toBe(1250);
    expect(percentualEmPontosBase('7,5')).toBe(750);
    expect(percentualEmPontosBase('100.00')).toBe(10000);
    expect(percentualEmPontosBase(0.1 + 0.2)).toBeNull();
  });
});

describe('acharMembroPorNomeOuEmail', () => {
  const membros = [
    { identityId: 'a', nome: 'Ana Paula Souza', email: 'ana@x.com' },
    { identityId: 'b', nome: 'Bruna Lima', email: 'bruna@x.com' },
    { identityId: 'c', nome: 'Bruna Alves', email: 'balves@x.com' },
    { identityId: 'd', nome: null, email: 'semnome@x.com' },
  ];
  it('e-mail, nome completo sem acento/caixa e primeiro nome inequívoco', () => {
    expect(acharMembroPorNomeOuEmail(membros, 'ANA@X.COM')).toBe('a');
    expect(acharMembroPorNomeOuEmail(membros, 'ána paula  souza')).toBe('a');
    expect(acharMembroPorNomeOuEmail(membros, 'Ana')).toBe('a');
    expect(acharMembroPorNomeOuEmail(membros, 'semnome@x.com')).toBe('d');
  });
  it('ambíguo ou ausente → null', () => {
    expect(acharMembroPorNomeOuEmail(membros, 'Bruna')).toBeNull();
    expect(acharMembroPorNomeOuEmail(membros, 'Carla')).toBeNull();
    expect(acharMembroPorNomeOuEmail(membros, '')).toBeNull();
  });
});

describe('horarioDaLinha (agenda importada no fuso de São Paulo)', () => {
  it('data + hora separadas → instante UTC certo (UTC-3)', () => {
    const { inicio, fim, semHora } = horarioDaLinha({ data: '13/11/2026', hora: '14:30' });
    expect(inicio.toISOString()).toBe('2026-11-13T17:30:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-13T18:30:00.000Z');
    expect(semHora).toBe(false);
  });
  it('data e hora juntas + duração', () => {
    const { inicio, fim } = horarioDaLinha({ inicio: '13/11/2026 09:00', duracaoMin: '45' });
    expect(inicio.toISOString()).toBe('2026-11-13T12:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-13T12:45:00.000Z');
  });
  it('fim só com a hora usa o mesmo dia', () => {
    const { fim } = horarioDaLinha({ data: '13/11/2026', hora: '14:00', fim: '15:15' });
    expect(fim.toISOString()).toBe('2026-11-13T18:15:00.000Z');
  });
  it('sem hora → 09:00 com aviso', () => {
    const r = horarioDaLinha({ data: '13/11/2026' });
    expect(r.semHora).toBe(true);
    expect(r.inicio.toISOString()).toBe('2026-11-13T12:00:00.000Z');
  });
  it('erros legíveis', () => {
    expect(() => horarioDaLinha({ data: '31/02/2026' })).toThrow('data inválida');
    expect(() => horarioDaLinha({ data: '13/11/2026', hora: '25:00' })).toThrow('hora inválida');
    expect(() => horarioDaLinha({ data: '13/11/2026', hora: '14:00', fim: '13:00' })).toThrow('depois do início');
    expect(() => horarioDaLinha({ data: '13/11/2026', duracaoMin: 'muito' })).toThrow('duração inválida');
  });
});
