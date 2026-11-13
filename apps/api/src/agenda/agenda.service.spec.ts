import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { ehRespostaAfirmativa } from './confirmacao';
import { ConfigRequiredException, ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('ehRespostaAfirmativa (RV-07.1)', () => {
  it.each(['sim', 'Sim!', 'SIM', 'simmm', 'confirmo', 'Confirmado.', 'ok', 'Ok, obrigado', 'pode confirmar', 'sim, estarei lá', '👍', '👍🏽', 'sim 👍', '✅', 'tá bom', 'beleza, até amanhã', 'Bom dia! Confirmo'])(
    '"%s" confirma',
    (t) => expect(ehRespostaAfirmativa(t)).toBe(true),
  );
  it.each(['não', 'nao posso', 'sim, mas preciso remarcar', 'ok mas muda o horário', 'posso remarcar?', 'obrigado', '😡', '👎', '', '   ', 'quanto custa?', 'sim '.repeat(20)])(
    '"%s" não confirma',
    (t) => expect(ehRespostaAfirmativa(t)).toBe(false),
  );
  it('nulo/indefinido não confirma', () => {
    expect(ehRespostaAfirmativa(null)).toBe(false);
    expect(ehRespostaAfirmativa(undefined)).toBe(false);
  });
});

type Modelo = Record<string, jest.Mock>;
interface Tx { agendaCompromisso: Modelo; membership: Modelo; message: Modelo; conversation: Modelo; $executeRaw: jest.Mock }

function montar(tx: Partial<Tx>, env: Record<string, string> = {}) {
  const base: Tx = {
    agendaCompromisso: { findFirst: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn(async (a: { data: unknown }) => ({ id: 'ag1', ...(a.data as object) })), delete: jest.fn() },
    membership: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
    message: { findUnique: jest.fn(), findFirst: jest.fn() },
    conversation: { findUnique: jest.fn() },
    $executeRaw: jest.fn(async () => 1),
    ...tx,
  };
  // audit_logs é gravado por $executeRaw na mesma transação.
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(base)) } as unknown as PrismaService;
  const config = new ConfigService();
  jest.spyOn(config, 'get').mockImplementation((k: string) => env[k]);
  return { svc: new AgendaService(prisma, config), tx: base };
}

const T = '11111111-1111-4111-8111-111111111111';
const ATUAL = { id: 'ag1', status: 'agendado', inicio: new Date('2026-11-20T13:00:00Z'), fim: new Date('2026-11-20T14:00:00Z'), responsavelId: 'u1', titulo: 'Demo' };

