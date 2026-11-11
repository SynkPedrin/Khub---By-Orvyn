import { CrmService } from './crm.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { AvatarContatoService } from './messaging/avatar-contato.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function ambiente() {
  const criados: Record<string, unknown>[] = [];
  const tx = {
    contact: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { criados.push(data); return { id: 'c1', nome: data.nome }; }) },
    activity: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const eventos = { publicar: jest.fn() } as unknown as DomainEventsService;
  const svc = new CrmService(prisma, eventos, { revalidarSeVencido: () => undefined } as unknown as AvatarContatoService);
  return { svc, criados };
}

describe('CrmService.createContact — BUG-029 (origem do cadastro manual)', () => {
  it('grava a origem informada na coluna `contacts.origem`', async () => {
    const a = ambiente();
    await a.svc.createContact(TENANT, { nome: 'Ana', origem: ' Indicação ' });
    expect(a.criados[0]).toMatchObject({ origem: 'Indicação' });
  });

  it('sem origem: coluna nula (o outbox cai em "Manual")', async () => {
    const a = ambiente();
    await a.svc.createContact(TENANT, { nome: 'Ana' });
    expect(a.criados[0]).toMatchObject({ origem: null });
  });
});
