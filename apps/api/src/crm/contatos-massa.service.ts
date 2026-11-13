import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { parseFiltro, whereDoFiltro } from './contatos-filtro';
import { idsPorTelefone } from './contatos-sql';
import { filtroCamposContato } from './custom-fields.service';
import { ABERTO } from './funil';

/** Teto por operação (ids explícitos OU alcance do filtro). */
export const LIMITE_MASSA = 5000;

export const ACOES_MASSA = ['tag_add', 'tag_remove', 'etapa', 'dono', 'nao_perturbe', 'excluir'] as const;
export type AcaoMassa = (typeof ACOES_MASSA)[number];

const tagSchema = z.object({ tag: z.string().trim().min(1).max(40) }).strict();
/** Parâmetros por ação: validados aqui, não no DTO (o formato depende da ação). */
export const PARAMS_MASSA = {
  tag_add: tagSchema,
  tag_remove: tagSchema,
  etapa: z.object({ stageId: z.string().uuid() }).strict(),
  dono: z.object({ ownerId: z.string().uuid().nullable() }).strict(),
  nao_perturbe: z.object({ ativo: z.boolean() }).strict(),
  excluir: z.object({}).strict(),
} satisfies Record<AcaoMassa, z.ZodTypeAny>;

export interface EntradaMassa {
  ids?: string[];
  filtro?: unknown;
  acao: AcaoMassa;
  params?: unknown;
}
export interface ResultadoMassa {
  acao: AcaoMassa;
  /** Contatos alcançados (ids existentes no tenant, ou o resultado do filtro). */
  alvo: number;
  /** Contatos (ou negócios, em `etapa`) efetivamente alterados. */
  afetados: number;
  /** Alcançados que não mudaram (já tinham a tag, sem negócio aberto...). */
  ignorados: number;
}

const DESCRICAO: Record<AcaoMassa, string> = {
  tag_add: 'adicionou a tag', tag_remove: 'removeu a tag', etapa: 'moveu para a etapa', dono: 'atribuiu dono a',
  nao_perturbe: 'alterou "não perturbe" de', excluir: 'excluiu',
};

/**
 * Ações em massa da lista de Leads (Q2.2): uma transação por operação, sob
 * RLS, com UMA linha de auditoria descrevendo o alcance. Os gatilhos do banco
 * continuam valendo (tag nova → `contact.tagged`, etapa → `deal.moved`): ação
 * em massa feita por gente é ação de verdade, não importação silenciosa.
 */
@Injectable()
export class ContatosMassaService {
  constructor(private readonly prisma: PrismaService) {}

