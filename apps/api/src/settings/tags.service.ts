import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'crm_tag', ${entidadeId ?? null})`;
}

export interface TagInput {
  name: string;
  color?: string;
  descricao?: string;
}

/** Catálogo de tags do CRM (nome + cor), isolado por tenant via RLS. */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.crmTag.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  async criar(tenantId: string, identityId: string, dto: TagInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      try {
        const tag = await tx.crmTag.create({
          data: { tenantId, name: dto.name.trim(), color: dto.color ?? '#7B2EFF', descricao: dto.descricao ?? '' },
        });
        await audit(tx, tenantId, identityId, 'tag.criada', tag.id);
        return tag;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Já existe uma tag com esse nome.');
        }
        throw e;
      }
    });
  }

  async atualizar(tenantId: string, identityId: string, id: string, dto: Partial<TagInput>) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.crmTag.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('tag inexistente');
      try {
        const tag = await tx.crmTag.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.color !== undefined ? { color: dto.color } : {}),
            ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
          },
        });
        await audit(tx, tenantId, identityId, 'tag.atualizada', id);
        return tag;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Já existe uma tag com esse nome.');
        }
        throw e;
      }
    });
  }

  async remover(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.crmTag.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('tag inexistente');
      await tx.crmTag.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'tag.removida', id);
      return { ok: true };
    });
  }
}
