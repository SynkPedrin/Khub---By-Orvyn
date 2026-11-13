import { quandoPorExtenso, confirmou, contextoAgenda, contextoAgendado, detectarPedidoAgenda, escolheuHorario, horaEscolhida, isoLocal, minutosDe, servicosCitados, slotNaHora } from './agenda-intent';
import { prometeuTransferencia, rajadaDoContato, ultimaFalaDaEmpresa } from '../intelligence/intelligence-core.service';
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

describe('Rajada do contato', () => {
  it('junta as mensagens do contato desde a última fala da empresa', () => {
    const h = [
      { autorTipo: 'contato', corpo: 'oi' },
      { autorTipo: 'ia', corpo: 'Oi! Como posso ajudar?' },
      { autorTipo: 'contato', corpo: 'queria fazer as duas sexta de manhã' },
      { autorTipo: 'contato', corpo: 'consegue?' },
    ];
    expect(rajadaDoContato(h)).toBe('queria fazer as duas sexta de manhã\nconsegue?');
    expect(detectarPedidoAgenda(rajadaDoContato(h), AGORA, SP)).toEqual({ data: '2026-11-13', periodo: 'manha' });
  });
  it('passa por cima da mensagem de automação', () => {
    const h = [
      { autorTipo: 'contato', corpo: 'oii boa tarde' },
      { autorTipo: 'contato', corpo: 'queria fazer manicure e pedicure' },
      { autorTipo: 'automacao', corpo: 'Seja muito bem-vinda!' },
      { autorTipo: 'contato', corpo: 'sexta de manhã tem horário?' },
    ];
    expect(rajadaDoContato(h)).toBe('oii boa tarde\nqueria fazer manicure e pedicure\nsexta de manhã tem horário?');
  });
});

describe('Escolha de horário', () => {
  it('reconhece escolha e gera o inicio com fuso', () => {
    expect(escolheuHorario('pode ser às 9')).toBe(true);
    expect(escolheuHorario('10h30 tá ótimo')).toBe(true);
    expect(escolheuHorario('quanto custa a manicure?')).toBe(false);
    expect(isoLocal('2026-11-13T12:00:00.000Z', SP)).toBe('2026-11-13T09:00:00-03:00');
    const txt = contextoAgenda({ data: '2026-11-13', periodo: 'manha' }, [{ inicio: '2026-11-13T12:00:00.000Z', fim: '2026-11-13T13:00:00.000Z' }], SP, AGORA, true);
    expect(txt).toContain('09:00 = 2026-11-13T09:00:00-03:00');
    expect(txt).toContain('chame solicitar_agendamento AGORA');
  });
});

describe('Hora escolhida', () => {
  it('normaliza a hora citada', () => {
    expect(horaEscolhida('pode ser às 9')).toBe('09:00');
    expect(horaEscolhida('9h30 tá ótimo')).toBe('09:30');
    expect(horaEscolhida('às 2 da tarde')).toBe('14:00');
    expect(horaEscolhida('pode ser')).toBeNull();
  });
  it('hora livre vira ordem de agendar; ocupada vira alternativa', () => {
    const livres = [{ inicio: '2026-11-13T12:00:00.000Z', fim: '2026-11-13T13:00:00.000Z' }];
    const ok = contextoAgenda({ data: '2026-11-13', periodo: 'manha' }, livres, SP, AGORA, true, '09:00');
    expect(ok).toContain('escolheu 09:00, que ESTÁ LIVRE');
    expect(ok).toContain('inicio=2026-11-13T09:00:00-03:00');
    expect(contextoAgenda({ data: '2026-11-13', periodo: 'manha' }, livres, SP, AGORA, true, '11:00')).toContain('11:00, que NÃO está livre');
  });
});

