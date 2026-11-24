import { OrientacaoAgente, SalaoAgendaService } from './salao-agenda.service';
import { instanteNoFuso, type AtendimentoHist } from './agenda-salao';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MessagesService } from '../../crm/messaging/messages.service';
import type { AvecAgendaService } from '../../integrations/avec/avec-agenda.service';

/** reservarCombo (db/079): vários serviços da mesma visita, mesmo grupo_id. */
const SP = 'America/Sao_Paulo';
const T = '11111111-1111-4111-8111-111111111111';
const CTX = { agentId: 'ag1', agentNome: 'Ritinha', contactId: 'c1' };

const SERVICOS = [
  { id: 's1', nome: 'Escova', duracaoMin: 45, precoCentavos: 5000 },
  { id: 's2', nome: 'Mão', duracaoMin: 60, precoCentavos: 3500 },
];
const PROFS = [
  { id: 'rita', nome: 'Rita' },
  { id: 'bia', nome: 'Bia' },
];
// Rita e Bia atendem sextas 08:00–18:00 (2 semanas → vira expediente deduzido).
const hist: AtendimentoHist[] = (['2026-11-06', '2026-11-13'] as const).flatMap((data) => [
  { profissionalId: 'rita', servicoId: null, inicio: instanteNoFuso(data, 8 * 60, SP), fim: instanteNoFuso(data, 18 * 60, SP) },
  { profissionalId: 'bia', servicoId: null, inicio: instanteNoFuso(data, 8 * 60, SP), fim: instanteNoFuso(data, 18 * 60, SP) },
]);
const SEXTA = '2026-11-27'; // sexta futura
const AGORA = instanteNoFuso('2026-11-26', 10 * 60, SP);
const iso = (hhmm: number) => new Date(instanteNoFuso(SEXTA, hhmm, SP)).toISOString();

function montar() {
  const criados: Record<string, unknown>[] = [];
  const tx = {
    servico: { findMany: jest.fn(async () => SERVICOS) },
    profissional: { findMany: jest.fn(async () => PROFS) },
    agendaCompromisso: {
      findMany: jest.fn(async () => hist.map((h) => ({ profissionalId: h.profissionalId, servicoId: h.servicoId, inicio: new Date(h.inicio), fim: new Date(h.fim) }))),
      findFirst: jest.fn(async (): Promise<unknown> => null), // choque e "já tem" → nada
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c = { id: `cp${criados.length + 1}`, ...data };
        criados.push(c);
        return c;
      }),
    },
    agendaJornada: { findMany: jest.fn(async () => []) },
    contact: { findUnique: jest.fn(async () => ({ nome: 'Ana Lima', telefone: '18999990000' })) },
    workflow: {
      findMany: jest.fn(async () => [
        { nome: 'Notificação Interna GHL', versaoAtiva: { grafo: { nos: [{ id: 'avisa_servico', tipo: 'acao.notificar_equipe', config: { telefone: '5518999990000' } }] } } },
      ]),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const mensagens = { notificarNumero: jest.fn(async () => ({ status: 'sent' })) } as unknown as MessagesService;
  const avec = { sincronizarDia: jest.fn(async () => ({})) } as unknown as AvecAgendaService;
  return { svc: new SalaoAgendaService(prisma, mensagens, avec), tx, criados, mensagens, avec };
}

describe('SalaoAgendaService.reservarCombo', () => {
  it('feliz: 2 serviços com profissionais diferentes, mesmo grupoId, equipe avisada UMA vez', async () => {
    const { svc, criados, mensagens, avec } = montar();
    const r = await svc.reservarCombo(
      T,
      CTX,
      { itens: [
        { servico: 'escova', profissional: 'Rita', inicio: iso(14 * 60) },
        { servico: 'mão', profissional: 'Bia', inicio: iso(14 * 60 + 30) },
      ] },
      SP,
      AGORA,
    );
    expect(r.grupoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(criados).toHaveLength(2);
    expect(criados[0]).toMatchObject({ servicoId: 's1', profissionalId: 'rita', grupoId: r.grupoId });
    expect(criados[1]).toMatchObject({ servicoId: 's2', profissionalId: 'bia', grupoId: r.grupoId });
    // fim = inicio + duração do serviço
    expect(+new Date(criados[0].fim as Date) - +new Date(criados[0].inicio as Date)).toBe(45 * 60_000);
    // Avec ao vivo UMA vez para a data; equipe avisada UMA vez com o resumo
    expect(avec.sincronizarDia).toHaveBeenCalledTimes(1);
    expect(mensagens.notificarNumero).toHaveBeenCalledTimes(1);
    const texto = (mensagens.notificarNumero as jest.Mock).mock.calls[0][2] as string;
    expect(texto).toContain('COMBO');
    expect(texto).toContain('Escova');
    expect(texto).toContain('Mão');
    expect(r.itens).toHaveLength(2);
    expect(r.equipeAvisada).toBe(true);
  });

  it('choque intra-grupo: a mesma profissional não faz dois serviços ao mesmo tempo', async () => {
    const { svc, criados } = montar();
    const e = await svc
      .reservarCombo(
        T,
        CTX,
        { itens: [
          { servico: 'escova', profissional: 'Rita', inicio: iso(14 * 60) },      // 14:00–14:45
          { servico: 'mão', profissional: 'rita', inicio: iso(14 * 60 + 30) },   // 14:30–15:30
        ] },
        SP,
        AGORA,
      )
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OrientacaoAgente);
    expect((e as Error).message).toContain('Rita');
    expect((e as Error).message).toContain('mesmo tempo');
    expect(criados).toHaveLength(0);
  });

  it('mesma profissional em horários SEQUENCIAIS pode', async () => {
    const { svc, criados } = montar();
    const r = await svc.reservarCombo(
      T,
      CTX,
      { itens: [
        { servico: 'escova', profissional: 'Rita', inicio: iso(14 * 60) },      // 14:00–14:45
        { servico: 'mão', profissional: 'Rita', inicio: iso(15 * 60) },         // 15:00–16:00
      ] },
      SP,
      AGORA,
    );
    expect(criados).toHaveLength(2);
    expect(r.grupoId).toBeTruthy();
  });

  it('1 item (ou 5) vira orientação para usar a reserva individual; choque de última hora é OrientacaoAgente', async () => {
    const { svc, tx, criados } = montar();
    await expect(
      svc.reservarCombo(T, CTX, { itens: [{ servico: 'escova', profissional: 'Rita', inicio: iso(14 * 60) }] }, SP, AGORA),
    ).rejects.toThrow('2 a 4');
    // alguém ocupou o horário da Rita depois do ver_horarios_salao
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce({ id: 'ocupado' });
    const e = await svc
      .reservarCombo(
        T,
        CTX,
        { itens: [
          { servico: 'escova', profissional: 'Rita', inicio: iso(14 * 60) },
          { servico: 'mão', profissional: 'Bia', inicio: iso(14 * 60 + 30) },
        ] },
        SP,
        AGORA,
      )
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OrientacaoAgente);
    expect((e as Error).message).toContain('acabou de ser reservada');
    expect(criados).toHaveLength(0);
  });
});
