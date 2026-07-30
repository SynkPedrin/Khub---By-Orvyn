import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { PLAYBOOKS, playbookPorNicho, type Playbook } from './playbooks';

/**
 * Provisionador de Blueprint (ADR-0022) — a Camada de Provisionamento, NATIVA.
 *
 * Aplica um playbook de nicho no CRM do tenant: cria o funil com as etapas certas
 * e instala as automações recomendadas. Reusa `CrmService.createPipeline` e
 * `MarketplaceService` (o motor que a Nyro configuradora já usa) — zero duplicação.
 * Idempotente: `tenant.templateId` registra o que já foi aplicado.
 */
@Injectable()
export class BlueprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly marketplace: MarketplaceService,
  ) {}

  /** Metadados de todos os playbooks (para a UI de onboarding). */
  listar() {
    return Object.values(PLAYBOOKS).map((p) => this.resumo(p));
  }

  obter(key: string): Playbook {
    const p = PLAYBOOKS[key];
    if (!p) throw new NotFoundException('blueprint inexistente');
    return p;
  }

  /** Sugestão pelo nicho do tenant (definido no signup). */
  async sugerir(tenantId: string) {
    const t = await this.prisma.withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { nicho: true, templateId: true } }));
    const pb = playbookPorNicho(t?.nicho ?? null);
    return { nicho: t?.nicho ?? null, sugerido: pb ? this.resumo(pb) : null, jaAplicado: t?.templateId ?? null };
  }

  async aplicar(tenantId: string, identityId: string, key: string) {
    const pb = this.obter(key);
    const t = await this.prisma.withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { templateId: true } }));
    if (t?.templateId === key) return { jaAplicado: true, blueprint: key };

    // 1. funil com as etapas do playbook
    const funil = await this.crm.createPipeline(tenantId, { nome: pb.funilNome, etapas: pb.etapas });

    // 2. instala as automações recomendadas (busca o melhor match no marketplace)
    const automacoes: { busca: string; instalado: boolean; nome?: string }[] = [];
    for (const busca of pb.automacoes) {
      const achados = await this.marketplace.listar(tenantId, { q: busca });
      if (achados.length) {
        const r = await this.marketplace.instalar(tenantId, identityId, achados[0].id);
        automacoes.push({ busca, instalado: true, nome: r.nome });
      } else {
        automacoes.push({ busca, instalado: false });
      }
    }

    // 3. marca o tenant (idempotência + rastreabilidade)
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { templateId: key, templateVersion: pb.versao } });
      await tx.activity.create({ data: { tenantId, actor: 'Nyro', acao: `configurou o CRM com o blueprint "${pb.nome}"`, tone: 'green' } });
    });

    return {
      jaAplicado: false,
      blueprint: pb.id,
      funil,
      automacoes,
      compliance: pb.compliance,       // guardrails do nicho (o gerador/validador respeita)
      dadosObrigatorios: pb.dadosObrigatorios, // gate de completude para o go-live
    };
  }

  private resumo(p: Playbook) {
    return {
      id: p.id, nome: p.nome, familia: p.familia, tier: p.tier, orgaoRegulador: p.orgaoRegulador,
      etapas: p.etapas, automacoes: p.automacoes, versao: p.versao,
    };
  }
}
