import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_STAGES: [string, number, string][] = [
  ['Captação', 0, '#9B4DE0'],
  ['Qualificação', 1, '#7B2FBE'],
  ['Proposta', 2, '#5B1E9E'],
  ['Negociação', 3, '#B7791F'],
  ['Fechado / Ganho', 4, '#1E8449'],
];

export interface ProvisionInput {
  identityId: string;
  email: string;
  nome: string;
  empresa?: string;
  nicho?: string;
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria tenant + membership owner + perfil + funil default. Atômico por tenant. */
  async provision(input: ProvisionInput): Promise<{ id: string; nome: string }> {
    // tenants não tem RLS; INSERT liberado ao khub_app (db/004).
    const tenant = await this.prisma.tenant.create({
      data: { nome: input.empresa?.trim() || 'Minha Empresa', plano: 'starter', status: 'active', nicho: input.nicho ?? null },
      select: { id: true, nome: true },
    });

    await this.prisma.membership.create({
      data: { identityId: input.identityId, tenantId: tenant.id, role: 'owner', isDefault: true },
    });

    // dados do tenant sob RLS
    await this.prisma.withTenant(tenant.id, async (tx) => {
      await tx.user.create({ data: { tenantId: tenant.id, identityId: input.identityId, email: input.email, nome: input.nome, role: 'owner' } });
      const pl = await tx.pipeline.create({ data: { tenantId: tenant.id, nome: 'Funil de Vendas', tipo: 'vendas' } });
      for (const [nome, ordem, cor] of DEFAULT_STAGES) {
        await tx.stage.create({ data: { tenantId: tenant.id, pipelineId: pl.id, nome, ordem, cor } });
      }
      await tx.activity.create({ data: { tenantId: tenant.id, actor: 'Sistema', acao: 'conta criada e funil provisionado', tone: 'green' } });
      await tx.$executeRaw`
        INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade)
        VALUES (${tenant.id}::uuid, 'sistema', ${input.identityId}, 'tenant.provision', 'tenant')`;
    });

    return tenant;
  }

  async myTenant(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, nome: true, plano: true, status: true, nicho: true, subespecialidade: true },
    });
  }

  async membershipsOf(identityId: string) {
    const ms = await this.prisma.membership.findMany({ where: { identityId }, orderBy: { isDefault: 'desc' } });
    return ms.map((m) => ({ tenantId: m.tenantId, role: m.role, isDefault: m.isDefault }));
  }
}
