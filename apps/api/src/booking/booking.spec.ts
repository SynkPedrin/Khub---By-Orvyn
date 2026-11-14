import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgendaService } from '../agenda/agenda.service';
import { ConfigService } from '../config/config.service';
import { emitirCarimbo } from '../common/public-request';
import { calcularSlots, dataNoFuso, diaDaSemana, gerarIcs, instanteLocal, ordemDeTentativa, type ConfigSlots, type Ocupado } from './booking.schema';
import { BookingService } from './booking.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CaixaService } from '../financeiro/caixa.service';
import type { LeadsService } from '../crm/leads.service';
import type { PublicRateLimiter } from '../common/public-request';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'segredo-de-teste-com-mais-de-32-caracteres';

const SP = 'America/Sao_Paulo';
const t = (iso: string) => +new Date(iso);

describe('fuso', () => {
  it('09:00 em São Paulo = 12:00 UTC (UTC-3, sem horário de verão)', () => {
    expect(new Date(instanteLocal('2026-11-20', 9 * 60, SP)).toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });
  it('respeita horário de verão (Lisboa no verão = UTC+1)', () => {
    expect(new Date(instanteLocal('2026-07-01', 9 * 60, 'Europe/Lisbon')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(new Date(instanteLocal('2026-12-01', 9 * 60, 'Europe/Lisbon')).toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
  it('data local muda na virada do dia do fuso', () => {
    expect(dataNoFuso(t('2026-11-21T02:00:00Z'), SP)).toBe('2026-11-20');
  });
});

// 2026-11-20 é sexta-feira (dia 5).
const CFG: ConfigSlots = {
  duracaoMin: 60, intervaloMin: 0, antecedenciaMinHoras: 2, janelaDias: 14, fuso: SP,
  horarios: { '5': [{ de: '09:00', ate: '12:00' }, { de: '14:00', ate: '16:00' }] },
  responsaveis: [],
};
const inicios = (s: { inicio: string }[]) => s.map((x) => x.inicio);

describe('calcularSlots', () => {
  const ontem = t('2026-11-19T12:00:00Z');

  it('gera os horários das faixas no fuso da página', () => {
    expect(inicios(calcularSlots(CFG, '2026-11-20', [], ontem))).toEqual([
      '2026-11-20T12:00:00.000Z', '2026-11-20T13:00:00.000Z', '2026-11-20T14:00:00.000Z',
      '2026-11-20T17:00:00.000Z', '2026-11-20T18:00:00.000Z',
    ]);
  });

  it('antecedência mínima: às 08:30 locais com 2h, o primeiro é 11:00', () => {
    const agora = t('2026-11-20T11:30:00Z'); // 08:30 em SP
    expect(inicios(calcularSlots(CFG, '2026-11-20', [], agora))[0]).toBe('2026-11-20T14:00:00.000Z');
  });

  it('janela: fora do intervalo [hoje, hoje + janela) não tem horário', () => {
    expect(calcularSlots(CFG, '2026-11-13', [], ontem)).toEqual([]); // passado
    expect(calcularSlots({ ...CFG, janelaDias: 1 }, '2026-11-20', [], ontem)).toEqual([]); // além da janela
    expect(calcularSlots(CFG, '2026-11-21', [], ontem)).toEqual([]); // sábado fechado
  });

  it('choque: compromisso existente tira o horário da agenda geral', () => {
    const ocupado: Ocupado[] = [{ inicio: t('2026-11-20T13:30:00Z'), fim: t('2026-11-20T14:15:00Z'), responsavelId: 'u9' }];
    expect(inicios(calcularSlots(CFG, '2026-11-20', ocupado, ontem))).toEqual(['2026-11-20T12:00:00.000Z', '2026-11-20T17:00:00.000Z', '2026-11-20T18:00:00.000Z']);
  });

  it('choque por responsável: A ocupado deixa B livre; agenda geral ocupada bloqueia os dois', () => {
    const cfg = { ...CFG, responsaveis: ['A', 'B'] };
    const ocupados: Ocupado[] = [
      { inicio: t('2026-11-20T12:00:00Z'), fim: t('2026-11-20T13:00:00Z'), responsavelId: 'A' },
      { inicio: t('2026-11-20T13:00:00Z'), fim: t('2026-11-20T14:00:00Z'), responsavelId: null },
    ];
    const s = calcularSlots(cfg, '2026-11-20', ocupados, ontem);
    expect(s.find((x) => x.inicio === '2026-11-20T12:00:00.000Z')?.livres).toEqual(['B']);
    expect(s.find((x) => x.inicio === '2026-11-20T13:00:00.000Z')).toBeUndefined();
    expect(s.find((x) => x.inicio === '2026-11-20T14:00:00.000Z')?.livres).toEqual(['A', 'B']);
  });

  it('intervalo entre compromissos vale como folga dos dois lados', () => {
    const cfg = { ...CFG, intervaloMin: 15 };
    // passo 75 min: 09:00, 10:15 (11:30 não cabe até 12:00)
    expect(inicios(calcularSlots(cfg, '2026-11-20', [], ontem)).slice(0, 2)).toEqual(['2026-11-20T12:00:00.000Z', '2026-11-20T13:15:00.000Z']);
    const ocupado: Ocupado[] = [{ inicio: t('2026-11-20T14:20:00Z'), fim: t('2026-11-20T14:40:00Z'), responsavelId: null }]; // 11:20 local
    expect(inicios(calcularSlots(cfg, '2026-11-20', ocupado, ontem))).not.toContain('2026-11-20T13:15:00.000Z');
  });

  it('remarcação ignora o próprio compromisso', () => {
    const ocupado: Ocupado[] = [{ id: 'meu', inicio: t('2026-11-20T12:00:00Z'), fim: t('2026-11-20T13:00:00Z'), responsavelId: null }];
    expect(inicios(calcularSlots(CFG, '2026-11-20', ocupado, ontem, 'meu'))).toContain('2026-11-20T12:00:00.000Z');
  });
});

describe('ordemDeTentativa (round-robin / fixo)', () => {
  it('round-robin começa no cursor, dá a volta e pula quem está ocupado', () => {
    expect(ordemDeTentativa(['A', 'B', 'C'], ['A', 'B', 'C'], 'round_robin', 1)).toEqual(['B', 'C', 'A']);
    expect(ordemDeTentativa(['A', 'B', 'C'], ['A', 'C'], 'round_robin', 1)).toEqual(['C', 'A']);
  });
  it('fixo: só o primeiro responsável', () => {
    expect(ordemDeTentativa(['A', 'B'], ['A', 'B'], 'fixo', 1)).toEqual(['A']);
    expect(ordemDeTentativa(['A', 'B'], ['B'], 'fixo', 0)).toEqual([]);
  });
});

describe('.ics', () => {
  it('evento com horário UTC e texto escapado', () => {
    const ics = gerarIcs({ uid: 'x1', inicio: new Date('2026-11-20T12:00:00Z'), fim: new Date('2026-11-20T13:00:00Z'), titulo: 'Avaliação; retorno, dúvidas', local: 'Rua A, 10', agora: new Date('2026-11-10T00:00:00Z') });
    expect(ics).toContain('DTSTART:20261120T120000Z');
    expect(ics).toContain('SUMMARY:Avaliação\\; retorno\\, dúvidas');
    expect(ics).toContain('LOCATION:Rua A\\, 10');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

// ------------------------------------------------------------------ corrida

/**
 * Banco de mentira com a semântica que importa: transações concorrentes, e o
 * `pg_advisory_xact_lock` serializando quem pega o mesmo lock até o "commit"
 * (fim do `withTenant`). As leituras cedem a vez (setImmediate) para forçar o
 * entrelaçamento que, sem lock, deixava as duas reservas passarem.
 */
function bancoConcorrente() {
  const linhas: { id: string; inicio: Date; fim: Date; status: string; responsavelId: string | null }[] = [];
  let fila: Promise<void> = Promise.resolve();
  const ceder = () => new Promise((r) => setImmediate(r));
  const prisma = {
    withTenant: async (_t: string, work: (tx: unknown) => Promise<unknown>) => {
      let soltar: (() => void) | null = null;
      const tx = {
        $executeRaw: async (sql: TemplateStringsArray) => {
          if (sql.join('?').includes('pg_advisory_xact_lock')) {
            const anterior = fila;
            fila = new Promise<void>((r) => (soltar = r));
            await anterior;
          }
          return 1;
        },
        membership: { findFirst: async () => ({ id: 'm' }) },
        agendaCompromisso: {
          findFirst: async (a: { where: { inicio: { lt: Date }; fim: { gt: Date } } }) => {
            await ceder();
            return linhas.find((l) => ['agendado', 'confirmado'].includes(l.status) && l.inicio < a.where.inicio.lt && l.fim > a.where.fim.gt) ?? null;
          },
          create: async (a: { data: { inicio: Date; fim: Date; status?: string; responsavelId: string | null } }) => {
            await ceder();
            const l = { id: `c${linhas.length + 1}`, inicio: a.data.inicio, fim: a.data.fim, status: a.data.status ?? 'agendado', responsavelId: a.data.responsavelId };
            linhas.push(l);
            return l;
          },
        },
      };
      try {
        return await work(tx);
      } finally {
        (soltar as (() => void) | null)?.();
      }
    },
  } as unknown as PrismaService;
  return { prisma, linhas };
}

const T = '11111111-1111-4111-8111-111111111111';

describe('corrida: duas reservas no mesmo horário', () => {
  it('AgendaService.criar com lock: uma passa, a outra recebe 409', async () => {
    const { prisma, linhas } = bancoConcorrente();
    const agenda = new AgendaService(prisma, new ConfigService(), { sincronizarCompromisso: jest.fn() } as unknown as CaixaService);
    const dto = { titulo: 'Consulta', inicio: '2026-11-20T12:00:00Z', fim: '2026-11-20T13:00:00Z', responsavelId: null };
    const r = await Promise.allSettled([agenda.criar(T, 'c1', dto, 'sistema'), agenda.criar(T, 'c2', dto, 'sistema')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason).toBeInstanceOf(ConflictException);
    expect(linhas).toHaveLength(1);
  });

  it('status inicial confirmado quando a página confirma automaticamente', async () => {
    const { prisma, linhas } = bancoConcorrente();
    const agenda = new AgendaService(prisma, new ConfigService(), { sincronizarCompromisso: jest.fn() } as unknown as CaixaService);
    await agenda.criar(T, 'c1', { titulo: 'X', inicio: '2026-11-20T12:00:00Z', fim: '2026-11-20T13:00:00Z', responsavelId: null, status: 'confirmado' }, 'sistema');
    expect(linhas[0].status).toBe('confirmado');
  });
});

// ------------------------------------------------------------------ BookingService.reservar

const PAGE = '44444444-4444-4444-8444-444444444444';
function montarBooking(criar: jest.Mock, atribuicao?: { registrar: jest.Mock }) {
  const amanha = new Date(Date.now() + 2 * 86_400_000);
  const dia = String(diaDaSemana(dataNoFuso(+amanha, SP)));
  const pagina = {
    id: PAGE, tenantId: T, slug: 'consulta-inicial', titulo: 'Consulta inicial', descricao: null, duracaoMin: 60, intervaloMin: 0, antecedenciaMinHoras: 0, janelaDias: 30,
    horarios: { [dia]: [{ de: '09:00', ate: '18:00' }] }, fuso: SP, responsaveis: ['A', 'B'], distribuicao: 'round_robin', rrCursor: 0, local: 'Online', tipo: 'reuniao',
    perguntas: [], confirmacaoAutomatica: true, estilo: {}, ativo: true, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const tx = {
    bookingPage: { findUnique: jest.fn(async () => pagina), update: jest.fn(async () => pagina) },
    bookingReserva: { create: jest.fn(async () => ({})) },
  };
  const prisma = {
    $queryRaw: jest.fn(async () => [{ tenant_id: T, page_id: PAGE, tenant_nome: 'Clínica' }]),
    withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)),
  } as unknown as PrismaService;
  const agenda = { listar: jest.fn(async () => []), criar } as unknown as AgendaService;
  const leads = { capturar: jest.fn(async () => ({ contactId: 'c1', criado: true, tagsAdicionadas: [] })) } as unknown as LeadsService;
  const limite = { consumir: jest.fn(async () => undefined) } as unknown as PublicRateLimiter;
  const inicio = new Date(instanteLocal(dataNoFuso(+amanha, SP), 10 * 60, SP)).toISOString();
  return { svc: new BookingService(prisma, agenda, leads, limite, atribuicao as never), tx, leads, inicio };
}
const corpo = (inicio: string, extra: Record<string, unknown> = {}) => ({ inicio, nome: 'Ana Souza', telefone: '(11) 97777-1234', email: 'ana@exemplo.com', carimbo: emitirCarimbo(`booking:${PAGE}`, Date.now() - 8000), ...extra });
const CTX = { ip: '200.1.2.3', userAgent: null };

describe('BookingService.reservar', () => {
  it('perdeu a corrida com A (409 da agenda): tenta B, confirma e avança o round-robin', async () => {
    const criar = jest.fn()
      .mockRejectedValueOnce(new ConflictException('já existe um compromisso nesse horário'))
      .mockResolvedValueOnce({ id: 'cp1', status: 'confirmado', responsavelId: 'B' });
    const { svc, tx, inicio } = montarBooking(criar);
    const r = await svc.reservar('consulta-inicial', corpo(inicio), CTX);
    expect(r.ok).toBe(true);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(criar.mock.calls.map((c) => c[2].responsavelId)).toEqual(['A', 'B']);
    expect(criar.mock.calls[0][2]).toMatchObject({ status: 'confirmado', contactId: 'c1' });
    expect(criar.mock.calls[0][3]).toBe('sistema');
    const reserva = (tx.bookingReserva.create.mock.calls[0] as unknown as [{ data: { tokenHash: string } }])[0].data;
    expect(reserva.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(reserva.tokenHash).not.toBe(r.token);
    expect(tx.bookingPage.update).toHaveBeenCalledWith({ where: { id: PAGE }, data: { rrCursor: 0 } });
  });

  it('todos ocupados na hora de gravar → 409 horario_indisponivel', async () => {
    const criar = jest.fn().mockRejectedValue(new ConflictException('x'));
    const { svc, tx, inicio } = montarBooking(criar);
    await expect(svc.reservar('consulta-inicial', corpo(inicio), CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.bookingReserva.create).not.toHaveBeenCalled();
  });

  it('horário fora da grade → 409 sem criar contato', async () => {
    const criar = jest.fn();
    const { svc, leads, inicio } = montarBooking(criar);
    const torto = new Date(+new Date(inicio) + 7 * 60_000).toISOString();
    await expect(svc.reservar('consulta-inicial', corpo(torto), CTX)).rejects.toBeInstanceOf(ConflictException);
    expect(leads.capturar).not.toHaveBeenCalled();
  });

  it('honeypot: finge sucesso sem reservar', async () => {
    const criar = jest.fn();
    const { svc, leads, inicio } = montarBooking(criar);
    const r = await svc.reservar('consulta-inicial', corpo(inicio, { website: 'spam' }), CTX);
    expect(r).toEqual({ ok: true, reserva: null, token: null });
    expect(leads.capturar).not.toHaveBeenCalled();
    expect(criar).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ página pessoal (CAL-PESSOAL)

const EU = '1da00000-0000-4000-8000-00000000069a';

function montarPessoal(existente: Record<string, unknown> | null) {
  const tx = {
    bookingPage: {
      findUnique: jest.fn(async () => existente),
      create: jest.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'p1', ...a.data, _count: undefined })),
      update: jest.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'p1', ...(existente ?? {}), ...a.data, _count: { reservas: 0 } })),
    },
    user: { findFirst: jest.fn(async () => ({ nome: 'Ana Souza' })) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const svc = new BookingService(prisma, {} as AgendaService, {} as LeadsService, {} as PublicRateLimiter);
  return { svc, tx };
}

describe('BookingService.salvarMinha (página pessoal)', () => {
  it('1ª vez: cria com a fila imposta pelo servidor e título/slug do nome', async () => {
    const { svc, tx } = montarPessoal(null);
    const p = await svc.salvarMinha(T, EU, { duracaoMin: 45 });
    const data = (tx.bookingPage.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data.responsaveis).toEqual([EU]);
    expect(data.distribuicao).toBe('fixo');
    expect(data.ownerId).toBe(EU);
    expect(data.titulo).toBe('Agendar com Ana Souza');
    expect(data.slug).toMatch(/^ana-souza-[0-9a-f]{6}$/);
    expect(data.duracaoMin).toBe(45);
    expect(p.ownerId).toBe(EU);
  });

  it('já existe: atualiza sem nunca tocar na fila', async () => {
    const { svc, tx } = montarPessoal({ id: 'p1', ownerId: EU });
    await svc.salvarMinha(T, EU, { titulo: 'Meu horário', ativo: false });
    const data = (tx.bookingPage.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ titulo: 'Meu horário', ativo: false });
    expect(data.responsaveis).toBeUndefined();
    expect(data.distribuicao).toBeUndefined();
    expect(tx.bookingPage.create).not.toHaveBeenCalled();
  });

  it('corpo com responsaveis/distribuicao é recusado (a fila não é negociável)', async () => {
    const { svc, tx } = montarPessoal(null);
    await expect(svc.salvarMinha(T, EU, { responsaveis: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.salvarMinha(T, EU, { distribuicao: 'round_robin' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.bookingPage.create).not.toHaveBeenCalled();
  });

  it('admin não tira o dono da fila nem pela rota geral', async () => {
    const { svc } = montarPessoal({ id: 'p1', ownerId: EU });
    const falha = await svc.atualizar(T, 'p1', { responsaveis: ['99999999-9999-4999-8999-999999999999'] }).catch((e: unknown) => e);
    expect(falha).toBeInstanceOf(BadRequestException);
    expect((falha as BadRequestException).getResponse()).toMatchObject({ code: 'dono_fora_da_fila' });
    await expect(svc.atualizar(T, 'p1', { responsaveis: [EU] })).resolves.toMatchObject({ id: 'p1' });
  });
});

describe('rastreio do agendamento (db/066)', () => {
  it('reserva com gclid registra a ficha de origem do contato (google_ads)', async () => {
    const criar = jest.fn().mockResolvedValue({ id: 'cp1', status: 'confirmado', responsavelId: 'A' });
    const atribuicao = { registrar: jest.fn(async () => undefined) };
    const { svc, inicio } = montarBooking(criar, atribuicao);
    await svc.reservar('consulta-inicial', corpo(inicio, { utm: { utm_source: 'google', utm_campaign: 'busca', gclid: 'g-123' } }), CTX);
    expect(atribuicao.registrar).toHaveBeenCalledTimes(1);
    const [tenantId, contactId, toque] = atribuicao.registrar.mock.calls[0] as unknown as [string, string, { fonte: string; confianca: string; cliqueId?: string; campanha?: string }];
    expect(tenantId).toBe(T);
    expect(contactId).toBe('c1');
    expect(toque).toMatchObject({ fonte: 'google_ads', confianca: 'confirmada', cliqueId: 'g-123', campanha: 'busca' });
  });

  it('reserva sem UTM ainda registra o toque como formulário (origem nunca inventada)', async () => {
    const criar = jest.fn().mockResolvedValue({ id: 'cp1', status: 'confirmado', responsavelId: 'A' });
    const atribuicao = { registrar: jest.fn(async () => undefined) };
    const { svc, inicio } = montarBooking(criar, atribuicao);
    await svc.reservar('consulta-inicial', corpo(inicio), CTX);
    expect(atribuicao.registrar).toHaveBeenCalledTimes(1);
    const toque = (atribuicao.registrar.mock.calls[0] as unknown[])[2] as { fonte: string };
    expect(toque.fonte).toBe('formulario');
  });
});