  async executar(tenantId: string, identityId: string, entrada: EntradaMassa): Promise<ResultadoMassa> {
    const schema = PARAMS_MASSA[entrada.acao];
    if (!schema) throw new BadRequestException('ação inválida');
    const p = schema.safeParse(entrada.params ?? {});
    if (!p.success) throw new BadRequestException(`parâmetros inválidos para "${entrada.acao}": ${p.error.issues.map((i) => `${i.path.join('.') || 'params'} ${i.message}`).join('; ')}`);
    const params = p.data as Record<string, unknown>;
    const temIds = Array.isArray(entrada.ids) && entrada.ids.length > 0;
    if (!temIds && entrada.filtro === undefined) throw new BadRequestException('informe ids ou filtro');
    if (temIds && entrada.ids!.length > LIMITE_MASSA) throw new BadRequestException(`no máximo ${LIMITE_MASSA} contatos por operação`);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const ids = await this.resolverAlvo(tx, temIds ? entrada.ids! : null, entrada.filtro);
      const r = ids.length ? await this.aplicar(tx, tenantId, identityId, entrada.acao, params, ids) : { afetados: 0, detalhe: {} };
      // em `etapa` é um negócio por contato, então a conta fecha igual
      const resultado: ResultadoMassa = { acao: entrada.acao, alvo: ids.length, afetados: r.afetados, ignorados: Math.max(ids.length - r.afetados, 0) };

      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `${DESCRICAO[entrada.acao]} ${r.afetados} contato(s) em massa`, tone: entrada.acao === 'excluir' ? 'warn' : 'neutral' } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${`contacts.bulk.${entrada.acao}`}, 'contact', NULL,
                ${JSON.stringify({ modo: temIds ? 'ids' : 'filtro', filtro: temIds ? undefined : entrada.filtro, params, alvo: ids.length, afetados: r.afetados, ...r.detalhe, ids })}::jsonb)`;
      return resultado;
    }, { timeout: 60_000 });
  }

  /** Ids que existem NO TENANT (RLS) — id de outro tenant some aqui, em silêncio. */
  private async resolverAlvo(tx: Prisma.TransactionClient, ids: string[] | null, filtroBruto: unknown): Promise<string[]> {
    if (ids) {
      const unicos = [...new Set(ids)];
      const rows = await tx.contact.findMany({ where: { id: { in: unicos } }, select: { id: true } });
      return rows.map((r) => r.id);
    }
    const filtro = parseFiltro(filtroBruto);
    const where = whereDoFiltro(filtro, await idsPorTelefone(tx, filtro.q), await filtroCamposContato(tx, filtro.cf));
    const rows = await tx.contact.findMany({ where, select: { id: true }, take: LIMITE_MASSA + 1, orderBy: { id: 'asc' } });
    if (rows.length > LIMITE_MASSA) throw new BadRequestException(`o filtro alcança mais de ${LIMITE_MASSA} contatos; refine o filtro ou faça em partes`);
    return rows.map((r) => r.id);
  }

  private async aplicar(tx: Prisma.TransactionClient, tenantId: string, identityId: string, acao: AcaoMassa, params: Record<string, unknown>, ids: string[]): Promise<{ afetados: number; detalhe: Record<string, unknown> }> {
    switch (acao) {
      case 'tag_add': {
        const tag = params.tag as string;
        const afetados = await tx.$executeRaw`UPDATE contacts SET tags = array_append(tags, ${tag}::text), updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND NOT EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) = lower(${tag}::text))`;
        // tag nova entra no catálogo (autocomplete de Configurações › Tags)
        await tx.$executeRaw`INSERT INTO crm_tags (tenant_id, name) VALUES (${tenantId}::uuid, ${tag}) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`;
        return { afetados, detalhe: { tag } };
      }
      case 'tag_remove': {
        const tag = params.tag as string;
        const afetados = await tx.$executeRaw`UPDATE contacts SET tags = ARRAY(SELECT t FROM unnest(tags) t WHERE lower(t) <> lower(${tag}::text)), updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) = lower(${tag}::text))`;
        return { afetados, detalhe: { tag } };
      }
      case 'etapa': {
        const stage = await tx.stage.findUnique({ where: { id: params.stageId as string }, select: { id: true, nome: true, pipelineId: true } });
        if (!stage) throw new NotFoundException('etapa inexistente');
        // negócio ABERTO mais recente de cada contato (o mesmo da coluna "Etapa")
        const abertos = await tx.$queryRaw<{ id: string; contact_id: string; titulo: string; stage_id: string }[]>`
          SELECT DISTINCT ON (contact_id) id, contact_id, titulo, stage_id::text AS stage_id FROM deals
          WHERE contact_id = ANY(${ids}::uuid[]) AND status = ${ABERTO}
          ORDER BY contact_id, updated_at DESC`;
        const mover = abertos.filter((d) => d.stage_id !== stage.id);
        if (mover.length) {
          await tx.deal.updateMany({ where: { id: { in: mover.map((d) => d.id) } }, data: { stageId: stage.id, pipelineId: stage.pipelineId, updatedAt: new Date() } });
          await tx.activity.createMany({ data: mover.map((d) => ({ tenantId, actor: 'Você', acao: `moveu "${d.titulo}" para ${stage.nome}`, tone: 'neutral', dealId: d.id, contactId: d.contact_id })) });
        }
        return { afetados: mover.length, detalhe: { stageId: stage.id, contatosComNegocio: abertos.length, semNegocioAberto: ids.length - abertos.length } };
      }
      case 'dono': {
        const ownerId = params.ownerId as string | null;
        if (ownerId) {
          const m = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: ownerId, tenantId } }, select: { id: true } });
          if (!m) throw new BadRequestException('responsável não é membro desta operação');
        }
        const r = await tx.contact.updateMany({
          where: { id: { in: ids }, ...(ownerId ? { OR: [{ ownerId: null }, { ownerId: { not: ownerId } }] } : { ownerId: { not: null } }) },
          data: { ownerId, updatedAt: new Date() },
        });
        return { afetados: r.count, detalhe: { ownerId, atribuidoPor: identityId } };
      }
      case 'nao_perturbe': {
        const ativo = params.ativo as boolean;
        const r = await tx.contact.updateMany({
          where: { id: { in: ids }, optedOutAt: ativo ? null : { not: null } },
          data: { optedOutAt: ativo ? new Date() : null, updatedAt: new Date() },
        });
        return { afetados: r.count, detalhe: { ativo } };
      }
      case 'excluir': {
        // mesma semântica do DELETE unitário: negócios/conversas ficam (SET NULL),
        // tarefas/notas/atividades do contato caem junto (CASCADE)
        const r = await tx.contact.deleteMany({ where: { id: { in: ids } } });
        return { afetados: r.count, detalhe: {} };
      }
    }
  }
}
