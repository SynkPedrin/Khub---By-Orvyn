import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TaskInput {
  titulo: string;
  descricao?: string;
  prioridade?: string;
  dueAt?: string;
  contactId?: string;
  dealId?: string;
  companyId?: string;
  assigneeId?: string;
}
export type TaskFilter = 'todas' | 'abertas' | 'concluidas' | 'hoje' | 'atrasadas';

/** Tarefas (D1). Vínculo opcional com contato/negócio/empresa. */
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, filtro: TaskFilter = 'abertas') {
    const agora = new Date();
    const fimDoDia = new Date(agora);
    fimDoDia.setHours(23, 59, 59, 999);

    const where =
      filtro === 'concluidas' ? { status: 'concluida' }
      : filtro === 'hoje' ? { status: 'aberta', dueAt: { lte: fimDoDia } }
      : filtro === 'atrasadas' ? { status: 'aberta', dueAt: { lt: agora } }
      : filtro === 'abertas' ? { status: 'aberta' }
      : {};

    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.task.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 200,
        include: { contact: { select: { id: true, nome: true } }, deal: { select: { id: true, titulo: true } } },
      });
      return rows.map((t) => ({
        id: t.id, titulo: t.titulo, descricao: t.descricao, status: t.status, prioridade: t.prioridade,
        dueAt: t.dueAt, atrasada: t.status === 'aberta' && !!t.dueAt && t.dueAt < agora,
        contato: t.contact, negocio: t.deal, completedAt: t.completedAt,
      }));
    });
  }

  async create(tenantId: string, identityId: string, input: TaskInput) {
    const dueAt = parseData(input.dueAt);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.validarVinculos(tx, input);
      const t = await tx.task.create({
        data: {
          tenantId,
          titulo: input.titulo,
          descricao: input.descricao ?? null,
          prioridade: input.prioridade ?? 'media',
          dueAt,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          companyId: input.companyId ?? null,
          // identityId vazio = criada por automação (sistema): colunas uuid ficam nulas, nunca ''.
          assigneeId: input.assigneeId ?? (identityId || null),
          createdBy: identityId || null,
        },
        select: { id: true },
      });
      await tx.activity.create({
        data: { tenantId, actor: identityId ? 'Você' : 'Automação', acao: `criou a tarefa "${input.titulo}"`, tone: 'neutral', contactId: input.contactId ?? null, dealId: input.dealId ?? null },
      });
      return { id: t.id };
    });
  }

  async update(tenantId: string, id: string, input: Partial<TaskInput> & { status?: string }) {
    const dueAt = input.dueAt === undefined ? undefined : parseData(input.dueAt);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.task.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!atual) throw new NotFoundException('tarefa inexistente');
      if (input.status && !['aberta', 'concluida'].includes(input.status)) throw new BadRequestException('status inválido');
      await tx.task.update({
        where: { id },
        data: {
          titulo: input.titulo ?? undefined,
          descricao: input.descricao === undefined ? undefined : input.descricao || null,
          prioridade: input.prioridade ?? undefined,
          status: input.status ?? undefined,
          dueAt: dueAt === undefined ? undefined : dueAt,
          // concluir carimba a hora; reabrir limpa
          completedAt: input.status === 'concluida' ? new Date() : input.status === 'aberta' ? null : undefined,
          updatedAt: new Date(),
        },
      });
      return { ok: true };
    });
  }

  /** Atalho do checkbox: alterna aberta ↔ concluída. */
  async toggle(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const t = await tx.task.findUnique({ where: { id }, select: { status: true, titulo: true, contactId: true } });
      if (!t) throw new NotFoundException('tarefa inexistente');
      const concluindo = t.status === 'aberta';
      await tx.task.update({
        where: { id },
        data: { status: concluindo ? 'concluida' : 'aberta', completedAt: concluindo ? new Date() : null, updatedAt: new Date() },
      });
      if (concluindo) {
        await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `concluiu a tarefa "${t.titulo}"`, tone: 'success', contactId: t.contactId } });
      }
      return { ok: true, status: concluindo ? 'concluida' : 'aberta' };
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const res = await tx.task.deleteMany({ where: { id } });
      if (res.count === 0) throw new NotFoundException('tarefa inexistente');
      return { ok: true };
    });
  }

  /** Vínculo tem que existir NO TENANT: o SELECT roda sob RLS, então id de
   *  outro tenant simplesmente não aparece e vira 404 — nunca um FK cruzado. */
  private async validarVinculos(tx: Prisma.TransactionClient, input: TaskInput) {
    if (input.contactId && !(await tx.contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) {
      throw new NotFoundException('contato inexistente');
    }
    if (input.dealId && !(await tx.deal.findUnique({ where: { id: input.dealId }, select: { id: true } }))) {
      throw new NotFoundException('negócio inexistente');
    }
    if (input.companyId && !(await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } }))) {
      throw new NotFoundException('empresa inexistente');
    }
  }
}

function parseData(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('data inválida (use ISO 8601)');
  return d;
}
