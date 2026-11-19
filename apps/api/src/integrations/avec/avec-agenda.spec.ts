import { itensDoDia, jornadaDoDia, mapearProfissionais, planejarDia, statusDoAvec, TITULO_BLOQUEIO, type LinhaKhub } from './avec-agenda';
import type { DiaProfissionalAvec, ReservaAvec } from './avec.client';

const DATA = '2026-11-25';
// Minuto do dia → epoch (UTC-3 fixo no teste).
const instante = (m: number) => Date.UTC(2026, 10, 25, 3, 0) + m * 60_000;
const CORTE = Date.UTC(2026, 10, 19, 12);
const ANTES = Date.UTC(2026, 10, 14, 12);
const DEPOIS = Date.UTC(2026, 10, 19, 15);

const dia = (reservas: (Partial<ReservaAvec> & { id?: string })[] = [], extra: Partial<DiaProfissionalAvec> = {}): DiaProfissionalAvec[] => [
  {
    idProf: '5001',
    reservas: reservas.map((r) => ({ hora_inicio: '540', hora_fim: '600', status: '1.0', profissional_id: '5001', data: DATA, servico: 'Selante', servico_id: '77', salao_cliente_id: '9001', cliente_nome: 'Ana Souza', cliente_tel: '11 98888-7777', ...r })),
    jornada: { horarios: { hora_inicio: '480', hora_fim: '1080' }, bloqueado: [] },
    ...extra,
  },
];

const linha = (p: Partial<LinhaKhub>): LinhaKhub => ({
  id: 'x', origem: null, externoId: null, profissionalId: 'k-paula', inicio: instante(540), fim: instante(600), status: 'agendado', titulo: 'Selante',
  servicoId: 's-selante', notas: null, createdAt: ANTES, contatoTelefone: null, contatoNome: null, ...p,
});

const base = { profissional: new Map([['5001', 'k-paula']]), servicoPorNome: new Map([['selante', 's-selante']]), instante, corteLegado: CORTE };

describe('avec-agenda: profissionais', () => {
  it('casa pelo apelido, sem acento e sem caixa; nome ambíguo fica sem vínculo', () => {
    const m = mapearProfissionais(
      [
        { id: '1', nome: 'Paula Moreira', apelido: 'paula' },
        { id: '2', nome: 'Lívia Prado', apelido: null },
        { id: '3', nome: 'Carla Nunes', apelido: null },
        { id: '4', nome: 'Ana Lima', apelido: null },
      ],
      [
        { id: 'k1', nome: 'Paula' },
        { id: 'k2', nome: 'Livia' },
        { id: 'k3', nome: 'carla' },
        { id: 'k4', nome: 'Ana' },
        { id: 'k5', nome: 'ana' },
      ],
    );
    expect(m.get('1')).toBe('k1');
    expect(m.get('2')).toBe('k2');
    expect(m.get('3')).toBe('k3');
    expect(m.get('4')).toBeNull();
  });
});

describe('avec-agenda: leitura do dia', () => {
  it('status: cancelado e faltou não ocupam; 1 agendado; 1.5+ confirmado (pago futuro continua ocupando)', () => {
    expect(statusDoAvec('0')).toBeNull();
    expect(statusDoAvec('0.6')).toBeNull();
    expect(statusDoAvec('1.0')).toBe('agendado');
    expect(statusDoAvec('1.5')).toBe('confirmado');
    expect(statusDoAvec('4.0')).toBe('confirmado');
  });

  it('jornada: horário vira minutos; [] é folga', () => {
    expect(jornadaDoDia(dia()[0])).toEqual({ iniMin: 480, fimMin: 1080 });
    expect(jornadaDoDia({ idProf: '1', jornada: [] })).toBeNull();
    expect(jornadaDoDia({ idProf: '1', jornada: { horarios: [] } })).toBeNull();
  });

  it('chave estável (não usa o id cifrado do Avec) e única para atendimentos idênticos; bloqueio entra como ocupação', () => {
    const d = dia([{ id: 'cifrado-1' }, { id: 'cifrado-2' }]);
    (d[0].jornada as { bloqueado: unknown[] }).bloqueado = [{ hora_inicio: '870', hora_fim: '900', profissional_id: '5001', data_ini: DATA }];
    const it1 = itensDoDia(DATA, d);
    const it2 = itensDoDia(DATA, dia([{ id: 'outro-cifrado' }, { id: 'mais-um' }]).map((x) => ({ ...x, jornada: d[0].jornada })));
    expect(it1.map((i) => i.externoId)).toEqual(it2.map((i) => i.externoId));
    expect(new Set(it1.map((i) => i.externoId)).size).toBe(3);
    expect(it1[2]).toMatchObject({ bloqueio: true, iniMin: 870, fimMin: 900 });
  });

  it('reserva cancelada no Avec não vira item', () => {
    expect(itensDoDia(DATA, dia([{ status: '0' }]))).toHaveLength(0);
  });
});

