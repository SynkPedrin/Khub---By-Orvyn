import { contextoAgenda, detectarPedidoAgenda } from './agenda-intent';
import { prometeuTransferencia } from '../intelligence/intelligence-core.service';
import { calendario } from '../intelligence/prompt';

const SP = 'America/Sao_Paulo';
// Quarta-feira, 11/11/2026, 09:50 em São Paulo.
const AGORA = new Date('2026-11-11T12:50:00Z');

describe('Pré-consulta de agenda', () => {
  it('dia da semana + período', () => {
    expect(detectarPedidoAgenda('quero agendar manicure e pedicure pra sexta de manhã', AGORA, SP)).toEqual({ data: '2026-11-13', periodo: 'manha' });
    expect(detectarPedidoAgenda('tem horário sábado à tarde?', AGORA, SP)).toEqual({ data: '2026-11-14', periodo: 'tarde' });
  });
  it('mesmo dia da semana de hoje = a próxima semana', () => {
    expect(detectarPedidoAgenda('dá pra marcar quarta?', AGORA, SP)?.data).toBe('2026-11-18');
  });
  it('hoje, amanhã e data dd/mm (virando o ano)', () => {
    expect(detectarPedidoAgenda('consegue hoje?', AGORA, SP)?.data).toBe('2026-11-11');
    expect(detectarPedidoAgenda('quero marcar amanhã cedo', AGORA, SP)).toEqual({ data: '2026-11-12', periodo: 'manha' });
    expect(detectarPedidoAgenda('tem vaga dia 20/11?', AGORA, SP)?.data).toBe('2026-11-20');
    expect(detectarPedidoAgenda('quero agendar 05/01', AGORA, SP)?.data).toBe('2027-01-05');
  });
  it('sem dia ou sem pedido de horário não consulta', () => {
    expect(detectarPedidoAgenda('quero agendar uma manicure', AGORA, SP)).toBeNull();
    expect(detectarPedidoAgenda('vocês abrem sábado?', AGORA, SP)).toBeNull();
    // ...a não ser que a análise já diga que é agendamento
    expect(detectarPedidoAgenda('sábado de manhã', AGORA, SP, 'agendamento')).toEqual({ data: '2026-11-14', periodo: 'manha' });
  });
  it('contexto em hora local, filtrado pelo período', () => {
    const livres = [
      { inicio: '2026-11-13T12:00:00.000Z', fim: '2026-11-13T13:00:00.000Z' },
      { inicio: '2026-11-13T14:00:00.000Z', fim: '2026-11-13T15:00:00.000Z' },
      { inicio: '2026-11-13T17:00:00.000Z', fim: '2026-11-13T18:00:00.000Z' },
    ];
    const txt = contextoAgenda({ data: '2026-11-13', periodo: 'manha' }, livres, SP, AGORA);
    expect(txt).toContain('Livres de manhã em 13/11/2026: 09:00–10:00, 11:00–12:00');
    expect(txt).not.toContain('14:00');
    expect(contextoAgenda({ data: '2026-11-13', periodo: 'noite' }, livres, SP, AGORA)).toContain('Nada livre à noite');
    expect(contextoAgenda({ data: '2026-11-13', periodo: null }, [], SP, AGORA)).toContain('Nenhum horário livre');
  });
});

describe('Transferência prometida', () => {
  it('detecta aviso de passagem para a equipe', () => {
    expect(prometeuTransferencia('Sinto muito. Vou transferir sua mensagem para a equipe humana agora mesmo.')).toBe(true);
    expect(prometeuTransferencia('Já encaminhei seu caso para nossa atendente!')).toBe(true);
    expect(prometeuTransferencia('Vou passar isso imediatamente para a equipe responsável para que eles possam verificar o ocorrido.')).toBe(true);
  });
  it('não confunde com confirmação ou com outro "passar"', () => {
    expect(prometeuTransferencia('Domingo eu confirmo com a equipe se tem atendimento.')).toBe(false);
    expect(prometeuTransferencia('Vou passar para a equipe confirmar o horário.')).toBe(false);
    expect(prometeuTransferencia('Vou te passar o valor: R$ 38,50.')).toBe(false);
  });
});

describe('Calendário do contexto', () => {
  it('hoje e os próximos dias com data ISO no fuso', () => {
    const c = calendario(AGORA, SP);
    expect(c).toContain('Agora: quarta-feira, 11/11/2026, 09:50 (hoje = 2026-11-11).');
    expect(c).toContain('sexta 13/11 = 2026-11-13');
    expect(c).toContain('quarta 18/11 = 2026-11-18');
  });
});
