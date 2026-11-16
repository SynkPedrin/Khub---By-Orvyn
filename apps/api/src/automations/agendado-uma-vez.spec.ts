import { proximoDoNo, type CfgAgendado } from './agendador.service';
import { validarConfig } from './catalogo';

const base: CfgAgendado = { frequencia: 'uma_vez', hora: '09:30', diasSemana: [], diaMes: 1, data: '2026-11-20', alvo: 'sem_contato', tags: [] };
const SP = 'America/Sao_Paulo';

describe('gatilho agendado "uma vez" (data e hora específicas)', () => {
  it('dispara na data e hora no fuso do fluxo', () => {
    const t = proximoDoNo('gatilho.agendado', base, SP, new Date('2026-11-13T12:00:00Z'));
    expect(t?.toISOString()).toBe('2026-11-20T12:30:00.000Z'); // 09:30 em Brasília
  });

  it('depois de disparar não há próxima janela (a agenda sai)', () => {
    expect(proximoDoNo('gatilho.agendado', base, SP, new Date('2026-11-20T12:30:00Z'))).toBeNull();
  });

  it('data no passado: nada a agendar', () => {
    expect(proximoDoNo('gatilho.agendado', { ...base, data: '2026-01-01' }, SP, new Date('2026-11-13T12:00:00Z'))).toBeNull();
  });

  it('valida: "uma vez" exige a data; as recorrências antigas seguem válidas', () => {
    expect(validarConfig('gatilho.agendado', { frequencia: 'uma_vez', hora: '10:00' }).ok).toBe(false);
    expect(validarConfig('gatilho.agendado', { frequencia: 'uma_vez', hora: '10:00', data: '2026-12-01' }).ok).toBe(true);
    expect(validarConfig('gatilho.agendado', { frequencia: 'semanal', hora: '10:00', diasSemana: [1] }).ok).toBe(true);
    expect(validarConfig('gatilho.agendado', { frequencia: 'uma_vez', hora: '10:00', data: '20/11/2026' }).ok).toBe(false);
  });

  it('recorrente continua igual', () => {
    const t = proximoDoNo('gatilho.agendado', { ...base, frequencia: 'diario', data: undefined }, SP, new Date('2026-11-13T13:00:00Z'));
    expect(t?.toISOString()).toBe('2026-11-14T12:30:00.000Z');
  });
});
