import { avaliarHorario, descreverAbertura, horarioSchema, mensagemForaDoHorario, resumoHorario } from './horario';
import { agentConfigSchema } from './agent-config';

const cfg = (o: Record<string, unknown> = {}) => horarioSchema.parse({ ativo: true, ...o });
// Datas de referência em São Paulo (UTC-3, sem horário de verão desde 2019).
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe('Horário de atendimento do agente (ADR-0042)', () => {
  it('padrão: desligado, e agente sem a seção continua 24h', () => {
    expect(agentConfigSchema.parse({}).horario.ativo).toBe(false);
    expect(avaliarHorario(horarioSchema.parse({}), sp('2026-11-10T03:00'))).toEqual({ aberto: true, proximaAbertura: null });
  });

  it('dentro da faixa: aberto; fim da faixa já é fechado', () => {
    expect(avaliarHorario(cfg(), sp('2026-11-10T08:00')).aberto).toBe(true); // terça
    expect(avaliarHorario(cfg(), sp('2026-11-10T17:59')).aberto).toBe(true);
    expect(avaliarHorario(cfg(), sp('2026-11-10T18:00')).aberto).toBe(false);
  });

  it('terça à noite abre quarta 08:00; sábado 13:00 abre segunda 08:00', () => {
    expect(avaliarHorario(cfg(), sp('2026-11-10T23:00')).proximaAbertura).toEqual(sp('2026-11-11T08:00'));
    expect(avaliarHorario(cfg(), sp('2026-11-14T13:00')).proximaAbertura).toEqual(sp('2026-11-16T08:00'));
  });

  it('madrugada abre no mesmo dia', () => {
    expect(avaliarHorario(cfg(), sp('2026-11-11T05:30')).proximaAbertura).toEqual(sp('2026-11-11T08:00'));
  });

  it('feriado pula o dia inteiro', () => {
    const c = cfg({ feriados: ['2026-11-20'] }); // sexta
    expect(avaliarHorario(c, sp('2026-11-20T10:00')).aberto).toBe(false);
    expect(avaliarHorario(c, sp('2026-11-19T19:00')).proximaAbertura).toEqual(sp('2026-11-21T08:00'));
  });

  it('almoço: duas faixas no dia', () => {
    const c = cfg({ dias: { seg: [{ inicio: '08:00', fim: '12:00' }, { inicio: '13:30', fim: '18:00' }], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] } });
    expect(avaliarHorario(c, sp('2026-11-16T12:30')).proximaAbertura).toEqual(sp('2026-11-16T13:30'));
  });

  it('sem nenhuma faixa: fechado sem próxima abertura', () => {
    const c = cfg({ dias: { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] } });
    expect(avaliarHorario(c, sp('2026-11-10T10:00'))).toEqual({ aberto: false, proximaAbertura: null });
  });

  it('outro fuso: Manaus (UTC-4)', () => {
    const c = cfg({ fuso: 'America/Manaus' });
    // 07:30 em SP = 06:30 em Manaus → abre 08:00 Manaus = 09:00 SP.
    expect(avaliarHorario(c, sp('2026-11-10T07:30')).proximaAbertura).toEqual(sp('2026-11-10T09:00'));
  });

  it('validação: faixa invertida, sobreposta ou fuso inválido são recusados', () => {
    expect(horarioSchema.safeParse({ dias: { seg: [{ inicio: '18:00', fim: '08:00' }] } }).success).toBe(false);
    expect(horarioSchema.safeParse({ dias: { seg: [{ inicio: '08:00', fim: '12:00' }, { inicio: '11:00', fim: '14:00' }] } }).success).toBe(false);
    expect(horarioSchema.safeParse({ fuso: 'Marte/Olympus' }).success).toBe(false);
  });

  it('textos: resumo agrupado e abertura relativa', () => {
    const c = cfg();
    expect(resumoHorario(c)).toBe('de segunda a sexta, das 08:00 às 18:00 e sábado, das 08:00 às 12:00');
    expect(descreverAbertura(sp('2026-11-11T08:00'), c, sp('2026-11-10T23:00'))).toBe('amanhã às 08:00');
    expect(descreverAbertura(sp('2026-11-11T08:00'), c, sp('2026-11-11T02:00'))).toBe('hoje às 08:00');
    expect(descreverAbertura(sp('2026-11-16T08:00'), c, sp('2026-11-14T13:00'))).toBe('na segunda às 08:00');
    expect(mensagemForaDoHorario(c, sp('2026-11-11T08:00'), sp('2026-11-10T23:00'))).toContain('Respondemos amanhã às 08:00.');
  });
});
