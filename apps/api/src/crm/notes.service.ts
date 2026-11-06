import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NoteInput {
  corpo: string;
  contactId?: string;
  dealId?: string;
  companyId?: string;
}

/** Notas (D1): texto livre preso a contato, negócio ou empresa. */
@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, identityId: string, input: NoteInput) {
    if (!input.contactId && !input.dealId && !input.companyId) {
      throw new BadRequestException('a nota precisa estar ligada a um contato, negócio ou empresa');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      // identityId vazio = autor é o sistema (nó de automação): sem lookup de usuário e sem authorId.
      const autor = identityId ? await tx.user.findFirst({ where: { identityId }, select: { nome: true } }) : null;
      const n = await tx.note.create({
        data: {
          tenantId,
          corpo: input.corpo,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          companyId: input.companyId ?? null,
          authorId: identityId || null,
          // snapshot do nome: a nota tem que continuar legível se o autor sair do tenant
          authorNome: autor?.nome ?? (identityId ? null : 'Automação'),
        },
        select: { id: true, createdAt: true },
      });
      await tx.activity.create({
        data: { tenantId, actor: autor?.nome ?? (identityId ? 'Você' : 'Automação'), acao: 'adicionou uma nota', tone: 'neutral', contactId: input.contactId ?? null, dealId: input.dealId ?? null },
      });
      return { id: n.id, createdAt: n.createdAt };
    });
  }

  async update(tenantId: string, identityId: string, id: string, corpo: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const n = await tx.note.findUnique({ where: { id }, select: { authorId: true } });
      if (!n) throw new NotFoundException('nota inexistente');
      // nota é fala de alguém: só o autor reescreve (a RLS já garante o tenant)
      if (n.authorId && n.authorId !== identityId) throw new ForbiddenException('só o autor pode editar a nota');
      await tx.note.update({ where: { id }, data: { corpo, updatedAt: new Date() } });
      return { ok: true };
    });
  }

  async remove(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const n = await tx.note.findUnique({ where: { id }, select: { authorId: true } });
      if (!n) throw new NotFoundException('nota inexistente');
      if (n.authorId && n.authorId !== identityId) throw new ForbiddenException('só o autor pode excluir a nota');
      await tx.note.delete({ where: { id } });
      return { ok: true };
    });
  }
}