describe('Aceite de proposta', () => {
  it('reconhece aceite curto e não confunde com pergunta', () => {
    expect(confirmou('sim')).toBe(true);
    expect(confirmou('Pode sim!!')).toBe(true);
    expect(confirmou('fechado 👍')).toBe(true);
    expect(confirmou('sim, mas quanto custa a pedicure e se tem estacionamento perto?')).toBe(false);
    expect(confirmou('não')).toBe(false);
  });
  it('a proposta da empresa traz dia e hora', () => {
    const fala = 'Perfeito! Vou agendar sua manicure e pedicure para sexta-feira (13/11), às 9h';
    expect(horaEscolhida(fala)).toBe('09:00');
    expect(detectarPedidoAgenda(fala, AGORA, SP, 'agendamento')?.data).toBe('2026-11-13');
  });
});

describe('Última fala da empresa', () => {
  it('junta todos os balões seguidos antes da resposta do contato', () => {
    const h = [
      { autorTipo: 'contato', corpo: 'pode ser às 9' },
      { autorTipo: 'ia', corpo: 'Perfeito!' },
      { autorTipo: 'ia', corpo: 'Vou agendar para sexta (13/11) às 9h' },
      { autorTipo: 'ia', corpo: 'Confirma?' },
      { autorTipo: 'contato', corpo: 'sim' },
    ];
    expect(ultimaFalaDaEmpresa(h)).toBe('Perfeito!\nVou agendar para sexta (13/11) às 9h\nConfirma?');
  });
});

describe('Duração dos serviços (tabela das instruções)', () => {
  const instr = [
    '- Manicure: R$ 38,50 · 1h · Carmen, Cristina',
    '- Pedicure: R$ 44,00 · 1h a 1h30 · Carmen, Cristina',
    '- Design de sobrancelha: R$ 38,50 · 30min · Gabriela',
    '- Design com henna: R$ 49,50 · 30min · Gabriela',
    '- Coloração: a partir de R$ 120,00 · 20min de aplicação + 40min de ação · Rita',
    '- Esmaltação em gel: R$ 95,00 · duração a confirmar · Isabela',
  ].join('\n');
  it('lê faixas e somas', () => {
    expect(minutosDe('1h a 1h30')).toBe(90);
    expect(minutosDe('cerca de 3h')).toBe(180);
    expect(minutosDe('20min de aplicação + 40min de ação')).toBe(60);
    expect(minutosDe('R$ 38,50')).toBeNull();
  });
  it('acha os serviços citados com a duração', () => {
    expect(servicosCitados(instr, 'queria fazer manicure e pedicure sexta')).toEqual([{ nome: 'Manicure', minutos: 60, sinal: false }, { nome: 'Pedicure', minutos: 90, sinal: false }]);
    expect(servicosCitados(instr, 'quero coloração')).toEqual([{ nome: 'Coloração', minutos: 60, sinal: false }]);
    expect(servicosCitados(instr, 'esmaltação em gel')).toEqual([]);
    expect(servicosCitados('sem tabela', 'manicure')).toEqual([]);
  });
  it('slot na hora e contexto do resultado', () => {
    const livres = [{ inicio: '2026-11-13T12:00:00.000Z', fim: '2026-11-13T13:00:00.000Z' }];
    expect(slotNaHora(livres, '09:00', SP, AGORA)).toEqual(livres[0]);
    expect(slotNaHora(livres, '10:00', SP, AGORA)).toBeNull();
    expect(contextoAgendado({ ok: true }, '13/11/2026 às 09:00', 'Manicure + Pedicure', 150)).toContain('AGENDAMENTO FEITO AGORA');
    expect(contextoAgendado({ ok: false, erro: 'choque de horário' }, '13/11/2026 às 09:00', 'Manicure', 60)).toContain('Não diga que está agendado');
  });
});

describe('Confirmação à prova de cópia', () => {
  it('data por extenso e sinal', () => {
    expect(quandoPorExtenso('2026-11-13', '09:00', SP)).toBe('sexta-feira, 13/11, às 09:00');
    expect(servicosCitados('- Escova: a partir de R$ 85,00 · 45min a 1h · Rita · EXIGE SINAL', 'quero escova')[0].sinal).toBe(true);
    const ctx = contextoAgendado({ ok: true }, 'sexta-feira, 13/11, às 09:00', 'Manicure + Pedicure', 150, false);
    expect(ctx).toContain('sexta-feira, 13/11, às 09:00');
    expect(ctx).toContain('NÃO exigem sinal');
  });
});
