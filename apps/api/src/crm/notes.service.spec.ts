import { NotesService } from './notes.service';
import type { PrismaService } from '../prisma/prisma.service';

function ambiente() {
  const tx = {
    // O Prisma real rejeita UUID vazio (`Error creating UUID`): reproduz isso para não mascarar o defeito.
    user: { findFirst: jest.fn(async ({ where }: { where: { identityId: string } }) => {
      if (!where.identityId) throw Object.assign(new Error('Error creating UUID, invalid length'), { code: 'P2023' });
      return { nome: 'Ana' };
    }) },
    note: { create: jest.fn(async () => ({ id: 'n1', createdAt: new Date() })) },
    activity: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  return { tx, svc: new NotesService(prisma) };
}

describe('NotesService.create', () => {
  it('autor humano: grava authorId e o nome como snapshot', async () => {
    const { svc, tx } = ambiente();
    await svc.create('t1', 'id-ana', { corpo: 'oi', contactId: 'c1' });
    expect(tx.note.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorId: 'id-ana', authorNome: 'Ana' }) }));
  });

  it('REGRESSÃO: nota de automação (identityId vazio) não consulta usuário e grava autor "Automação"', async () => {
    const { svc, tx } = ambiente();
    await expect(svc.create('t1', '', { corpo: 'follow-up', contactId: 'c1' })).resolves.toMatchObject({ id: 'n1' });
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.note.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorId: null, authorNome: 'Automação' }) }));
    expect(tx.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actor: 'Automação' }) }));
  });

  it('exige contato, negócio ou empresa', async () => {
    const { svc } = ambiente();
    await expect(svc.create('t1', 'id-ana', { corpo: 'x' })).rejects.toThrow('ligada a um contato');
  });
});