describe('avec-agenda: plano do dia', () => {
  it('reserva nova no Avec → cria no KHUB com serviço do catálogo', () => {
    const p = planejarDia({ ...base, itens: itensDoDia(DATA, dia([{}])), existentes: [] });
    expect(p.inserir).toHaveLength(1);
    expect(p.inserir[0]).toMatchObject({ profissionalId: 'k-paula', inicio: instante(540), fim: instante(600), servicoId: 's-selante', status: 'agendado', titulo: 'Selante' });
  });

  it('bloqueio do Avec → linha "Bloqueio (Avec)"', () => {
    const d = dia();
    (d[0].jornada as { bloqueado: unknown[] }).bloqueado = [{ hora_inicio: '960', hora_fim: '1080', profissional_id: '5001' }];
    const p = planejarDia({ ...base, itens: itensDoDia(DATA, d), existentes: [] });
    expect(p.inserir[0]).toMatchObject({ titulo: TITULO_BLOQUEIO, bloqueio: true, inicio: instante(960) });
  });

  it('já sincronizada e igual → nada; status mudou no Avec → atualiza', () => {
    const [it] = itensDoDia(DATA, dia([{}]));
    const igual = linha({ id: 'a1', origem: 'avec', externoId: it.externoId });
    expect(planejarDia({ ...base, itens: [it], existentes: [igual] })).toMatchObject({ inserir: [], atualizar: [], cancelar: [] });
    const [conf] = itensDoDia(DATA, dia([{ status: '1.5' }]));
    expect(planejarDia({ ...base, itens: [conf], existentes: [igual] }).atualizar).toEqual([{ id: 'a1', dados: { status: 'confirmado' } }]);
  });

  it('sumiu do Avec (cancelada ou remarcada) → cancela no KHUB; remarcada nasce de novo', () => {
    const [velha] = itensDoDia(DATA, dia([{}]));
    const [nova] = itensDoDia(DATA, dia([{ hora_inicio: '660', hora_fim: '720' }]));
    const p = planejarDia({ ...base, itens: [nova], existentes: [linha({ id: 'a1', origem: 'avec', externoId: velha.externoId })] });
    expect(p.cancelar).toEqual([{ id: 'a1', motivo: 'saiu_do_avec' }]);
    expect(p.inserir[0].inicio).toBe(instante(660));
  });

  it('cancelada por engano no KHUB mas viva no Avec → volta a ocupar; concluída no KHUB não reabre', () => {
    const [it] = itensDoDia(DATA, dia([{}]));
    expect(planejarDia({ ...base, itens: [it], existentes: [linha({ id: 'a1', origem: 'avec', externoId: it.externoId, status: 'cancelado' })] }).atualizar).toEqual([
      { id: 'a1', dados: { status: 'agendado' } },
    ]);
    expect(planejarDia({ ...base, itens: [it], existentes: [linha({ id: 'a1', origem: 'avec', externoId: it.externoId, status: 'concluido' })] }).atualizar).toEqual([]);
  });

  it('cópia antiga da exportação (legado) no mesmo horário → adota; legado que não está mais no Avec → cancela', () => {
    const [it] = itensDoDia(DATA, dia([{}]));
    const p = planejarDia({
      ...base,
      itens: [it],
      existentes: [linha({ id: 'leg1' }), linha({ id: 'leg2', inicio: instante(700), fim: instante(760) })],
    });
    expect(p.atualizar).toEqual([{ id: 'leg1', dados: { origem: 'avec', externoId: it.externoId } }]);
    expect(p.cancelar).toEqual([{ id: 'leg2', motivo: 'legado_fora_do_avec' }]);
    expect(p.inserir).toHaveLength(0);
  });

  it('reserva da IA com OUTRA cliente no mesmo horário: não adota, não cancela, reporta conflito (BUG-050)', () => {
    const [it] = itensDoDia(DATA, dia([{}]));
    const ia = linha({ id: 'ia1', notas: 'Reservado pela Assistente no WhatsApp.', createdAt: DEPOIS, contatoNome: 'Bia Lima', contatoTelefone: '5511977776666' });
    const p = planejarDia({ ...base, itens: [it], existentes: [ia] });
    expect(p.cancelar).toEqual([]);
    expect(p.atualizar).toEqual([]);
    expect(p.inserir).toHaveLength(1);
    expect(p.conflitos).toEqual([{ id: 'ia1', externoId: it.externoId }]);
  });

  it('reserva da IA que a equipe lançou no Avec (mesma cliente pelo telefone) → adota, sem duplicar', () => {
    const [it] = itensDoDia(DATA, dia([{}]));
    const ia = linha({ id: 'ia1', notas: 'Reservado pela Assistente no WhatsApp.', createdAt: DEPOIS, contatoTelefone: '5511988887777' });
    const p = planejarDia({ ...base, itens: [it], existentes: [ia] });
    expect(p.atualizar).toEqual([{ id: 'ia1', dados: { origem: 'avec', externoId: it.externoId } }]);
    expect(p.inserir).toHaveLength(0);
    expect(p.conflitos).toEqual([]);
  });

  it('linha criada pela equipe no KHUB depois de ligar o Avec e sem par no Avec → fica intacta', () => {
    const p = planejarDia({ ...base, itens: [], existentes: [linha({ id: 'eq1', createdAt: DEPOIS })] });
    expect(p).toMatchObject({ inserir: [], atualizar: [], cancelar: [], conflitos: [] });
  });

  it('profissional do Avec sem par no KHUB não some calada', () => {
    const p = planejarDia({ ...base, profissional: new Map(), itens: itensDoDia(DATA, dia([{}])), existentes: [] });
    expect(p.semProfissional).toBe(1);
  });
});
