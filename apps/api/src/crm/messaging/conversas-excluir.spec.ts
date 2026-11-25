import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversasService } from './conversas.service';
import { hasPermission, permissionFor } from '../../auth/permissions.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DomainEventsService } from '../../events/domain-events.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function ambiente(existentes: { id: string; nome: string; canal: string; contactId: string | null }[], msgs: Record<string, number> = {}) {
  const audit: Record<string, unknown>[] = [];
  const tx = {
    conversation: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => existentes.filter((c) => where.id.in.includes(c.id))),
      deleteMany: jest.fn(async () => ({ count: existentes.length })),
    },
    $queryRaw: jest.fn(async () => Object.entries(msgs).map(([conversation_id, n]) => ({ conversation_id, total: BigInt(n) }))),
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ...p: unknown[]) => { audit.push(JSON.parse(String(p[3]))); return 1; }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const publicados: Record<string, unknown>[] = [];
  const eventos = { publicar: jest.fn((_t: string, _e: string, d: Record<string, unknown>) => publicados.push(d)) } as unknown as DomainEventsService;
  return { svc: new ConversasService(prisma, eventos), tx, audit, publicados };
}

describe('excluir conversas', () => {
  it('apaga só as que existem no tenant, audita sem conteúdo e avisa as telas', async () => {
    const a = ambiente([{ id: 'c1', nome: 'Ana', canal: 'WhatsApp', contactId: 'k1' }], { c1: 12 });
    const r = await a.svc.excluir(TENANT, ['c1', 'c1', 'c-de-outro-tenant'], 'id-gestor');
    expect(r).toEqual({ excluidas: 1, ids: ['c1'], mensagens: 12 });
    expect(a.tx.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } } });
    expect(a.audit).toEqual([{ nome: 'Ana', canal: 'WhatsApp', contactId: 'k1', mensagens: 12 }]);
    expect(a.publicados).toEqual([{ id: 'c1', excluida: true }]);
  });

  it('nenhuma encontrada = 404; lista vazia = 400', async () => {
    const a = ambiente([]);
    await expect(a.svc.excluir(TENANT, ['x'], 'i')).rejects.toBeInstanceOf(NotFoundException);
    await expect(a.svc.excluir(TENANT, [], 'i')).rejects.toBeInstanceOf(BadRequestException);
    expect(a.tx.conversation.deleteMany).not.toHaveBeenCalled();
  });

  it('excluir é de gestor+; atendente só responde', () => {
    const u = (role: string) => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
    const um = permissionFor('crm', 'conversations/:id', 'DELETE');
    const lote = permissionFor('crm', 'conversations/excluir', 'POST');
    expect(um).toBe('conversations.delete');
    expect(lote).toBe('conversations.delete');
    expect(hasPermission(u('manager'), um)).toBe(true);
    expect(hasPermission(u('admin'), lote)).toBe(true);
    expect(hasPermission(u('member'), um)).toBe(false);
    expect(hasPermission(u('viewer'), lote)).toBe(false);
    // iniciar conversa continua sendo de quem atende
    expect(permissionFor('crm', 'conversations', 'POST')).toBe('conversations.reply');
  });
});
