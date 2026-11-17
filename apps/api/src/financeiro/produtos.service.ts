import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ProdutoView {
  id: string;
  nome: string;
  categoria: string | null;
  precoCentavos: number;
  custoCentavos: number;
  estoque: number;
  estoqueMinimo: number;
  ativo: boolean;
  vendas30d: number;
}

export interface ProdutoInput {
  nome: string;
  categoria?: string | null;
  precoCentavos?: number;
  custoCentavos?: number;
  estoqueMinimo?: number;
  ativo?: boolean;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Produtos e estoque do caixa (db/071 + db/075). Saldo = SUM(delta) dos
 * movimentos; a venda no caixa baixa (origem 'venda', ligada ao lançamento).
 */
@Injectable()
export class ProdutosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista com saldo. Com `q`, busca por pedaço do nome (autocompletar do
   * caixa): primeiro quem começa com o texto, depois os mais vendidos.
   */
  async listar(tenantId: string, filtro: { q?: string; limite?: number; incluirInativos?: boolean } = {}): Promise<ProdutoView[]> {
    const q = norm(filtro.q ?? '').slice(0, 80);
    const limite = Math.min(Math.max(filtro.limite ?? 500, 1), 2000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const linhas = await tx.$queryRaw<
        { id: string; nome: string; categoria: string | null; preco: number; custo: number; estoque: string; minimo: string; ativo: boolean; vendas: bigint }[]
      >`
        SELECT p.id, p.nome, p.categoria, p.preco_centavos AS preco, p.custo_centavos AS custo,
               COALESCE((SELECT SUM(m.delta) FROM estoque_movimentos m WHERE m.produto_id = p.id), 0)::text AS estoque,
               p.estoque_minimo::text AS minimo, p.ativo,
               (SELECT COUNT(*) FROM financeiro_transacoes t
                  WHERE t.produto_id = p.id AND t.status = 'pago' AND t.data_competencia >= CURRENT_DATE - 30)::bigint AS vendas
        FROM produtos p
        WHERE p.tenant_id = ${tenantId}::uuid
          ${filtro.incluirInativos ? Prisma.empty : Prisma.sql`AND p.ativo`}
          ${q ? Prisma.sql`AND unaccent(lower(p.nome)) LIKE '%' || unaccent(lower(${q})) || '%'` : Prisma.empty}
        ORDER BY ${q ? Prisma.sql`(unaccent(lower(p.nome)) LIKE unaccent(lower(${q})) || '%') DESC,` : Prisma.empty} vendas DESC, p.nome
        LIMIT ${limite}`;
      return linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        categoria: l.categoria,
        precoCentavos: l.preco,
        custoCentavos: l.custo,
        estoque: Number(l.estoque),
        estoqueMinimo: Number(l.minimo),
        ativo: l.ativo,
        vendas30d: Number(l.vendas),
      }));
    });
  }

  private validar(dto: Partial<ProdutoInput>) {
    if (dto.nome !== undefined && !norm(dto.nome)) throw new BadRequestException('informe o nome do produto');
    for (const [k, v] of [['preço', dto.precoCentavos], ['custo', dto.custoCentavos]] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new BadRequestException(`${k} inválido`);
    }
  }

  async criar(tenantId: string, actorId: string, dto: ProdutoInput) {
    this.validar(dto);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const p = await tx.produto.create({
          data: {
            tenantId,
            nome: norm(dto.nome).slice(0, 160),
            categoria: dto.categoria ? norm(dto.categoria).slice(0, 80) : null,
            precoCentavos: dto.precoCentavos ?? 0,
            custoCentavos: dto.custoCentavos ?? 0,
            estoqueMinimo: new Prisma.Decimal(dto.estoqueMinimo ?? 0),
          },
        });
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${tenantId}::uuid, 'humano', ${actorId}, 'produto.criado', 'produto', ${p.id}::uuid)`;
        return p;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('já existe um produto com esse nome');
      throw e;
    }
  }

  async atualizar(tenantId: string, actorId: string, id: string, dto: Partial<ProdutoInput>) {
    this.validar(dto);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const atual = await tx.produto.findFirst({ where: { id }, select: { id: true } });
        if (!atual) throw new NotFoundException('produto inexistente');
        const p = await tx.produto.update({
          where: { id },
          data: {
            ...(dto.nome !== undefined ? { nome: norm(dto.nome).slice(0, 160) } : {}),
            ...(dto.categoria !== undefined ? { categoria: dto.categoria ? norm(dto.categoria).slice(0, 80) : null } : {}),
            ...(dto.precoCentavos !== undefined ? { precoCentavos: dto.precoCentavos } : {}),
            ...(dto.custoCentavos !== undefined ? { custoCentavos: dto.custoCentavos } : {}),
            ...(dto.estoqueMinimo !== undefined ? { estoqueMinimo: new Prisma.Decimal(dto.estoqueMinimo) } : {}),
            ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
            updatedAt: new Date(),
          },
        });
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${tenantId}::uuid, 'humano', ${actorId}, 'produto.editado', 'produto', ${id}::uuid)`;
        return p;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('já existe um produto com esse nome');
      throw e;
    }
  }

  /**
   * Movimento manual: `entrada` (chegou mercadoria, soma) ou `ajuste`
   * (contagem: informa o saldo CERTO e o sistema lança a diferença).
   */
  async movimentar(tenantId: string, actorId: string, id: string, dto: { tipo: 'entrada' | 'ajuste'; quantidade: number; motivo?: string | null }) {
    if (!Number.isFinite(dto.quantidade) || dto.quantidade < 0 || (dto.tipo === 'entrada' && dto.quantidade === 0)) throw new BadRequestException('quantidade inválida');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.produto.findFirst({ where: { id }, select: { id: true } });
      if (!p) throw new NotFoundException('produto inexistente');
      let delta = dto.quantidade;
      if (dto.tipo === 'ajuste') {
        const s = await tx.estoqueMovimento.aggregate({ where: { produtoId: id }, _sum: { delta: true } });
        delta = dto.quantidade - Number(s._sum.delta ?? 0);
        if (delta === 0) return { ok: true, delta: 0 };
      }
      await tx.estoqueMovimento.create({
        data: {
          tenantId,
          produtoId: id,
          tipo: dto.tipo,
          delta: new Prisma.Decimal(delta),
          motivo: dto.motivo?.trim().slice(0, 200) || (dto.tipo === 'entrada' ? 'Entrada de mercadoria' : 'Ajuste de contagem'),
          origem: 'manual',
          createdBy: actorId,
        },
      });
      return { ok: true, delta };
    });
  }

  /** Lote idempotente (por nome): reimportar não duplica nem mexe no que já existe. */
  async importar(tenantId: string, itens: { nome: string; precoCentavos?: number; categoria?: string | null }[]) {
    const limpos = itens
      .map((i) => ({ nome: norm(i.nome ?? '').slice(0, 160), precoCentavos: Math.max(0, Math.round(i.precoCentavos ?? 0)), categoria: i.categoria ? norm(i.categoria).slice(0, 80) : null }))
      .filter((i) => i.nome);
    if (!limpos.length) return { criados: 0, existentes: 0 };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.produto.createMany({ data: limpos.map((i) => ({ tenantId, ...i })), skipDuplicates: true });
      return { criados: r.count, existentes: limpos.length - r.count };
    });
  }
}
