import { TasksService } from './tasks.service';
import type { PrismaService } from '../prisma/prisma.service';

function ambiente() {
  const uuidCols = ['assigneeId', 'createdBy'];
  const tx = {
    contact: { findUnique: jest.fn(async () => ({ id: 'c1' })) },
    deal: { findUnique: jest.fn(async () => ({ id: 'd1' })) },
    company: { findUnique: jest.fn(async () => ({ id: 'co1' })) },
    // O Prisma real rejeita '' em coluna uuid ("Error creating UUID"): reproduz isso para não mascarar o defeito.
    task: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      for (const c of uuidCols) if (data[c] === '') throw Object.assign(new Error('Error creating UUID, invalid length'), { code: 'P2023' });
      return { id: 't1' };
    }) },
    activity: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  return { tx, svc: new TasksService(prisma) };
}

describe('TasksService.create', () => {
  it('usuário humano: responsável e autor são a identidade', async () => {
    const { svc, tx } = ambiente();
    await svc.create('t1', 'id-ana', { titulo: 'Ligar', contactId: 'c1' });
    expect(tx.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'id-ana', createdBy: 'id-ana' }) }));
    expect(tx.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actor: 'Você' }) }));
  });

  it('REGRESSÃO: tarefa de automação (identityId vazio) grava responsável/autor nulos e autor "Automação"', async () => {
    const { svc, tx } = ambiente();
    await expect(svc.create('t1', '', { titulo: 'Follow-up', contactId: 'c1' })).resolves.toEqual({ id: 't1' });
    expect(tx.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: null, createdBy: null }) }));
    expect(tx.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actor: 'Automação' }) }));
  });

  it('responsável explícito prevalece sobre o autor', async () => {
    const { svc, tx } = ambiente();
    await svc.create('t1', 'id-ana', { titulo: 'Revisar', assigneeId: 'id-bia' });
    expect(tx.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'id-bia', createdBy: 'id-ana' }) }));
  });
});
