import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { CrmService } from './crm.service';

export const STATUS_PROPOSTA = ['rascunho', 'enviada', 'aceita', 'recusada', 'expirada', 'cancelada'] as const;
export type StatusProposta = (typeof STATUS_PROPOSTA)[number];
export type AcaoProposta = 'enviar' | 'aceitar' | 'recusar' | 'cancelar' | 'reabrir';

/** Proposta enviada sem resposta há mais que isso aparece como "parada". */
export const DIAS_PARADA = 3;

export const itensSchema = z
  .array(
    z.object({
      descricao: z.string().trim().min(1, 'descrição do item é obrigatória').max(200),
      quantidade: z.number().positive('quantidade precisa ser maior que zero').max(100000),
      valorUnitario: z.number().min(0, 'valor não pode ser negativo').max(100_000_000),
    }).strict(),
  )
  .max(50, 'no máximo 50 itens');
export type ItemProposta = z.infer<typeof itensSchema>[number];

export interface DadosProposta {
  titulo?: string;
  contactId?: string | null;
  dealId?: string | null;
  itens?: unknown;
  desconto?: number;
  validade?: string | null; // YYYY-MM-DD
  observacoes?: string | null;
  ownerId?: string | null;
}

const cents = (n: number) => Math.round(n * 100);
/** Total = Σ quantidade × unitário − desconto (nunca negativo), em centavos exatos. */
export function totalDaProposta(itens: ItemProposta[], desconto: number): number {
  const bruto = itens.reduce((t, i) => t + Math.round(i.quantidade * cents(i.valorUnitario)), 0);
  return Math.max(0, bruto - cents(desconto)) / 100;
}

/** Máquina de estados: o que cada ação aceita como status de origem. */
export const TRANSICOES: Record<AcaoProposta, { de: StatusProposta[]; para: StatusProposta }> = {
  enviar: { de: ['rascunho'], para: 'enviada' },
  aceitar: { de: ['enviada', 'expirada'], para: 'aceita' },
  recusar: { de: ['enviada', 'expirada'], para: 'recusada' },
  cancelar: { de: ['rascunho', 'enviada', 'expirada'], para: 'cancelada' },
  reabrir: { de: ['recusada', 'expirada', 'cancelada'], para: 'rascunho' },
};

const EDITAVEL: StatusProposta[] = ['rascunho', 'enviada'];
const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

