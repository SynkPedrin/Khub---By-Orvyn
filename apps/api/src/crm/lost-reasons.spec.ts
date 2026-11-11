import { BadRequestException, ConflictException } from '@nestjs/common';
import { LostReasonsService, MOTIVOS_PADRAO, garantirMotivosPadrao, limparNomeMotivo, limparObsPerda, resolverMotivoPerda } from './lost-reasons.service';
import { CrmService } from './crm.service';
import { permissionFor, hasPermission } from '../auth/permissions.guard';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { AvatarContatoService } from './messaging/avatar-contato.service';
import type { AuthUser } from '../auth/decorators';

const T = '11111111-1111-1111-1111-111111111111';
const M1 = '7a000000-0000-4000-8000-000000000001';
const M2 = '7a000000-0000-4000-8000-000000000002';
const D = 'da000000-0000-4000-8000-000000000001';

interface Motivo { id: string; nome: string; ativo: boolean; ordem: number }

/** tx falso com catálogo de motivos e um negócio. */
function fakeTx(opts: { motivos?: Motivo[]; usos?: number; deal?: { status: string } | null; membro?: boolean } = {}) {
  const motivos: Motivo[] = opts.motivos ? [...opts.motivos] : [];
  const log: { op: string; args: unknown }[] = [];
  const tx = {
    lostReason: {
      count: jest.fn(async (a?: { where?: { ativo?: boolean } }) => motivos.filter((m) => (a?.where?.ativo ? m.ativo : true)).length),
      findUnique: jest.fn(async (a: { where: { id: string } }) => motivos.find((m) => m.id === a.where.id) ?? null),
      findMany: jest.fn(async () => motivos),
      findFirst: jest.fn(async () => null),
      aggregate: jest.fn(async () => ({ _max: { ordem: motivos.length - 1 } })),
      create: jest.fn(async (a: { data: Motivo }) => { log.push({ op: 'lostReason.create', args: a }); return { id: M2 }; }),
      update: jest.fn(async (a: unknown) => { log.push({ op: 'lostReason.update', args: a }); }),
      delete: jest.fn(async (a: unknown) => { log.push({ op: 'lostReason.delete', args: a }); }),
    },
    deal: {
      count: jest.fn(async () => opts.usos ?? 0),
      groupBy: jest.fn(async () => []),
      findUnique: jest.fn(async () => (opts.deal === undefined ? { id: D, titulo: 'Plano', status: 'aberto', contactId: null, camposCustom: {} } : opts.deal && { id: D, titulo: 'Plano', contactId: null, camposCustom: {}, ...opts.deal })),
      update: jest.fn(async (a: unknown) => { log.push({ op: 'deal.update', args: a }); }),
    },
    membership: { findUnique: jest.fn(async () => (opts.membro === false ? null : { id: 'm' })) },
    stage: { findUnique: jest.fn(async () => ({ id: 's' })) },
    activity: { create: jest.fn(async (a: unknown) => { log.push({ op: 'activity.create', args: a }); }) },
    $executeRaw: jest.fn(async (s: TemplateStringsArray, ...v: unknown[]) => {
      log.push({ op: 'executeRaw', args: { sql: s.join('?'), v } });
      motivos.push({ id: `seed-${motivos.length}`, nome: String(v[1]), ativo: true, ordem: Number(v[2]) });
      return 1;
    }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  return { tx, prisma, log, motivos };
}
const ativo = (id: string, nome: string, a = true): Motivo => ({ id, nome, ativo: a, ordem: 0 });

describe('Motivos de perda (Q2.1): catálogo', () => {
  it('primeira leitura semeia os 6 motivos padrão, na ordem, com ON CONFLICT (concorrência)', async () => {
    const { prisma, log } = fakeTx();
    const lista = await new LostReasonsService(prisma).listar(T);
    expect(lista.map((m) => m.nome)).toEqual([...MOTIVOS_PADRAO]);
    const sqls = log.filter((l) => l.op === 'executeRaw').map((l) => (l.args as { sql: string }).sql);
    expect(sqls).toHaveLength(6);
    expect(sqls.every((s) => s.includes('ON CONFLICT (tenant_id, lower(nome)) DO NOTHING'))).toBe(true);
  });

  it('tenant que já tem motivos (mesmo todos desativados) não é semeado de novo', async () => {
    const { tx, log } = fakeTx({ motivos: [ativo(M1, 'Preço', false)] });
    await garantirMotivosPadrao(tx as never, T);
    expect(log.filter((l) => l.op === 'executeRaw')).toHaveLength(0);
  });

  it('não apaga motivo em uso (desativar mantém o histórico) nem o último', async () => {
    const emUso = fakeTx({ motivos: [ativo(M1, 'Preço'), ativo(M2, 'Outro')], usos: 3 });
    await expect(new LostReasonsService(emUso.prisma).remover(T, M1)).rejects.toThrow(ConflictException);
    const ultimo = fakeTx({ motivos: [ativo(M1, 'Preço')], usos: 0 });
    await expect(new LostReasonsService(ultimo.prisma).remover(T, M1)).rejects.toThrow(/último motivo/);
    const ok = fakeTx({ motivos: [ativo(M1, 'Preço'), ativo(M2, 'Outro')], usos: 0 });
    await expect(new LostReasonsService(ok.prisma).remover(T, M1)).resolves.toEqual({ ok: true });
  });

  it('reordenar exige todos os motivos, uma vez cada', async () => {
    const { prisma } = fakeTx({ motivos: [ativo(M1, 'Preço'), ativo(M2, 'Outro')] });
    await expect(new LostReasonsService(prisma).reordenar(T, [M1])).rejects.toThrow(BadRequestException);
    await expect(new LostReasonsService(prisma).reordenar(T, [M2, M1])).resolves.toEqual({ ok: true });
  });

  it('nome e observação são saneados', () => {
    expect(limparNomeMotivo('  Sem   resposta ')).toBe('Sem resposta');
    expect(() => limparNomeMotivo('   ')).toThrow(BadRequestException);
    expect(() => limparNomeMotivo('x'.repeat(61))).toThrow(BadRequestException);
    expect(limparObsPerda('  ')).toBeNull();
    expect(limparObsPerda(undefined)).toBeUndefined();
    expect(() => limparObsPerda('x'.repeat(501))).toThrow(BadRequestException);
  });
});

describe('Motivos de perda (Q2.1): regra de obrigatoriedade', () => {
  it('com motivo ativo no tenant, perder sem motivo é 400', async () => {
    const { tx } = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await expect(resolverMotivoPerda(tx as never, T, undefined, true)).rejects.toThrow(/motivo de perda obrigatório/);
    await expect(resolverMotivoPerda(tx as never, T, null, true)).rejects.toThrow(/obrigatório/);
  });

  it('motivo desativado ou inexistente (outro tenant some pela RLS) é 400', async () => {
    const { tx } = fakeTx({ motivos: [ativo(M1, 'Preço', false)] });
    await expect(resolverMotivoPerda(tx as never, T, M1, true)).rejects.toThrow(/desativado/);
    await expect(resolverMotivoPerda(tx as never, T, M2, true)).rejects.toThrow(/inexistente/);
  });

  it('todos desativados: perder sem motivo passa; sistema (exigir=false) nunca exige', async () => {
    const { tx } = fakeTx({ motivos: [ativo(M1, 'Preço', false)] });
    await expect(resolverMotivoPerda(tx as never, T, undefined, true)).resolves.toBeNull();
    const comAtivo = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await expect(resolverMotivoPerda(comAtivo.tx as never, T, undefined, false)).resolves.toBeNull();
    await expect(resolverMotivoPerda(comAtivo.tx as never, T, M1, true)).resolves.toBe(M1);
  });
});

describe('PATCH do negócio com motivo de perda (Q2.1)', () => {
  const eventos = { publicar: jest.fn() } as unknown as DomainEventsService;
  const svc = (prisma: PrismaService) => new CrmService(prisma, eventos, { revalidarSeVencido: () => undefined } as unknown as AvatarContatoService);
  const gravado = (log: { op: string; args: unknown }[]) => (log.find((l) => l.op === 'deal.update')!.args as { data: Record<string, unknown> }).data;

  it('rota do usuário: marcar perdido sem motivo (há ativos) é 400 e não grava', async () => {
    const { prisma, log } = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await expect(svc(prisma).updateDeal(T, D, { status: 'perdido' }, { exigirMotivoPerda: true })).rejects.toThrow(BadRequestException);
    expect(log.some((l) => l.op === 'deal.update')).toBe(false);
  });

  it('com motivo: grava motivo + observação e a atividade cita o motivo', async () => {
    const { prisma, log } = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await svc(prisma).updateDeal(T, D, { status: 'perdido', motivoPerdaId: M1, motivoPerdaObs: ' achou caro ' }, { exigirMotivoPerda: true });
    expect(gravado(log)).toMatchObject({ status: 'perdido', motivoPerdaId: M1, motivoPerdaObs: 'achou caro' });
    const atv = log.find((l) => l.op === 'activity.create')!.args as { data: { acao: string } };
    expect(atv.data.acao).toContain('como perdido (Preço)');
  });

  it('proposta recusada (sistema, sem exigir) continua marcando perdido sem motivo', async () => {
    const { prisma, log } = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await svc(prisma).updateDeal(T, D, { status: 'perdido' });
    expect(gravado(log)).toMatchObject({ status: 'perdido', motivoPerdaId: null });
  });

  it('reabrir um perdido limpa motivo e observação', async () => {
    const { prisma, log } = fakeTx({ motivos: [ativo(M1, 'Preço')], deal: { status: 'perdido' } });
    await svc(prisma).updateDeal(T, D, { status: 'aberto' }, { exigirMotivoPerda: true });
    expect(gravado(log)).toMatchObject({ status: 'aberto', motivoPerdaId: null, motivoPerdaObs: null });
  });

  it('motivo em negócio aberto é 400; dono que não é membro é 400', async () => {
    const a = fakeTx({ motivos: [ativo(M1, 'Preço')] });
    await expect(svc(a.prisma).updateDeal(T, D, { motivoPerdaId: M1 }, { exigirMotivoPerda: true })).rejects.toThrow(/só vale para negócio perdido/);
    const b = fakeTx({ membro: false });
    await expect(svc(b.prisma).updateDeal(T, D, { ownerId: M2 }, { exigirMotivoPerda: true })).rejects.toThrow(/não é membro/);
  });
});

describe('PermissionsGuard: motivos de perda', () => {
  const u = (role: string) => ({ role, tenantId: T, identityId: 'i' }) as unknown as AuthUser;
  it.each([['owner', true], ['admin', true], ['manager', true], ['member', false], ['viewer', false]])('%s escreve? %s', (role, pode) => {
    expect(hasPermission(u(role), permissionFor('crm', 'lost-reasons', 'POST'))).toBe(pode);
    expect(hasPermission(u(role), permissionFor('crm', 'lost-reasons/:id', 'DELETE'))).toBe(pode);
    expect(hasPermission(u(role), permissionFor('crm', 'lost-reasons', 'GET'))).toBe(true);
  });
  it('bulk de negócios é pipeline.write', () => {
    expect(permissionFor('crm', 'deals/bulk', 'POST')).toBe('pipeline.write');
  });
});