describe('AgendaService.atualizar (arrastar/redimensionar/reagendar)', () => {
  it('mover para horário ocupado → 409 (a UI desfaz)', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce(ATUAL).mockResolvedValueOnce({ id: 'outro' });
    await expect(svc.atualizar(T, 'u1', 'ag1', { inicio: '2026-11-20T15:00:00Z', fim: '2026-11-20T16:00:00Z' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.agendaCompromisso.update).not.toHaveBeenCalled();
  });

  it('o choque ignora o próprio compromisso e respeita o escopo do responsável', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce(ATUAL).mockResolvedValueOnce(null);
    await svc.atualizar(T, 'u1', 'ag1', { fim: '2026-11-20T14:30:00Z' });
    const where = tx.agendaCompromisso.findFirst.mock.calls[1][0].where;
    expect(where.id).toEqual({ not: 'ag1' });
    expect(where.OR).toEqual([{ responsavelId: 'u1' }, { responsavelId: null }]);
    expect(tx.agendaCompromisso.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fim: new Date('2026-11-20T14:30:00Z') }) }));
  });

  it('fim antes do início → 400; compromisso de outro tenant/apagado → 404', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce(ATUAL);
    await expect(svc.atualizar(T, 'u1', 'ag1', { fim: '2026-11-20T12:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce(null);
    await expect(svc.atualizar(T, 'u1', 'x', { titulo: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responsável que não é membro da conta → 400', async () => {
    const { svc, tx } = montar({ membership: { findFirst: jest.fn(async () => null) } });
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce(ATUAL);
    await expect(svc.atualizar(T, 'u1', 'ag1', { responsavelId: '22222222-2222-4222-8222-222222222222' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgendaService.atualizarStatus', () => {
  it('aceita faltou e recusa o legado nao_compareceu', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValue(ATUAL);
    await expect(svc.atualizarStatus(T, 'u1', 'ag1', 'faltou')).resolves.toEqual(expect.objectContaining({ status: 'faltou' }));
    await expect(svc.atualizarStatus(T, 'u1', 'ag1', 'nao_compareceu')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reativar cancelado num horário já ocupado → 409', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValueOnce({ ...ATUAL, status: 'cancelado' }).mockResolvedValueOnce({ id: 'outro' });
    await expect(svc.atualizarStatus(T, 'u1', 'ag1', 'agendado')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AgendaService.criar', () => {
  it('humano sem responsável vira o próprio; IA sem responsável fica na agenda geral', async () => {
    const { svc, tx } = montar({});
    tx.agendaCompromisso.findFirst.mockResolvedValue(null);
    tx.agendaCompromisso.create.mockImplementation(async (a: { data: object }) => ({ id: 'n', ...a.data }));
    const humano = await svc.criar(T, 'u1', { titulo: 'Call', inicio: '2026-11-20T13:00:00Z', fim: '2026-11-20T13:30:00Z' });
    expect(humano).toEqual(expect.objectContaining({ responsavelId: 'u1', tipo: 'reuniao', createdBy: 'u1' }));
    const ia = await svc.criar(T, 'agente1', { titulo: 'Call', inicio: '2026-11-21T13:00:00Z', fim: '2026-11-21T13:30:00Z' }, 'nyro');
    expect(ia).toEqual(expect.objectContaining({ responsavelId: null, createdBy: null }));
  });
});

describe('AgendaService.confirmarPorResposta (RV-07.1)', () => {
  const RESP = new Date('2026-11-19T15:00:00Z');
  const LEMBRETE = new Date('2026-11-19T13:00:00Z');
  const cenario = (o: { texto?: string; autor?: string; alvo?: object | null; saiu?: boolean } = {}) => {
    const m = montar({});
    m.tx.message.findUnique.mockResolvedValue({ id: 'm1', autorTipo: o.autor ?? 'contato', corpo: o.texto ?? 'Sim, confirmo 👍', createdAt: RESP, conversationId: 'cv1' });
    m.tx.conversation.findUnique.mockResolvedValue({ contactId: 'c1' });
    m.tx.agendaCompromisso.findFirst.mockResolvedValue(o.alvo === undefined ? { ...ATUAL, lembreteEnviadoEm: LEMBRETE } : o.alvo);
    m.tx.message.findFirst.mockResolvedValue(o.saiu === false ? null : { id: 'out1' });
    return m;
  };

  it('afirmativa + lembrete disparado + nós mandamos mensagem depois → confirma', async () => {
    const { svc, tx } = cenario();
    await expect(svc.confirmarPorResposta(T, 'm1')).resolves.toEqual({ confirmado: 'ag1' });
    expect(tx.agendaCompromisso.update).toHaveBeenCalledWith({ where: { id: 'ag1' }, data: { status: 'confirmado' } });
    const where = tx.agendaCompromisso.findFirst.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({ contactId: 'c1', status: 'agendado', inicio: { gt: RESP } }));
    expect(where.lembreteEnviadoEm.gte).toEqual(new Date(+RESP - 48 * 3_600_000));
  });

  it.each([
    ['resposta não afirmativa', { texto: 'sim, mas preciso remarcar' }],
    ['mensagem nossa (não do contato)', { autor: 'humano' }],
    ['sem compromisso elegível (sem lembrete, passado ou já confirmado)', { alvo: null }],
    ['lembrete nunca saiu na conversa', { saiu: false }],
  ])('não confirma: %s', async (_n, o) => {
    const { svc, tx } = cenario(o);
    await expect(svc.confirmarPorResposta(T, 'm1')).resolves.toEqual({ confirmado: null });
    expect(tx.agendaCompromisso.update).not.toHaveBeenCalled();
  });
});

describe('AgendaService.dispararLembretes', () => {
  it('marca em SQL único dentro do tenant e devolve quantos', async () => {
    const { svc, tx } = montar({});
    tx.$executeRaw.mockResolvedValueOnce(3);
    await expect(svc.dispararLembretes(T)).resolves.toBe(3);
    const sql = (tx.$executeRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain("status = 'agendado'");
    expect(sql).toContain('lembrete_enviado_em IS NULL');
    expect(sql).toContain('contact_id IS NOT NULL');
  });
});

describe('AgendaService.sincronizarCalendar (gating)', () => {
  it('sem GOOGLE_CLIENT_ID/SECRET → 501 config_required com as variáveis', async () => {
    const { svc } = montar({});
    const e = await svc.sincronizarCalendar(T, 'u1', 'ag1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConfigRequiredException);
    expect((e as ConfigRequiredException).getStatus()).toBe(501);
    expect((e as ConfigRequiredException).getResponse()).toEqual(expect.objectContaining({ status: 'config_required', provider: 'google_calendar', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }));
  });

  it('com as variáveis e sem conexão OAuth → 501 config_required conexao_google_calendar', async () => {
    const { svc, tx } = montar({}, { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' });
    tx.agendaCompromisso.findFirst.mockResolvedValue({ id: 'ag1' });
    const e = await svc.sincronizarCalendar(T, 'u1', 'ag1').catch((x: unknown) => x);
    expect((e as ConfigRequiredException).getResponse()).toEqual(expect.objectContaining({ missing: ['conexao_google_calendar'] }));
  });
});
