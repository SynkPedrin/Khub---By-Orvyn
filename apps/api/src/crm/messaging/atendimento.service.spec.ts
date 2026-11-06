import { BadRequestException } from '@nestjs/common';
import { AtendimentoService } from './atendimento.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DomainEventsService } from '../../events/domain-events.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function ambiente(o: { membros?: string[]; cargas?: Record<string, number>; conv?: { assigneeId: string | null } | null; agente?: { id: string } | null } = {}) {
  const auditados: string[] = [];
  const tx = {
    user: {
      findMany: jest.fn(async () => (o.membros ?? ['id-ana', 'id-bia', 'id-caio']).map((id) => ({ identityId: id, nome: id, email: `${id}@ex.com`, role: 'member' }))),
      findFirst: jest.fn(async ({ where }: { where: { identityId: string } }) => ((o.membros ?? ['id-ana', 'id-bia', 'id-caio']).includes(where.identityId) ? { identityId: where.identityId } : null)),
    },
    conversation: {
      findUnique: jest.fn(async () => (o.conv === null ? null : { id: 'cv1', assigneeId: null, atendimento: 'ia', ...o.conv })),
      groupBy: jest.fn(async () => Object.entries(o.cargas ?? {}).map(([assigneeId, n]) => ({ assigneeId, _count: { _all: n } }))),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cv1', agentId: null, handoffMotivo: null, assigneeId: null, ...data })),
    },
    agent: { findFirst: jest.fn(async () => (o.agente === undefined ? { id: 'ag1' } : o.agente)) },
    $executeRaw: jest.fn(async (s: TemplateStringsArray, ...p: unknown[]) => { auditados.push(String(p[3])); return 1; }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const publicados: { evento: string; dados: Record<string, unknown> }[] = [];
  const eventos = { publicar: jest.fn((_t: string, evento: string, dados: Record<string, unknown>) => publicados.push({ evento, dados })) } as unknown as DomainEventsService;
  return { svc: new AtendimentoService(prisma, eventos), tx, publicados, auditados };
}

describe('AtendimentoService — distribuição', () => {
  it('transferência da IA vai para o atendente com MENOS conversas humanas abertas', async () => {
    const a = ambiente({ cargas: { 'id-ana': 5, 'id-bia': 1, 'id-caio': 3 } });
    const e = await a.svc.transferirParaHumano(TENANT, 'cv1', 'contato pediu uma pessoa', { tipo: 'ia', agentId: 'ag1' });
    expect(e).toMatchObject({ atendimento: 'humano', assigneeId: 'id-bia', handoffMotivo: 'contato pediu uma pessoa' });
  });

  it('empate decide de forma determinística (menor identityId)', async () => {
    const a = ambiente({ cargas: { 'id-ana': 2, 'id-bia': 2, 'id-caio': 2 } });
    const e = await a.svc.transferirParaHumano(TENANT, 'cv1', 'x', { tipo: 'sistema' });
    expect(e.assigneeId).toBe('id-ana');
  });

  it('conversa que já tem responsável continua com ele', async () => {
    const a = ambiente({ conv: { assigneeId: 'id-caio' }, cargas: { 'id-ana': 0 } });
    const e = await a.svc.transferirParaHumano(TENANT, 'cv1', 'x', { tipo: 'ia', agentId: 'ag1' });
    expect(e.assigneeId).toBe('id-caio');
  });

  it('sem atendentes cadastrados: fica com humano, sem responsável (fila)', async () => {
    const a = ambiente({ membros: [] });
    const e = await a.svc.transferirParaHumano(TENANT, 'cv1', 'x', { tipo: 'sistema' });
    expect(e).toMatchObject({ atendimento: 'humano', assigneeId: null });
  });

  it('só considera papéis que atendem (viewer fica de fora)', async () => {
    const a = ambiente();
    await a.svc.transferirParaHumano(TENANT, 'cv1', 'x', { tipo: 'sistema' });
    expect(a.tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ['owner', 'admin', 'manager', 'member'] } }) }));
  });

  it('toda mudança vai para o audit_log e é publicada para a tela', async () => {
    const a = ambiente();
    await a.svc.transferirParaHumano(TENANT, 'cv1', 'x', { tipo: 'ia', agentId: 'ag1' });
    expect(a.auditados).toContain('conversa.transferida');
    expect(a.publicados[0]).toMatchObject({ evento: 'conversation.updated', dados: { id: 'cv1', atendimento: 'humano' } });
  });
});

describe('AtendimentoService — ações do Inbox', () => {
  it('assumir: humano vira o responsável', async () => {
    const a = ambiente();
    await expect(a.svc.assumir(TENANT, 'cv1', 'id-ana')).resolves.toMatchObject({ atendimento: 'humano', assigneeId: 'id-ana' });
  });

  it('devolver para a IA sem agente ativo → 400', async () => {
    const a = ambiente({ agente: null });
    await expect(a.svc.devolverParaIa(TENANT, 'cv1', 'id-ana')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolver para a IA limpa o responsável e o motivo', async () => {
    const a = ambiente();
    await expect(a.svc.devolverParaIa(TENANT, 'cv1', 'id-ana', 'ag1')).resolves.toMatchObject({ atendimento: 'ia', agentId: 'ag1', assigneeId: null });
  });

  it('atribuir a quem não é atendente da conta → 400', async () => {
    const a = ambiente();
    await expect(a.svc.atribuir(TENANT, 'cv1', 'id-intruso', 'id-ana')).rejects.toThrow('não é atendente');
  });

  it('conversa nova: IA só se houver agente padrão ATIVO no canal', async () => {
    const com = ambiente();
    await expect(com.svc.estadoInicial(com.tx as never, 'WhatsApp')).resolves.toEqual({ atendimento: 'ia', agentId: 'ag1' });
    expect(com.tx.agent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { padrao: true, status: 'ativo', canais: { has: 'WhatsApp' } } }));
    const sem = ambiente({ agente: null });
    await expect(sem.svc.estadoInicial(sem.tx as never, 'WhatsApp')).resolves.toEqual({ atendimento: 'humano', agentId: null });
  });
});