/**
 * Propostas comerciais (ADR-0042). Aceitar uma proposta ligada a negócio
 * aberto marca o negócio como GANHO pelo CrmService (mesmo caminho da tela,
 * então automações de pós-venda disparam). Vencida a validade, a proposta
 * enviada vira `expirada` sozinha na próxima leitura.
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
    private readonly crm: CrmService,
  ) {}

  async listar(tenantId: string, filtro: { status?: string; contactId?: string; dealId?: string; q?: string } = {}) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.expirarVencidas(tx);
      const where: Prisma.ProposalWhereInput = {};
      if (filtro.status && (STATUS_PROPOSTA as readonly string[]).includes(filtro.status)) where.status = filtro.status;
      if (filtro.contactId) where.contactId = filtro.contactId;
      if (filtro.dealId) where.dealId = filtro.dealId;
      if (filtro.q?.trim()) where.titulo = { contains: filtro.q.trim(), mode: 'insensitive' };
      const rows = await tx.proposal.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 300 });
      const [contatos, negocios] = await Promise.all([
        tx.contact.findMany({ where: { id: { in: rows.map((r) => r.contactId).filter((x): x is string => !!x) } }, select: { id: true, nome: true, telefone: true } }),
        tx.deal.findMany({ where: { id: { in: rows.map((r) => r.dealId).filter((x): x is string => !!x) } }, select: { id: true, titulo: true, status: true } }),
      ]);
      const c = new Map(contatos.map((x) => [x.id, x]));
      const d = new Map(negocios.map((x) => [x.id, x]));
      const agora = Date.now();
      const itens = rows.map((r) => {
        const dias = r.status === 'enviada' && r.enviadaEm ? Math.floor((agora - r.enviadaEm.getTime()) / 86400000) : 0;
        return {
          id: r.id, titulo: r.titulo, status: r.status, valor: num(r.valor), desconto: num(r.desconto),
          validade: r.validade ? r.validade.toISOString().slice(0, 10) : null,
          enviadaEm: r.enviadaEm, respondidaEm: r.respondidaEm, motivoRecusa: r.motivoRecusa,
          proximoFollowupAt: r.proximoFollowupAt, updatedAt: r.updatedAt, createdAt: r.createdAt,
          contato: r.contactId ? c.get(r.contactId) ?? null : null,
          negocio: r.dealId ? d.get(r.dealId) ?? null : null,
          diasSemResposta: dias,
          parada: r.status === 'enviada' && dias >= DIAS_PARADA,
        };
      });
      const soma = (s: StatusProposta) => itens.filter((i) => i.status === s).reduce((t, i) => t + i.valor, 0);
      const decididas = itens.filter((i) => i.status === 'aceita' || i.status === 'recusada').length;
      return {
        itens,
        resumo: {
          rascunho: itens.filter((i) => i.status === 'rascunho').length,
          enviadas: itens.filter((i) => i.status === 'enviada').length,
          paradas: itens.filter((i) => i.parada).length,
          aceitas: itens.filter((i) => i.status === 'aceita').length,
          valorEmNegociacao: soma('enviada'),
          valorAceito: soma('aceita'),
          taxaAceite: decididas ? Math.round((itens.filter((i) => i.status === 'aceita').length / decididas) * 100) : null,
        },
      };
    });
  }

  async obter(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.expirarVencidas(tx);
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('proposta inexistente');
      const [contato, negocio] = await Promise.all([
        p.contactId ? tx.contact.findUnique({ where: { id: p.contactId }, select: { id: true, nome: true, email: true, telefone: true } }) : null,
        p.dealId ? tx.deal.findUnique({ where: { id: p.dealId }, select: { id: true, titulo: true, status: true, valor: true } }) : null,
      ]);
      return {
        ...p, valor: num(p.valor), desconto: num(p.desconto),
        validade: p.validade ? p.validade.toISOString().slice(0, 10) : null,
        contato, negocio: negocio ? { ...negocio, valor: num(negocio.valor) } : null,
      };
    });
  }

  async criar(tenantId: string, identityId: string, input: DadosProposta) {
    const itens = this.validarItens(input.itens ?? []);
    const desconto = input.desconto ?? 0;
    const titulo = this.titulo(input.titulo);
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const vinculo = await this.resolverVinculo(tx, input.contactId ?? null, input.dealId ?? null);
      const p = await tx.proposal.create({
        data: {
          tenantId, titulo, itens: itens as unknown as Prisma.InputJsonValue, desconto, valor: totalDaProposta(itens, desconto),
          contactId: vinculo.contactId, dealId: vinculo.dealId,
          validade: this.data(input.validade), observacoes: input.observacoes?.trim() || null,
          ownerId: await this.dono(tx, tenantId, input.ownerId ?? identityId), createdBy: identityId,
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `criou a proposta "${titulo}"`, tone: 'neutral', contactId: vinculo.contactId, dealId: vinculo.dealId } });
      return p;
    });
    this.publicar(tenantId, r);
    return { id: r.id };
  }

  async atualizar(tenantId: string, id: string, input: DadosProposta) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.proposal.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('proposta inexistente');
      if (!EDITAVEL.includes(atual.status as StatusProposta)) throw new ConflictException(`proposta ${atual.status} não pode ser editada; reabra-a primeiro`);
      const itens = input.itens === undefined ? (atual.itens as unknown as ItemProposta[]) : this.validarItens(input.itens);
      const desconto = input.desconto ?? num(atual.desconto);
      const vinculo = input.contactId !== undefined || input.dealId !== undefined
        ? await this.resolverVinculo(tx, input.contactId === undefined ? atual.contactId : input.contactId, input.dealId === undefined ? atual.dealId : input.dealId)
        : { contactId: atual.contactId, dealId: atual.dealId };
      return tx.proposal.update({
        where: { id },
        data: {
          titulo: input.titulo !== undefined ? this.titulo(input.titulo) : undefined,
          itens: input.itens === undefined ? undefined : (itens as unknown as Prisma.InputJsonValue),
          desconto, valor: totalDaProposta(itens, desconto),
          contactId: vinculo.contactId, dealId: vinculo.dealId,
          validade: input.validade === undefined ? undefined : this.data(input.validade),
          observacoes: input.observacoes === undefined ? undefined : input.observacoes?.trim() || null,
          ownerId: input.ownerId === undefined ? undefined : await this.dono(tx, tenantId, input.ownerId),
          updatedAt: new Date(),
        },
      });
    });
    this.publicar(tenantId, r);
    return { ok: true };
  }

  async transicionar(tenantId: string, id: string, acao: AcaoProposta, opts: { motivo?: string; marcarNegocioPerdido?: boolean; followupEmDias?: number } = {}) {
    const regra = TRANSICOES[acao];
    if (!regra) throw new BadRequestException('ação inválida');
    if (acao === 'recusar' && !opts.motivo?.trim()) throw new BadRequestException('informe o motivo da recusa (alimenta a análise de perdas)');
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.expirarVencidas(tx);
      const atual = await tx.proposal.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('proposta inexistente');
      if (!regra.de.includes(atual.status as StatusProposta)) throw new ConflictException(`não é possível ${acao} uma proposta ${atual.status}`);
      if (acao === 'enviar') {
        if (!(atual.itens as unknown[]).length) throw new BadRequestException('a proposta precisa de pelo menos um item antes de ser enviada');
        if (atual.validade && atual.validade.getTime() < hojeUtc()) throw new BadRequestException('a validade já passou; ajuste a data antes de enviar');
      }
      const agora = new Date();
      const dias = Math.max(1, Math.min(60, Math.trunc(opts.followupEmDias ?? DIAS_PARADA)));
      const p = await tx.proposal.update({
        where: { id },
        data: {
          status: regra.para,
          enviadaEm: acao === 'enviar' ? agora : acao === 'reabrir' ? null : undefined,
          respondidaEm: acao === 'aceitar' || acao === 'recusar' ? agora : acao === 'reabrir' ? null : undefined,
          motivoRecusa: acao === 'recusar' ? opts.motivo!.trim().slice(0, 500) : acao === 'reabrir' ? null : undefined,
          proximoFollowupAt: acao === 'enviar' ? new Date(agora.getTime() + dias * 86400000) : null,
          updatedAt: agora,
        },
      });
      const verbo = { enviar: 'enviou', aceitar: 'registrou o aceite da', recusar: 'registrou a recusa da', cancelar: 'cancelou a', reabrir: 'reabriu a' }[acao];
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `${verbo} proposta "${p.titulo}"`, tone: acao === 'aceitar' ? 'green' : acao === 'recusar' ? 'warn' : 'neutral', contactId: p.contactId, dealId: p.dealId } });
      const negocio = p.dealId ? await tx.deal.findUnique({ where: { id: p.dealId }, select: { id: true, status: true, valor: true } }) : null;
      return { p, negocio };
    });
    // Fora da transação: o CrmService abre a própria e publica os eventos de negócio.
    let negocioAtualizado: 'ganho' | 'perdido' | null = null;
    if (r.negocio?.status === 'aberto' && acao === 'aceitar') {
      await this.crm.updateDeal(tenantId, r.negocio.id, { status: 'ganho', valor: num(r.negocio.valor) > 0 ? undefined : num(r.p.valor) });
      negocioAtualizado = 'ganho';
    } else if (r.negocio?.status === 'aberto' && acao === 'recusar' && opts.marcarNegocioPerdido) {
      await this.crm.updateDeal(tenantId, r.negocio.id, { status: 'perdido' });
      negocioAtualizado = 'perdido';
    }
    this.publicar(tenantId, r.p);
    return { ok: true, status: r.p.status, negocioAtualizado };
  }

  async apagar(tenantId: string, id: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const p = await tx.proposal.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('proposta inexistente');
      if (!['rascunho', 'cancelada'].includes(p.status)) throw new ConflictException('só rascunho ou proposta cancelada pode ser apagada (o histórico de envio é preservado)');
      await tx.proposal.delete({ where: { id } });
      return p;
    });
    this.publicar(tenantId, { ...r, status: 'cancelada' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ apoio

  private async expirarVencidas(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`UPDATE proposals SET status = 'expirada', proximo_followup_at = NULL, updated_at = now()
      WHERE status = 'enviada' AND validade IS NOT NULL AND validade < (now() AT TIME ZONE 'America/Sao_Paulo')::date`;
  }

  private validarItens(bruto: unknown): ItemProposta[] {
    const r = itensSchema.safeParse(bruto);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.length ? `item ${Number(i.path[0]) + 1}: ` : ''}${i.message}`).join('; '));
    return r.data;
  }

  private titulo(t?: string): string {
    const v = (t ?? '').replace(/\s+/g, ' ').trim();
    if (!v) throw new BadRequestException('título é obrigatório');
    if (v.length > 160) throw new BadRequestException('título pode ter no máximo 160 caracteres');
    return v;
  }

  private data(v?: string | null): Date | null {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new BadRequestException('validade inválida (use AAAA-MM-DD)');
    return new Date(`${v}T00:00:00Z`);
  }

  /** Negócio informado sem contato → herda o contato do negócio. Ids de outro tenant = inexistentes (RLS). */
  private async resolverVinculo(tx: Prisma.TransactionClient, contactId: string | null, dealId: string | null) {
    let contato = contactId;
    if (dealId) {
      const d = await tx.deal.findUnique({ where: { id: dealId }, select: { contactId: true } });
      if (!d) throw new NotFoundException('negócio inexistente');
      contato ??= d.contactId;
    }
    if (contato && !(await tx.contact.findUnique({ where: { id: contato }, select: { id: true } }))) throw new NotFoundException('contato inexistente');
    return { contactId: contato, dealId };
  }

  /** Responsável precisa ser membro do tenant. */
  private async dono(tx: Prisma.TransactionClient, tenantId: string, identityId: string | null): Promise<string | null> {
    if (!identityId) return null;
    const m = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } }, select: { id: true } });
    if (!m) throw new BadRequestException('responsável não é membro desta operação');
    return identityId;
  }

  private publicar(tenantId: string, p: { id: string; status: string; dealId: string | null; contactId: string | null }) {
    this.eventos.publicar(tenantId, 'proposal.updated', { id: p.id, status: p.status, dealId: p.dealId, contactId: p.contactId });
  }
}

function hojeUtc(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
