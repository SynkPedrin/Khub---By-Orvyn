import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { percentualEmPontosBase } from './importacao-fin';
import { FUSO_PADRAO } from './caixa.service';
import { dataNoFuso } from '../booking/booking.schema';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'financeiro_comissao', ${entidadeId ?? null}::uuid)`;
}

/** Competência no formato "YYYY-MM" → Date do dia 1 (padrão: mês atual no fuso BR). */
export function competenciaDe(v: string | undefined): Date {
  const alvo = v ?? dataNoFuso(Date.now(), FUSO_PADRAO).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(alvo)) throw new BadRequestException('competência inválida (use AAAA-MM)');
  return new Date(`${alvo}-01T00:00:00Z`);
}

export interface MembroComissao {
  identityId: string;
  role: string;
  email: string;
  nome: string;
  cargo: string | null;
  comissaoPercent: number;
}

export interface ComissaoItem {
  id: string;
  identityId: string;
  nome: string;
  baseCentavos: number;
  percent: number;
  valorCentavos: number;
  status: 'prevista' | 'paga';
  pagoEm: Date | null;
  competencia: string;
  descricao: string | null;
  dataCompetencia: string | null;
}

export interface ResumoMembro {
  identityId: string;
  nome: string;
  totalCentavos: number;
  pagoCentavos: number;
  previstoCentavos: number;
  qtd: number;
}

/**
 * Comissões da equipe: cargo + % por membro (estende o membership, não
 * duplica cadastro) e as comissões geradas pelas entradas atribuídas a cada
 * um. Pagar a comissão lança a saída correspondente no caixa (categoria
 * "Comissões", origem 'comissao'); estornar desfaz as duas coisas.
 * Quem chama: só owner/admin escreve (PermissionsGuard: organization.manage).
 */
@Injectable()
export class ComissoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Equipe do tenant com cargo e % de comissão (0 quando ainda não configurado). */
  async equipe(tenantId: string): Promise<MembroComissao[]> {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<MembroComissao[]>`
        SELECT m.identity_id AS "identityId", m.role, i.email,
               COALESCE(u.nome, i.email) AS nome,
               ec.cargo, COALESCE(ec.comissao_percent, 0)::float8 AS "comissaoPercent"
        FROM memberships m
        JOIN identities i ON i.id = m.identity_id
        LEFT JOIN users u ON u.identity_id = m.identity_id AND u.tenant_id = m.tenant_id
        LEFT JOIN equipe_comissoes ec ON ec.tenant_id = m.tenant_id AND ec.identity_id = m.identity_id
        WHERE m.tenant_id = ${tenantId}::uuid
        ORDER BY u.nome NULLS LAST, i.email`,
    );
  }

  /** Define cargo e % de um membro. Vale para as PRÓXIMAS entradas (não recalcula o passado). */
  async definir(tenantId: string, actorId: string, identityId: string, dto: { cargo?: string | null; comissaoPercent?: number }) {
    const percent = dto.comissaoPercent ?? 0;
    if (percentualEmPontosBase(percent) === null) throw new BadRequestException('percentual inválido (0 a 100, no máximo 2 casas decimais)');
    const cargo = dto.cargo?.trim().slice(0, 80) || null;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const alvo = await tx.membership.findFirst({ where: { tenantId, identityId }, select: { id: true } });
      if (!alvo) throw new NotFoundException('membro inexistente nesta conta');
      const cfg = await tx.equipeComissao.upsert({
        where: { tenantId_identityId: { tenantId, identityId } },
        create: { tenantId, identityId, cargo, comissaoPercent: new Prisma.Decimal(percent.toFixed(2)) },
        update: { cargo, comissaoPercent: new Prisma.Decimal(percent.toFixed(2)), updatedAt: new Date() },
      });
      await audit(tx, tenantId, actorId, 'comissao.configurada', identityId);
      return { identityId: cfg.identityId, cargo: cfg.cargo, comissaoPercent: Number(cfg.comissaoPercent) };
    });
  }

  /**
   * Comissões geradas numa competência (padrão: mês atual), agrupadas por
   * membro, com os itens (cada entrada que gerou comissão).
   */
  async geradas(tenantId: string, competencia?: string): Promise<{ competencia: string; porMembro: ResumoMembro[]; itens: ComissaoItem[] }> {
    const comp = competenciaDe(competencia);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const itens = await tx.$queryRaw<ComissaoItem[]>`
        SELECT fc.id, fc.identity_id AS "identityId",
               COALESCE(u.nome, i.email) AS nome,
               fc.base_centavos AS "baseCentavos", fc.percent::float8 AS percent,
               fc.valor_centavos AS "valorCentavos", fc.status, fc.pago_em AS "pagoEm",
               fc.competencia::text AS competencia, t.descricao, t.data_competencia::text AS "dataCompetencia"
        FROM financeiro_comissoes fc
        JOIN identities i ON i.id = fc.identity_id
        LEFT JOIN users u ON u.identity_id = fc.identity_id AND u.tenant_id = fc.tenant_id
        LEFT JOIN financeiro_transacoes t ON t.id = fc.transacao_id
        WHERE fc.tenant_id = ${tenantId}::uuid AND fc.competencia = ${comp}::date
        ORDER BY nome, t.data_competencia DESC NULLS LAST, fc.created_at DESC`;
      const porMembro = new Map<string, ResumoMembro>();
      for (const it of itens) {
        const m = porMembro.get(it.identityId) ?? { identityId: it.identityId, nome: it.nome, totalCentavos: 0, pagoCentavos: 0, previstoCentavos: 0, qtd: 0 };
        m.totalCentavos += Number(it.valorCentavos);
        if (it.status === 'paga') m.pagoCentavos += Number(it.valorCentavos);
        else m.previstoCentavos += Number(it.valorCentavos);
        m.qtd += 1;
        porMembro.set(it.identityId, m);
      }
      return { competencia: comp.toISOString().slice(0, 10), porMembro: [...porMembro.values()], itens };
    });
  }

  /**
   * Marca a comissão como paga e lança a saída no caixa (categoria
   * "Comissões", criada sob demanda). Idempotente e seguro contra clique
   * duplo: só quem vira prevista→paga (UPDATE condicional) lança a saída.
   */
  async pagar(tenantId: string, actorId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const com = await tx.financeiroComissao.findFirst({ where: { id } });
      if (!com) throw new NotFoundException('comissão inexistente');
      const agora = new Date();
      const virou = await tx.financeiroComissao.updateMany({ where: { id, status: 'prevista' }, data: { status: 'paga', pagoEm: agora } });
      if (virou.count === 0) return tx.financeiroComissao.findFirst({ where: { id } });
      if (com.valorCentavos > 0) {
        const nomeRows = await tx.$queryRaw<{ nome: string }[]>`
          SELECT COALESCE(u.nome, i.email) AS nome FROM identities i
          LEFT JOIN users u ON u.identity_id = i.id AND u.tenant_id = ${tenantId}::uuid
          WHERE i.id = ${com.identityId}::uuid`;
        const nome = nomeRows[0]?.nome ?? 'colaborador';
        let cat = await tx.financeiroCategoria.findFirst({ where: { tipo: 'saida', nome: { equals: 'Comissões', mode: 'insensitive' } }, select: { id: true } });
        cat ??= await tx.financeiroCategoria.create({ data: { tenantId, nome: 'Comissões', tipo: 'saida' }, select: { id: true } });
        const mes = com.competencia.toISOString().slice(0, 7).split('-').reverse().join('/');
        const saida = await tx.financeiroTransacao.create({
          data: {
            tenantId,
            tipo: 'saida',
            categoriaId: cat.id,
            descricao: `Comissão: ${nome} (${mes})`.slice(0, 200),
            valorCentavos: com.valorCentavos,
            dataCompetencia: new Date(`${dataNoFuso(+agora, FUSO_PADRAO)}T12:00:00Z`),
            status: 'pago',
            origem: 'comissao',
            createdBy: actorId,
          },
        });
        await tx.financeiroComissao.update({ where: { id }, data: { pagamentoTransacaoId: saida.id } });
      }
      await audit(tx, tenantId, actorId, 'comissao.paga', id);
      return tx.financeiroComissao.findFirst({ where: { id } });
    });
  }

  /** Desfaz o pagamento: a comissão volta a "prevista" e a saída lançada sai do caixa. */
  async estornar(tenantId: string, actorId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const com = await tx.financeiroComissao.findFirst({ where: { id } });
      if (!com) throw new NotFoundException('comissão inexistente');
      if (com.status !== 'paga') return com;
      const saidaId = com.pagamentoTransacaoId;
      const voltou = await tx.financeiroComissao.update({ where: { id }, data: { status: 'prevista', pagoEm: null, pagamentoTransacaoId: null } });
      if (saidaId) await tx.financeiroTransacao.deleteMany({ where: { id: saidaId, origem: 'comissao' } });
      await audit(tx, tenantId, actorId, 'comissao.estornada', id);
      return voltou;
    });
  }
}
