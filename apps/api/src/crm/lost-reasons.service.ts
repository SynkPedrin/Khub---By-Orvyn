import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** Semeados na primeira leitura de um tenant sem nenhum motivo (Q2.1). */
export const MOTIVOS_PADRAO = ['Preço', 'Concorrente', 'Sem resposta', 'Sem orçamento', 'Fora do perfil', 'Outro'] as const;
export const MAX_MOTIVOS = 50;
export const MAX_OBS_PERDA = 500;

export interface MotivoPerda {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  /** Quantos negócios usam o motivo (só informativo: decide se dá para apagar). */
  usos: number;
}

export function limparNomeMotivo(valor: string): string {
  const v = (valor ?? '').replace(/\s+/g, ' ').trim();
  if (!v) throw new BadRequestException('nome do motivo é obrigatório');
  if (v.length > 60) throw new BadRequestException('nome do motivo pode ter no máximo 60 caracteres');
  return v;
}

/** Observação da perda: vazia vira null, limite de 500 caracteres. */
export function limparObsPerda(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const v = valor.trim();
  if (v.length > MAX_OBS_PERDA) throw new BadRequestException(`observação da perda pode ter no máximo ${MAX_OBS_PERDA} caracteres`);
  return v || null;
}

/** Semeia os padrões se o tenant ainda não tem nenhum motivo (idempotente sob concorrência). */
export async function garantirMotivosPadrao(tx: Tx, tenantId: string): Promise<void> {
  if ((await tx.lostReason.count()) > 0) return;
  for (let i = 0; i < MOTIVOS_PADRAO.length; i++) {
    await tx.$executeRaw`INSERT INTO lost_reasons (tenant_id, nome, ordem) VALUES (${tenantId}::uuid, ${MOTIVOS_PADRAO[i]}, ${i})
      ON CONFLICT (tenant_id, lower(nome)) DO NOTHING`;
  }
}

/**
 * Motivo a gravar ao marcar um negócio como perdido. Regra única da API
 * (PATCH do negócio e ação em massa):
 *  - motivo informado precisa existir no tenant (RLS) e estar ATIVO;
 *  - sem motivo, só passa se o tenant não tem motivo ativo (desativou todos)
 *    ou se quem chama não exige (sistema: proposta recusada, automação).
 */
export async function resolverMotivoPerda(tx: Tx, tenantId: string, motivoPerdaId: string | null | undefined, exigir: boolean): Promise<string | null> {
  if (motivoPerdaId) {
    const m = await tx.lostReason.findUnique({ where: { id: motivoPerdaId }, select: { id: true, ativo: true } });
    if (!m) throw new BadRequestException('motivo de perda inexistente');
    if (!m.ativo) throw new BadRequestException('motivo de perda desativado; escolha outro');
    return m.id;
  }
  if (!exigir) return null;
  await garantirMotivosPadrao(tx, tenantId);
  const ativos = await tx.lostReason.count({ where: { ativo: true } });
  if (ativos > 0) throw new BadRequestException('motivo de perda obrigatório: informe motivoPerdaId');
  return null;
}

/**
 * Catálogo de motivos de perda (Q2.1). Leitura para quem lê o pipeline;
 * escrita é configuração (`pipeline.configure`, manager+ no PermissionsGuard).
 * Apagar só motivo sem uso e nunca o último (senão os padrões voltariam na
 * próxima leitura): o caminho normal é desativar.
 */
@Injectable()
export class LostReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(tenantId: string, somenteAtivos = false): Promise<MotivoPerda[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await garantirMotivosPadrao(tx, tenantId);
      const [motivos, usos] = await Promise.all([
        tx.lostReason.findMany({ where: somenteAtivos ? { ativo: true } : undefined, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }] }),
        tx.deal.groupBy({ by: ['motivoPerdaId'], where: { motivoPerdaId: { not: null } }, _count: { _all: true } }),
      ]);
      const porMotivo = new Map(usos.map((u) => [u.motivoPerdaId, u._count._all]));
      return motivos.map((m) => ({ id: m.id, nome: m.nome, ativo: m.ativo, ordem: m.ordem, usos: porMotivo.get(m.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, input: { nome: string }) {
    const nome = limparNomeMotivo(input.nome);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await garantirMotivosPadrao(tx, tenantId);
      if ((await tx.lostReason.count()) >= MAX_MOTIVOS) throw new BadRequestException(`limite de ${MAX_MOTIVOS} motivos atingido`);
      await this.exigirNomeLivre(tx, nome);
      const max = await tx.lostReason.aggregate({ _max: { ordem: true } });
      const m = await tx.lostReason.create({ data: { tenantId, nome, ordem: (max._max.ordem ?? -1) + 1 } });
      return { id: m.id };
    });
  }

  async atualizar(tenantId: string, id: string, input: { nome?: string; ativo?: boolean }) {
    const nome = input.nome !== undefined ? limparNomeMotivo(input.nome) : undefined;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const m = await tx.lostReason.findUnique({ where: { id }, select: { id: true } });
      if (!m) throw new NotFoundException('motivo inexistente');
      if (nome) await this.exigirNomeLivre(tx, nome, id);
      await tx.lostReason.update({ where: { id }, data: { nome, ativo: input.ativo, updatedAt: new Date() } });
      return { ok: true };
    });
  }

  /** Nova ordem: a lista precisa conter exatamente os motivos do tenant, uma vez cada. */
  async reordenar(tenantId: string, ids: string[]) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atuais = await tx.lostReason.findMany({ select: { id: true } });
      const conjunto = new Set(atuais.map((a) => a.id));
      if (ids.length !== conjunto.size || new Set(ids).size !== ids.length || ids.some((i) => !conjunto.has(i))) {
        throw new BadRequestException('a nova ordem precisa listar todos os motivos, uma vez cada');
      }
      for (let i = 0; i < ids.length; i++) await tx.lostReason.update({ where: { id: ids[i] }, data: { ordem: i } });
      return { ok: true };
    });
  }

  async remover(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const m = await tx.lostReason.findUnique({ where: { id }, select: { id: true, nome: true } });
      if (!m) throw new NotFoundException('motivo inexistente');
      const usos = await tx.deal.count({ where: { motivoPerdaId: id } });
      if (usos > 0) throw new ConflictException(`o motivo "${m.nome}" está em ${usos} negócio(s); desative em vez de apagar para manter o histórico`);
      if ((await tx.lostReason.count()) <= 1) throw new ConflictException('não dá para apagar o último motivo; desative-o se não quiser exigir motivo');
      await tx.lostReason.delete({ where: { id } });
      return { ok: true };
    });
  }

  private async exigirNomeLivre(tx: Tx, nome: string, exceto?: string) {
    const existe = await tx.lostReason.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' }, ...(exceto ? { id: { not: exceto } } : {}) }, select: { id: true } });
    if (existe) throw new ConflictException('já existe um motivo com esse nome');
  }
}
