import { describe, expect, it } from 'vitest';
import { resumoDoDia, rotuloMinutos, trilhasDoDia, TRILHA_FIM_MIN, TRILHA_INICIO_MIN } from './resumo-dia';
import type { Compromisso } from '@/lib/agenda';

let seq = 0;
function ev(inicio: string, fim: string, over: Partial<Compromisso> = {}): Compromisso {
  return {
    id: `e${++seq}`,
    titulo: 'Serviço',
    inicio: `2026-11-17T${inicio}:00-03:00`,
    fim: `2026-11-17T${fim}:00-03:00`,
    status: 'agendado',
    tipo: 'outro',
    contactId: null,
    responsavelId: null,
    profissionalId: null,
    servicoId: null,
    ...over,
  } as Compromisso;
}

describe('resumoDoDia', () => {
  it('soma totais, janela do dia e ocupação', () => {
    const r = resumoDoDia([
      ev('09:00', '10:00', { profissionalId: 'p1' }),
      ev('09:30', '10:30', { profissionalId: 'p2', status: 'confirmado' }),
      ev('14:00', '15:30', { profissionalId: 'p1', status: 'concluido' }),
    ]);
    expect(r.total).toBe(3);
    expect(r.profissionaisAtivas).toBe(2);
    expect(r.primeiraHoraMin).toBe(9 * 60);
    expect(r.ultimaHoraMin).toBe(15 * 60 + 30);
    expect(r.minutosOcupados).toBe(60 + 60 + 90);
    expect(r.porStatus).toEqual({ agendado: 1, confirmado: 1, concluido: 1 });
  });

  it('dia vazio não quebra', () => {
    const r = resumoDoDia([]);
    expect(r.total).toBe(0);
    expect(r.primeiraHoraMin).toBeNull();
    expect(r.minutosOcupados).toBe(0);
  });
});

describe('trilhasDoDia', () => {
  it('agrupa por profissional, ordena pelo mais cheio e manda "sem profissional" por último', () => {
    const trilhas = trilhasDoDia(
      [
        ev('09:00', '10:00', { profissionalId: 'p1' }),
        ev('10:00', '11:00', { profissionalId: 'p1' }),
        ev('09:00', '09:30', { profissionalId: 'p2' }),
        ev('12:00', '13:00', { profissionalNome: 'Avulsa' }),
      ],
      [{ id: 'p1', nome: 'Mel' } as never, { id: 'p2', nome: 'Cris' } as never],
    );
    expect(trilhas.map((t) => t.nome)).toEqual(['Mel', 'Cris', 'Sem profissional']);
    expect(trilhas[0].minutosOcupados).toBe(120);
    expect(trilhas[2].nome).toBe('Sem profissional');
  });

  it('esticar para dentro da janela: atendimento fora de 06h–22h não some', () => {
    const [t] = trilhasDoDia([ev('05:30', '05:50'), ev('22:30', '23:30')], []);
    expect(t.blocos[0].inicioMin).toBe(TRILHA_INICIO_MIN);
    expect(t.blocos[1].fimMin).toBe(TRILHA_FIM_MIN);
    expect(t.blocos[1].fimMin - t.blocos[1].inicioMin).toBe(5);
  });
});

describe('rotuloMinutos', () => {
  it('formata horas e minutos', () => {
    expect(rotuloMinutos(55)).toBe('55min');
    expect(rotuloMinutos(60)).toBe('1h');
    expect(rotuloMinutos(450)).toBe('7h30');
  });
});
