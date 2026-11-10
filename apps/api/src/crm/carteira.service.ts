import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from './crm.service';

export type StatusCarteira = 'ativo' | 'em_risco' | 'inativo';

export interface ClienteCarteira {
  contactId: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  tags: string[];
  compras: number;
  totalComprado: number;
  ticketMedio: number;
  recebido: number;
  clienteDesde: string;
  ultimaCompra: string;
  diasSemComprar: number;
  status: StatusCarteira;
  /** Intervalo médio entre compras (dias); null com uma compra só. */
  cicloDias: number | null;
  proximaCompraPrevista: string | null;
  recompraAtrasada: boolean;
  optOut: boolean;
}

interface Linha {
  contact_id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  tags: string[];
  opted_out_at: Date | null;
  n: number;
  total: number;
  primeira: Date;
  ultima: Date;
  intervalo: number | null;
  recebido: number;
}

const DIA = 86400000;

/** Regra de status pura (testável): dias desde a última compra × limites. */
export function statusDoCliente(diasSemComprar: number, ativoDias: number, riscoDias: number): StatusCarteira {
  if (diasSemComprar <= ativoDias) return 'ativo';
  if (diasSemComprar <= riscoDias) return 'em_risco';
  return 'inativo';
}

/**
 * Carteira de clientes (ADR-0042). DERIVADA, sem tabela própria: cliente =
 * contato com ao menos um negócio GANHO; cada negócio ganho é uma compra (data
 * = última atualização do negócio, valor = valor do negócio). `recebido` soma
 * as cobranças pagas do Financeiro. Uma fonte de verdade só: o funil.
 *
 * Recompra: com 2+ compras, o ciclo médio prevê a próxima; passou de 20% do
 * ciclo sem comprar → recompra atrasada (lista de reativação).
 */
@Injectable()
export class CarteiraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
  ) {}

  async listar(tenantId: string, opts: { ativoDias?: number; riscoDias?: number } = {}) {
    const ativoDias = limitar(opts.ativoDias ?? 90, 7, 730);
    const riscoDias = limitar(opts.riscoDias ?? 180, ativoDias + 1, 1460);
    const linhas = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<Linha[]>`
      WITH compras AS (
        SELECT contact_id, updated_at AS em, valor FROM deals WHERE status = 'ganho' AND contact_id IS NOT NULL
      ), agg AS (
        SELECT contact_id, count(*)::int AS n, coalesce(sum(valor), 0)::float8 AS total,
               min(em) AS primeira, max(em) AS ultima,
               CASE WHEN count(*) > 1 THEN (extract(epoch FROM (max(em) - min(em))) / 86400.0 / (count(*) - 1))::float8 END AS intervalo
        FROM compras GROUP BY contact_id
      )
      SELECT a.contact_id, c.nome, c.telefone, c.email, c.tags, c.opted_out_at, a.n, a.total, a.primeira, a.ultima, a.intervalo,
             coalesce((SELECT sum(f.valor_centavos) FROM financeiro_cobrancas f WHERE f.contact_id = a.contact_id AND f.status = 'paga'), 0)::float8 / 100 AS recebido
      FROM agg a JOIN contacts c ON c.id = a.contact_id
      ORDER BY a.ultima DESC
      LIMIT 5000`);

    const agora = Date.now();
    const clientes: ClienteCarteira[] = linhas.map((l) => {
      const dias = Math.max(0, Math.floor((agora - l.ultima.getTime()) / DIA));
      const ciclo = l.intervalo !== null && l.intervalo >= 1 ? Math.round(l.intervalo) : null;
      const prevista = ciclo ? new Date(l.ultima.getTime() + ciclo * DIA) : null;
      return {
        contactId: l.contact_id, nome: l.nome, telefone: l.telefone, email: l.email, tags: l.tags ?? [],
        compras: l.n, totalComprado: arred(l.total), ticketMedio: arred(l.total / l.n), recebido: arred(l.recebido),
        clienteDesde: l.primeira.toISOString(), ultimaCompra: l.ultima.toISOString(), diasSemComprar: dias,
        status: statusDoCliente(dias, ativoDias, riscoDias),
        cicloDias: ciclo,
        proximaCompraPrevista: prevista?.toISOString() ?? null,
        recompraAtrasada: !!(ciclo && prevista && agora > prevista.getTime() + ciclo * 0.2 * DIA),
        optOut: !!l.opted_out_at,
      };
    });

    const conta = (s: StatusCarteira) => clientes.filter((c) => c.status === s).length;
    const total = clientes.reduce((t, c) => t + c.totalComprado, 0);
    const compras = clientes.reduce((t, c) => t + c.compras, 0);
    return {
      limites: { ativoDias, riscoDias },
      resumo: {
        clientes: clientes.length,
        ativos: conta('ativo'),
        emRisco: conta('em_risco'),
        inativos: conta('inativo'),
        recompraAtrasada: clientes.filter((c) => c.recompraAtrasada).length,
        recorrentes: clientes.filter((c) => c.compras > 1).length,
        receitaTotal: arred(total),
        ticketMedio: compras ? arred(total / compras) : 0,
        ltvMedio: clientes.length ? arred(total / clientes.length) : 0,
      },
      clientes,
    };
  }

  /**
   * Marca clientes com uma tag (ex.: "reativacao"). Usa o caminho normal do
   * CRM: a tag nova é gatilho de automação ("Tag adicionada"), que é como a
   * operação liga a campanha de reativação — com o fluxo revisado por ela.
   */
  async marcar(tenantId: string, contactIds: string[], tag: string) {
    const t = tag.trim();
    if (!t || t.length > 40) throw new BadRequestException('tag inválida (1 a 40 caracteres)');
    const ids = [...new Set(contactIds)];
    if (!ids.length || ids.length > 500) throw new BadRequestException('selecione de 1 a 500 clientes');
    const atuais = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findMany({ where: { id: { in: ids } }, select: { id: true, tags: true } }));
    let marcados = 0;
    for (const c of atuais) {
      if (c.tags.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
      await this.crm.updateContact(tenantId, c.id, { tags: [...c.tags, t] });
      marcados++;
    }
    return { ok: true, marcados, jaTinham: atuais.length - marcados, naoEncontrados: ids.length - atuais.length };
  }
}

function limitar(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(n) ? n : min)));
}
const arred = (n: number) => Math.round(n * 100) / 100;
