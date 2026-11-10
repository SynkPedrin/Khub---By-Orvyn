import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { HooksController, JANELA_DEDUPE_MS, assinaturaValida, jsonCanonico } from './hooks.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { TriggersService } from './triggers.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WF = '33333333-3333-4333-8333-333333333333';

/** Outbox em memória com o unique (tenant, dedupe_key) do banco. */
function ambiente(segredo: string | null = null) {
  const outbox = new Map<string, { dedupeKey: string; payload: unknown; createdAt: Date }>();
  const tx = {
    workflow: { findUnique: jest.fn(async () => ({ webhookSegredo: segredo })) },
    outboxEvent: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_dedupeKey: { dedupeKey: string } } }) => outbox.get(where.tenantId_dedupeKey.dedupeKey) ?? null),
      upsert: jest.fn(async ({ create }: { create: { dedupeKey: string; payload: unknown } }) => {
        const atual = outbox.get(create.dedupeKey);
        if (atual) return atual;
        const row = { dedupeKey: create.dedupeKey, payload: create.payload, createdAt: new Date(Date.now()) };
        outbox.set(create.dedupeKey, row);
        return row;
      }),
    },
  };
  const prisma = {
    $queryRaw: jest.fn(async () => [{ tenant_id: TENANT, workflow_id: WF }]),
    withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  return { ctl: new HooksController(prisma, {} as TriggersService), outbox, tx };
}

const cru = (body: unknown) => ({ rawBody: Buffer.from(JSON.stringify(body)) });
const assinar = (segredo: string, body: unknown) => `sha256=${createHmac('sha256', segredo).update(JSON.stringify(body)).digest('hex')}`;

describe('HooksController — W5 (Idempotency-Key opcional + assinatura)', () => {
  afterEach(() => jest.useRealTimers());

  it('sem Idempotency-Key: aceita (202) e grava o evento com chave derivada do conteúdo', async () => {
    const a = ambiente();
    const body = { email: 'ana@qa.test', nome: 'Ana' };
    await expect(a.ctl.receber('chave', body, cru(body))).resolves.toEqual({ recebido: true });
    expect(a.outbox.size).toBe(1);
    expect([...a.outbox.keys()][0]).toMatch(new RegExp(`^hook:${WF}:auto:[0-9a-f]{64}:\\d+$`));
  });

  it('sem header: o MESMO corpo (chaves em outra ordem) em < 10 min não abre segundo evento', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T12:09:00Z') }); // perto da virada do balde
    const a = ambiente();
    await a.ctl.receber('chave', { a: 1, b: { c: 2, d: 3 } }, cru({}));
    jest.setSystemTime(new Date('2026-11-10T12:14:00Z')); // 5 min depois, já no balde seguinte
    await expect(a.ctl.receber('chave', { b: { d: 3, c: 2 }, a: 1 }, cru({}))).resolves.toEqual({ recebido: true, duplicado: true });
    expect(a.outbox.size).toBe(1);
  });

  it('sem header: o mesmo corpo depois de 10 min é evento novo', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-10T12:00:00Z') });
    const a = ambiente();
    await a.ctl.receber('chave', { a: 1 }, cru({}));
    jest.setSystemTime(new Date(Date.parse('2026-11-10T12:00:00Z') + JANELA_DEDUPE_MS + 1000));
    await expect(a.ctl.receber('chave', { a: 1 }, cru({}))).resolves.toEqual({ recebido: true });
    expect(a.outbox.size).toBe(2);
  });

  it('com Idempotency-Key: a chave do remetente vale (retry não duplica)', async () => {
    const a = ambiente();
    await a.ctl.receber('chave', { a: 1 }, cru({}), 'ev-1');
    await a.ctl.receber('chave', { a: 2 }, cru({}), 'ev-1');
    expect([...a.outbox.keys()]).toEqual([`hook:${WF}:ev-1`]);
  });

  it('fluxo com segredo + assinatura inválida/ausente → 401 e NADA no outbox', async () => {
    const a = ambiente('whsec_teste');
    const body = { email: 'x@y.z' };
    await expect(a.ctl.receber('chave', body, cru(body), undefined, 'sha256=' + '0'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(a.ctl.receber('chave', body, cru(body))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(a.ctl.receber('chave', body, cru(body), undefined, assinar('outro-segredo', body))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(a.outbox.size).toBe(0);
    expect(a.tx.outboxEvent.upsert).not.toHaveBeenCalled();
  });

  it('fluxo com segredo + assinatura válida → aceita', async () => {
    const a = ambiente('whsec_teste');
    const body = { email: 'x@y.z' };
    await expect(a.ctl.receber('chave', body, cru(body), undefined, assinar('whsec_teste', body))).resolves.toEqual({ recebido: true });
    expect(a.outbox.size).toBe(1);
  });

  it('assinatura é sobre o corpo CRU: corpo alterado invalida', () => {
    const sig = assinar('s', { v: 1 });
    expect(assinaturaValida('s', Buffer.from(JSON.stringify({ v: 1 })), sig)).toBe(true);
    expect(assinaturaValida('s', Buffer.from(JSON.stringify({ v: 2 })), sig)).toBe(false);
    expect(assinaturaValida('s', Buffer.from('{}'), 'sha256=abc')).toBe(false);
    expect(assinaturaValida('s', Buffer.from('{}'), undefined)).toBe(false);
  });

  it('chave de URL desconhecida segue 202 (sem oráculo), sem ler segredo', async () => {
    const a = ambiente('whsec_teste');
    (a.ctl as unknown as { prisma: { $queryRaw: jest.Mock } }).prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(a.ctl.receber('nao-existe', {}, cru({}))).resolves.toEqual({ recebido: true });
    expect(a.tx.workflow.findUnique).not.toHaveBeenCalled();
  });

  it('jsonCanonico ordena chaves em todo nível e preserva a ordem de arrays', () => {
    expect(jsonCanonico({ b: [2, 1], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[2,1]}');
  });
});
