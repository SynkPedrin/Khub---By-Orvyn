import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { camposDe, validarCamposNaTransacao } from './custom-fields.service';

export interface CompanyInput {
  nome: string;
  dominio?: string;
  telefone?: string;
  endereco?: string;
  segmento?: string;
  tamanho?: string;
  site?: string;
  /** Campos personalizados (Q2.3): validados pelas definições; no update, mesclados. */
  camposCustom?: Record<string, unknown>;
}

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));

/** Empresas/contas (D1). Toda leitura e escrita dentro de `withTenant` (RLS). */
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, q?: string) {
    const termo = q?.trim();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.company.findMany({
        where: termo
          ? { OR: [{ nome: { contains: termo, mode: 'insensitive' } }, { dominio: { contains: termo, mode: 'insensitive' } }, { segmento: { contains: termo, mode: 'insensitive' } }] }
          : undefined,
        orderBy: { nome: 'asc' },
        include: { _count: { select: { contacts: true } } },
      });
      return rows.map((c) => ({
        id: c.id, nome: c.nome, dominio: c.dominio, telefone: c.telefone, segmento: c.segmento,
        tamanho: c.tamanho, site: c.site, contatos: c._count.contacts,
      }));
    });
  }

  /** Empresa + contatos + negócios em aberto do portfólio dela. */
  async get(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.company.findUnique({
        where: { id },
        include: {
          contacts: { select: { id: true, nome: true, email: true, telefone: true, tag: true }, orderBy: { nome: 'asc' } },
          notes: { orderBy: { createdAt: 'desc' } },
          tasks: { where: { status: 'aberta' }, orderBy: { dueAt: 'asc' } },
        },
      });
      if (!c) throw new NotFoundException('empresa inexistente');

      const contactIds = c.contacts.map((x) => x.id);
      const deals = contactIds.length
        ? await tx.deal.findMany({
            where: { contactId: { in: contactIds } },
            orderBy: { updatedAt: 'desc' },
            include: { stage: { select: { nome: true, cor: true } }, contact: { select: { nome: true } } },
          })
        : [];

      return {
        id: c.id, nome: c.nome, dominio: c.dominio, telefone: c.telefone, endereco: c.endereco,
        segmento: c.segmento, tamanho: c.tamanho, site: c.site, createdAt: c.createdAt,
        camposCustom: camposDe(c.camposCustom),
        contatos: c.contacts,
        negocios: deals.map((d) => ({ id: d.id, titulo: d.titulo, valor: num(d.valor), status: d.status, stage: d.stage?.nome ?? '', cor: d.stage?.cor ?? '#8b5cf6', contato: d.contact?.nome ?? null })),
        valorAberto: deals.filter((d) => d.status === 'aberto').reduce((s, d) => s + num(d.valor), 0),
        tarefas: c.tasks.map((t) => ({ id: t.id, titulo: t.titulo, status: t.status, prioridade: t.prioridade, dueAt: t.dueAt })),
        notas: c.notes.map((n) => ({ id: n.id, corpo: n.corpo, autor: n.authorNome, createdAt: n.createdAt })),
      };
    });
  }

  async create(tenantId: string, input: CompanyInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const dup = await tx.company.findFirst({ where: { nome: { equals: input.nome, mode: 'insensitive' } }, select: { id: true } });
      if (dup) throw new ConflictException('já existe uma empresa com esse nome');
      const camposCustom = input.camposCustom
        ? await validarCamposNaTransacao(tx, 'company', input.camposCustom, { exigirObrigatorios: true })
        : undefined;
      const c = await tx.company.create({
        data: {
          tenantId,
          ...(camposCustom ? { camposCustom: camposCustom as Prisma.InputJsonValue } : {}),
          nome: input.nome,
          dominio: input.dominio ?? null,
          telefone: input.telefone ?? null,
          endereco: input.endereco ?? null,
          segmento: input.segmento ?? null,
          tamanho: input.tamanho ?? null,
          site: input.site ?? null,
        },
        select: { id: true },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `cadastrou a empresa "${input.nome}"`, tone: 'neutral' } });
      return { id: c.id };
    });
  }

  async update(tenantId: string, id: string, input: Partial<CompanyInput>) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.company.findUnique({ where: { id }, select: { nome: true, camposCustom: true } });
      if (!atual) throw new NotFoundException('empresa inexistente');
      const camposCustom = input.camposCustom
        ? await validarCamposNaTransacao(tx, 'company', input.camposCustom, { atuais: camposDe(atual.camposCustom), exigirObrigatorios: true })
        : undefined;
      if (input.nome && input.nome.toLowerCase() !== atual.nome.toLowerCase()) {
        const dup = await tx.company.findFirst({ where: { nome: { equals: input.nome, mode: 'insensitive' } }, select: { id: true } });
        if (dup) throw new ConflictException('já existe uma empresa com esse nome');
      }
      await tx.company.update({
        where: { id },
        data: {
          nome: input.nome ?? undefined,
          dominio: input.dominio === undefined ? undefined : input.dominio || null,
          telefone: input.telefone === undefined ? undefined : input.telefone || null,
          endereco: input.endereco === undefined ? undefined : input.endereco || null,
          segmento: input.segmento === undefined ? undefined : input.segmento || null,
          tamanho: input.tamanho === undefined ? undefined : input.tamanho || null,
          site: input.site === undefined ? undefined : input.site || null,
          camposCustom: (camposCustom as Prisma.InputJsonValue | undefined) ?? undefined,
          updatedAt: new Date(),
        },
      });
      return { ok: true };
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.company.findUnique({ where: { id }, select: { nome: true } });
      if (!c) throw new NotFoundException('empresa inexistente');
      // contatos NÃO caem junto: company_id vira NULL (a pessoa continua no CRM).
      await tx.company.delete({ where: { id } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `excluiu a empresa "${c.nome}"`, tone: 'warn' } });
      return { ok: true };
    });
  }
}
