import { BlueprintService } from './blueprint.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MarketplaceService } from '../marketplace/marketplace.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

function amb(tenantRow: { nicho?: string | null; templateId?: string | null } = {}) {
  const tenantData = { nicho: tenantRow.nicho ?? 'Odontologia', templateId: tenantRow.templateId ?? null };
  const tx = {
    tenant: { findUnique: jest.fn(async () => tenantData), update: jest.fn(async () => ({})) },
    activity: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => unknown) => w(tx)) } as unknown as PrismaService;
  const crm = { createPipeline: jest.fn(async () => ({ id: 'pl1', nome: 'Funil Odontológico', etapas: [] })) } as unknown as CrmService;
  const marketplace = {
    listar: jest.fn(async () => [{ id: 'tpl1', name: 'Boas-vindas' }]),
    instalar: jest.fn(async () => ({ workflowId: 'wf1', nome: 'Boas-vindas' })),
  } as unknown as MarketplaceService;
  return { svc: new BlueprintService(prisma, crm, marketplace), crm, marketplace, tx };
}

describe('BlueprintService', () => {
  it('lista os playbooks disponíveis com tier de compliance', () => {
    const { svc } = amb();
    const l = svc.listar();
    expect(l.find((p) => p.id === 'saude.odontologia')?.tier).toBe(3);
    expect(l.find((p) => p.id === 'juridico.advocacia')?.tier).toBe(3);
    expect(l.find((p) => p.id === 'contabil.escritorio')?.tier).toBe(2);
  });

  it('sugere o blueprint pelo nicho do tenant', async () => {
    const { svc } = amb({ nicho: 'Advocacia trabalhista' });
    const s = await svc.sugerir(TENANT);
    expect(s.sugerido?.id).toBe('juridico.advocacia');
  });

  it('aplicar cria o funil do nicho, instala as automações e devolve os guardrails', async () => {
    const { svc, crm, marketplace } = amb();
    const r = await svc.aplicar(TENANT, 'ident1', 'saude.odontologia');
    expect(r.jaAplicado).toBe(false);
    expect((crm.createPipeline as jest.Mock)).toHaveBeenCalledWith(TENANT, { nome: 'Funil Odontológico', etapas: ['Novo lead', 'Qualificado', 'Aguardando pagamento', 'Agendado', 'Compareceu'] });
    expect((marketplace.instalar as jest.Mock)).toHaveBeenCalled();
    expect(r.compliance?.termosBloqueados).toContain('garantido');
    expect(r.dadosObrigatorios?.some((c) => c.chave === 'pix_key' && c.bloqueiaPublicacao)).toBe(true);
  });

  it('é idempotente: não reaplica se o tenant já tem o blueprint', async () => {
    const { svc, crm } = amb({ templateId: 'saude.odontologia' });
    const r = await svc.aplicar(TENANT, 'ident1', 'saude.odontologia');
    expect(r.jaAplicado).toBe(true);
    expect((crm.createPipeline as jest.Mock)).not.toHaveBeenCalled();
  });

  it('blueprint inexistente → 404', () => {
    const { svc } = amb();
    expect(() => svc.obter('nicho.inexistente')).toThrow(/inexistente/i);
  });
});
