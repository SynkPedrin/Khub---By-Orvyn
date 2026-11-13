import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { acharContatoPorTelefone } from './telefone';
import { limparTags } from './crm.service';
import { camposDe, validarCamposNaTransacao } from './custom-fields.service';

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
 * Captura de contato por página PÚBLICA (formulário /f, agendamento /b — Q4.1/Q4.2).
 * Os valores já chegam validados por campo; os personalizados passam de novo
 * pelo validador das definições (Q2.3) aqui dentro.
 */
export interface CapturaContato {
  /** Ex.: "Formulário: Contato do site", "Agendamento online". Vai para `contacts.origem`. */
  origem: string;
  nome?: string | null;
  email?: string | null;
  /** Dígitos com DDI (ver normalizarTelefoneBR). */
  telefone?: string | null;
  empresa?: string | null;
  /** Patch de campos personalizados do contato (mesclado; não exige obrigatórios). */
  camposCustom?: Record<string, unknown>;
  tags?: string[];
  /** Consentimento LGPD dado AGORA (caixa marcada). Ausente = não mexe no registrado. */
  consentimento?: { baseLegal: string; origem: string; texto?: string } | null;
}
export interface CapturaResultado {
  contactId: string;
  criado: boolean;
  tagsAdicionadas: string[];
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
          // coluna `origem` (BUG-029): é o que a lista de contatos, os filtros e o
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

  /**
   * Cria ou atualiza o contato vindo de página pública, com o MESMO conceito de
   * "mesma pessoa" do inbox e da importação (e-mail, senão telefone pelos 8
   * últimos dígitos — BUG-012). Existente: completa só o que está vazio, mescla
   * campos personalizados, soma tags; nunca sobrescreve nome/e-mail/telefone.
   * Tag nova sai como `contact.tagged` pelo trigger do outbox (db/022), por isso
   * o contato novo nasce sem tags e recebe-as num UPDATE no mesmo commit.
   */
  async capturar(tenantId: string, input: CapturaContato): Promise<CapturaResultado> {
    const email = input.email?.trim().toLowerCase() || null;
    const telefone = input.telefone?.trim() || null;
    if (!email && !telefone) throw new BadRequestException('informe e-mail ou telefone');
    const nome = input.nome?.trim().slice(0, 160) || email || telefone || 'Contato';
    const empresa = input.empresa?.trim().slice(0, 160) || null;
    const origem = input.origem.trim().slice(0, 80) || 'Página pública';
    const tags = limparTags(input.tags ?? []);
    const temCampos = !!input.camposCustom && Object.keys(input.camposCustom).length > 0;
    const consentimento = input.consentimento
      ? { baseLegal: input.consentimento.baseLegal, origem: input.consentimento.origem, texto: input.consentimento.texto?.slice(0, 1000) ?? null, consentidoEm: new Date().toISOString() }
      : null;

    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await this.acharExistente(tx, email, telefone);
      let contactId: string;
      let criado: boolean;
      let tagsAntes: string[] = [];
      let nomeFinal = nome;
      if (existente) {
        const atual = await tx.contact.findUnique({ where: { id: existente.id }, select: { tags: true, camposCustom: true, empresa: true } });
        const campos = temCampos ? await validarCamposNaTransacao(tx, 'contact', input.camposCustom!, { atuais: camposDe(atual?.camposCustom) }) : undefined;
        tagsAntes = atual?.tags ?? [];
        const antes = new Set(tagsAntes.map((t) => t.toLowerCase()));
        await tx.contact.update({
          where: { id: existente.id },
          data: {
            email: existente.email ?? email,
            telefone: existente.telefone ?? telefone,
            empresa: atual?.empresa ?? empresa,
            ultimoContatoAt: new Date(),
            ...(campos ? { camposCustom: campos as Prisma.InputJsonValue } : {}),
            ...(tags.some((t) => !antes.has(t.toLowerCase())) ? { tags: limparTags([...tagsAntes, ...tags]) } : {}),
            ...(consentimento ? { consentimento: consentimento as Prisma.InputJsonValue } : {}),
            updatedAt: new Date(),
          },
        });
        await tx.activity.create({ data: { tenantId, actor: origem, acao: `novo envio de ${origem} para o contato existente "${existente.nome}"`, tone: 'neutral', contactId: existente.id } });
        contactId = existente.id;
        criado = false;
        nomeFinal = existente.nome;
      } else {
        const campos = temCampos ? await validarCamposNaTransacao(tx, 'contact', input.camposCustom!, { atuais: {} }) : undefined;
        const c = await tx.contact.create({
          data: {
            tenantId, nome, email, telefone, empresa, tag: 'Lead', origem,
            ...(campos ? { camposCustom: campos as Prisma.InputJsonValue } : {}),
            ...(consentimento ? { consentimento: consentimento as Prisma.InputJsonValue } : {}),
            ultimoContatoAt: new Date(),
          },
          select: { id: true },
        });
        if (tags.length) await tx.contact.update({ where: { id: c.id }, data: { tags } });
        await tx.activity.create({ data: { tenantId, actor: origem, acao: `novo lead: "${nome}"`, tone: 'success', contactId: c.id } });
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, acao, entidade, entidade_id, payload)
          VALUES (${tenantId}::uuid, 'sistema', 'lead.ingest', 'contact', ${c.id}, ${JSON.stringify({ origem })}::jsonb)`;
        contactId = c.id;
        criado = true;
      }
      const antes = new Set(tagsAntes.map((t) => t.toLowerCase()));
      const tagsAdicionadas = tags.filter((t) => !antes.has(t.toLowerCase()));
      for (const tag of tagsAdicionadas) {
        await tx.$executeRaw`INSERT INTO crm_tags (tenant_id, name) VALUES (${tenantId}::uuid, ${tag}) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`;
      }
      if (consentimento) {
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
          VALUES (${tenantId}::uuid, 'sistema', 'pagina_publica', 'contato.consentimento_registrado', 'contact', ${contactId}, ${JSON.stringify(consentimento)}::jsonb)`;
      }
      return { contactId, criado, tagsAdicionadas, nome: nomeFinal };
    });

    if (r.criado) this.eventos.publicar(tenantId, 'contact.created', { id: r.contactId, nome: r.nome, origem });
    for (const tag of r.tagsAdicionadas) this.eventos.publicar(tenantId, 'contact.tagged', { id: r.contactId, tag });
    return { contactId: r.contactId, criado: r.criado, tagsAdicionadas: r.tagsAdicionadas };
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
