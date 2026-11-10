import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { acharContatoPorTelefone } from './telefone';

/** Lead vindo de fora (Meta Lead Ads hoje; TikTok/Google no Sprint B). */
export interface LeadExterno {
  nome?: string;
  email?: string;
  telefone?: string;
  origem: string;
  externalId: string;
  campos?: Record<string, string>;
  criadoEm?: Date;
}
export interface LeadResultado {
  contactId: string;
  criado: boolean;
}

/**
 * Ingestão de lead externo → contato (D1). Fica no CRM de propósito: quem sabe
 * criar contato é o CRM; quem tem a credencial da Meta é `integrations`. Assim
 * `integrations` depende do CRM (superfície pública), e não o contrário.
 */
@Injectable()
export class LeadsService {
  private readonly log = new Logger('Leads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  /**
   * Idempotente por natureza: o mesmo lead reprocessado atualiza o contato em
   * vez de duplicar (o webhook da Meta pode reentregar). Dedupe por e-mail ou
   * telefone — dentro do tenant, via RLS.
   */
  async upsertFromLead(tenantId: string, lead: LeadExterno): Promise<LeadResultado> {
    const r = await this.gravar(tenantId, lead);
    // Lead novo dispara o gatilho "Contato criado" (com a origem certa, para o
    // fluxo poder filtrar por "Meta Lead Ads"). Contato que já existia não
    // dispara: seria disparar de novo por alguém que já está no funil.
    if (r.criado) {
      this.eventos.publicar(tenantId, 'contact.created', { id: r.contactId, nome: r.nome, origem: lead.origem });
    }
    return { contactId: r.contactId, criado: r.criado };
  }

  private async gravar(tenantId: string, lead: LeadExterno): Promise<LeadResultado & { nome: string }> {
    const email = lead.email?.trim().toLowerCase() || null;
    const telefone = lead.telefone?.trim() || null;
    const nome = lead.nome?.trim() || email || telefone || 'Lead sem nome';

    return this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await this.acharExistente(tx, email, telefone);

      const camposCustom = {
        ...(lead.campos ?? {}),
        lead_origem: lead.origem,
        lead_external_id: lead.externalId,
      } as Prisma.InputJsonValue;

      if (existente) {
        // lead repetido de quem já é contato: enriquece, não duplica
        await tx.contact.update({
          where: { id: existente.id },
          data: {
            email: existente.email ?? email,
            telefone: existente.telefone ?? telefone,
            ultimoContatoAt: lead.criadoEm ?? new Date(),
            camposCustom: { ...(existente.camposCustom as object), ...(lead.campos ?? {}), lead_origem: lead.origem, lead_external_id: lead.externalId } as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });
        await tx.activity.create({
          data: { tenantId, actor: lead.origem, acao: `novo lead de ${lead.origem} para o contato existente "${existente.nome}"`, tone: 'neutral', contactId: existente.id },
        });
        this.log.log(`lead ${lead.externalId} (${lead.origem}) -> contato existente ${existente.id}`);
        return { contactId: existente.id, criado: false, nome: existente.nome };
      }

      const c = await tx.contact.create({
        data: {
          tenantId,
          nome,
          email,
          telefone,
          tag: 'Lead',
          // coluna `origem` (BUG-027): é o que a lista de contatos, os filtros e o
          // gatilho "Contato criado" leem; `campos_custom.lead_origem` fica como rastro.
          origem: lead.origem,
          camposCustom,
          ultimoContatoAt: lead.criadoEm ?? new Date(),
        },
        select: { id: true },
      });
      await tx.activity.create({
        data: { tenantId, actor: lead.origem, acao: `novo lead: "${nome}"`, tone: 'success', contactId: c.id },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'sistema', 'lead.ingest', 'contact', ${c.id}, ${JSON.stringify({ origem: lead.origem, externalId: lead.externalId })}::jsonb)`;
      this.log.log(`lead ${lead.externalId} (${lead.origem}) -> contato novo ${c.id}`);
      return { contactId: c.id, criado: true, nome };
    });
  }

  private async acharExistente(tx: Prisma.TransactionClient, email: string | null, telefone: string | null) {
    if (email) {
      const porEmail = await tx.contact.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, nome: true, email: true, telefone: true, camposCustom: true } });
      if (porEmail) return porEmail;
    }
    if (telefone) {
      // mesmo conceito de "mesma pessoa" que o inbox usa (helper único):
      // buscar todos e comparar em JS era O(n) e podia divergir do inbox
      const id = await acharContatoPorTelefone(tx, telefone);
      if (id) return tx.contact.findUnique({ where: { id }, select: { id: true, nome: true, email: true, telefone: true, camposCustom: true } });
    }
    return null;
  }
}
