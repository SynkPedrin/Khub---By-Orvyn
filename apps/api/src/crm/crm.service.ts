import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));

export interface CreateContactInput {
  nome: string;
  email?: string;
  telefone?: string;
  empresa?: string;
  tag?: string;
  valorEstimado?: number;
}
export interface CreateDealInput {
  titulo: string;
  contactId?: string;
  stageId: string;
  valor?: number;
  origem?: string;
}

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [stages, deals, contactsCount, atividades, contatosRecentes] = await Promise.all([
        tx.stage.findMany({ orderBy: { ordem: 'asc' } }),
        tx.deal.findMany({ include: { contact: true } }),
        tx.contact.count(),
        tx.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
        tx.contact.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);

      const valorFunil = deals.reduce((s, d) => s + num(d.valor), 0);
      const ultima = stages[stages.length - 1];
      const ganho = deals.filter((d) => d.stageId === ultima?.id).reduce((s, d) => s + num(d.valor), 0);

      const funil = stages.map((s) => {
        const ds = deals.filter((d) => d.stageId === s.id);
        return { id: s.id, nome: s.nome, cor: s.cor, total: ds.length, valor: ds.reduce((a, d) => a + num(d.valor), 0) };
      });

      return {
        kpis: {
          contatos: contactsCount,
          negocios: deals.length,
          valorFunil,
          ganho,
          conversao: deals.length ? Math.round((funil[funil.length - 1]?.total / deals.length) * 100) : 0,
        },
        funil,
        atividades: atividades.map((a) => ({ actor: a.actor, acao: a.acao, tone: a.tone })),
        contatosRecentes: contatosRecentes.map((c) => ({ id: c.id, nome: c.nome, tag: c.tag, valor: num(c.valorEstimado) })),
      };
    });
  }

  async listContacts(tenantId: string, q?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.contact.findMany({
        where: q
          ? { OR: [{ nome: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { tag: { contains: q, mode: 'insensitive' } }] }
          : undefined,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((c) => ({
        id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa,
        tag: c.tag, valor: num(c.valorEstimado), ultimoContatoAt: c.ultimoContatoAt,
      }));
    });
  }

  async createContact(tenantId: string, input: CreateContactInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.create({
        data: {
          tenantId,
          nome: input.nome,
          email: input.email ?? null,
          telefone: input.telefone ?? null,
          empresa: input.empresa ?? null,
          tag: input.tag ?? 'Lead',
          valorEstimado: input.valorEstimado ?? 0,
          ultimoContatoAt: new Date(),
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `adicionou o contato ${c.nome}`, tone: 'neutral' } });
      return { id: c.id };
    });
  }

  async pipeline(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [stages, deals] = await Promise.all([
        tx.stage.findMany({ orderBy: { ordem: 'asc' } }),
        tx.deal.findMany({ include: { contact: true }, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        stages: stages.map((s) => ({
          id: s.id, nome: s.nome, cor: s.cor,
          deals: deals
            .filter((d) => d.stageId === s.id)
            .map((d) => ({ id: d.id, titulo: d.titulo, contato: d.contact?.nome ?? '—', valor: num(d.valor), origem: d.origem ?? '' })),
        })),
      };
    });
  }

  async createDeal(tenantId: string, input: CreateDealInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const stage = await tx.stage.findUnique({ where: { id: input.stageId } });
      if (!stage) throw new NotFoundException('stage inexistente');
      const d = await tx.deal.create({
        data: {
          tenantId, titulo: input.titulo, contactId: input.contactId ?? null,
          pipelineId: stage.pipelineId, stageId: stage.id, valor: input.valor ?? 0, origem: input.origem ?? null,
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `criou o negócio "${d.titulo}"`, tone: 'neutral' } });
      return { id: d.id };
    });
  }

  async moveDeal(tenantId: string, dealId: string, stageId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const stage = await tx.stage.findUnique({ where: { id: stageId } });
      if (!stage) throw new NotFoundException('stage inexistente');
      const res = await tx.deal.updateMany({ where: { id: dealId }, data: { stageId, updatedAt: new Date() } });
      if (res.count === 0) throw new NotFoundException('negócio inexistente');
      const d = await tx.deal.findUnique({ where: { id: dealId } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `moveu "${d?.titulo}" para ${stage.nome}`, tone: 'neutral' } });
      return { ok: true };
    });
  }

  async listConversations(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      return rows.map((c) => ({
        id: c.id, nome: c.nome, canal: c.canal, ultimaPrevia: c.ultimaPrevia, naoLidas: c.naoLidas, ultimaHora: c.ultimaHora,
        mensagens: c.messages.map((m) => ({ id: m.id, de: m.autorTipo, texto: m.corpo, hora: m.hora })),
      }));
    });
  }
}
