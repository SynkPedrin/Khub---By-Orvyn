import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FinanceiroTransacao } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_LINHAS_POR_LOTE } from '../crm/importacao.service';
import { dataNoFuso } from '../booking/booking.schema';
import {
  acharMembroPorNomeOuEmail,
  calcularComissaoCentavos,
  chaveImportacao,
  dataPlanilha,
  normalizarTexto,
  statusLancamento,
  tipoLancamento,
  valorEmCentavos,
  type MembroImportacao,
} from './importacao-fin';

type Ator = 'humano' | 'sistema';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidade: string, entidadeId?: string | null, actorType: Ator = 'humano') {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, ${actorType}, ${actorId}, ${acao}, ${entidade}, ${entidadeId ?? null}::uuid)`;
}

/** Fuso das datas de competência geradas pela agenda (o produto é BR; mesmo padrão das páginas de agendamento). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

export const ORIGENS = ['manual', 'agenda', 'cobranca', 'importacao', 'comissao'] as const;
export type Origem = (typeof ORIGENS)[number];

export interface CategoriaInput {
  nome: string;
  tipo: 'entrada' | 'saida';
  cor?: string | null;
}

export interface TransacaoInput {
  tipo: 'entrada' | 'saida';
  descricao: string;
  valorCentavos: number;
  categoriaId?: string | null;
  dataCompetencia?: string | null; // YYYY-MM-DD
  status?: 'pago' | 'pendente';
  contactId?: string | null;
  responsavelId?: string | null;
  observacao?: string | null;
}

export type TransacaoPatch = Partial<Omit<TransacaoInput, 'tipo'>>;

export interface FiltroTransacao {
  de?: string;
  ate?: string;
  tipo?: string;
  categoriaId?: string;
  responsavelId?: string;
  status?: string;
  origem?: string;
}

/** Linha da importação de lançamentos, já mapeada pelo front (tudo texto). */
export interface LinhaFinanceiro {
  tipo?: string;
  descricao?: string;
  valor?: string;
  data?: string;
  categoria?: string;
  status?: string;
  responsavel?: string;
  /** Ocorrência desta linha (conteúdo idêntico) no arquivo, base 1. */
  ocorrencia?: number;
}

export interface OpcoesImportacaoFin {
  /** false (padrão): importação de histórico não gera comissão (já paga no sistema antigo). */
  gerarComissoes?: boolean;
}

export interface ResultadoImportacaoFin {
  total: number;
  criados: number;
  /** Linhas já importadas antes (mesma chave) ou canceladas na origem. */
  ignorados: number;
  erros: { linha: number; motivo: string }[];
  avisos: { linha: number; motivo: string }[];
}

const CATEGORIAS_PADRAO: [string, 'entrada' | 'saida'][] = [
  ['Serviços', 'entrada'],
  ['Produtos', 'entrada'],
  ['Pacotes', 'entrada'],
  ['Outras receitas', 'entrada'],
  ['Salários', 'saida'],
  ['Comissões', 'saida'],
  ['Aluguel', 'saida'],
  ['Fornecedores', 'saida'],
  ['Marketing', 'saida'],
  ['Impostos', 'saida'],
  ['Outras despesas', 'saida'],
];

/** "YYYY-MM-DD" → Date ao meio-dia UTC (coluna DATE: sem risco de virar o dia). */
export function dataCompetencia(v: string | null | undefined): Date {
  if (!v) return new Date(`${dataNoFuso(Date.now(), FUSO_PADRAO)}T12:00:00Z`);
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(`${v}T12:00:00Z`) : new Date(NaN);
  if (isNaN(+d) || d.getUTCDate() !== Number(m?.[3])) throw new BadRequestException('data inválida (use AAAA-MM-DD)');
  return d;
}

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

type TransacaoRow = FinanceiroTransacao;

/**
 * Fluxo de caixa da empresa: categorias, entradas/saídas e o resumo que mostra
 * pra onde o dinheiro está indo. Também concentra os gatilhos que viram
 * entrada automaticamente (cobrança paga, atendimento concluído) e a geração
 * de comissão por responsável, sempre dentro da MESMA transação do chamador.
 *
 * Idempotência: uma entrada por cobrança/atendimento e uma comissão por entrada
 * (checagem aqui + índices únicos da db/070 como rede de segurança).
 */
@Injectable()
export class CaixaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria o kit inicial de categorias na primeira vez que o tenant abre o módulo. */
  private async garantirPadroes(tx: Prisma.TransactionClient, tenantId: string) {
    const total = await tx.financeiroCategoria.count();
    if (total > 0) return;
    // skipDuplicates: dois acessos simultâneos no primeiro uso não quebram.
    await tx.financeiroCategoria.createMany({
      data: CATEGORIAS_PADRAO.map(([nome, tipo]) => ({ tenantId, nome, tipo })),
      skipDuplicates: true,
    });
  }

  async listarCategorias(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.garantirPadroes(tx, tenantId);
      return tx.financeiroCategoria.findMany({ orderBy: [{ tipo: 'asc' }, { nome: 'asc' }] });
    });
  }

  async criarCategoria(tenantId: string, identityId: string, dto: CategoriaInput) {
    const nome = dto.nome.trim();
    if (!nome) throw new BadRequestException('informe o nome da categoria');
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const cat = await tx.financeiroCategoria.create({ data: { tenantId, nome, tipo: dto.tipo, cor: dto.cor ?? null } });
        await audit(tx, tenantId, identityId, 'categoria.criada', 'financeiro_categoria', cat.id);
        return cat;
      });
    } catch (e) {
      if (ehUnico(e)) throw new ConflictException('já existe uma categoria com esse nome');
      throw e;
    }
  }

  async atualizarCategoria(tenantId: string, identityId: string, id: string, patch: Partial<Omit<CategoriaInput, 'tipo'>>) {
    const nome = patch.nome !== undefined ? patch.nome.trim() : undefined;
    if (nome === '') throw new BadRequestException('informe o nome da categoria');
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const existe = await tx.financeiroCategoria.findFirst({ where: { id }, select: { id: true } });
        if (!existe) throw new NotFoundException('categoria inexistente');
        const cat = await tx.financeiroCategoria.update({
          where: { id },
          data: { ...(nome !== undefined ? { nome } : {}), ...(patch.cor !== undefined ? { cor: patch.cor } : {}) },
        });
        await audit(tx, tenantId, identityId, 'categoria.editada', 'financeiro_categoria', id);
        return cat;
      });
    } catch (e) {
      if (ehUnico(e)) throw new ConflictException('já existe uma categoria com esse nome');
      throw e;
    }
  }

  async removerCategoria(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.financeiroCategoria.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('categoria inexistente');
      // Transações que usavam ficam sem categoria (ON DELETE SET NULL).
      await tx.financeiroCategoria.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'categoria.removida', 'financeiro_categoria', id);
      return { ok: true };
    });
  }

  async listarTransacoes(tenantId: string, filtro: FiltroTransacao = {}) {
    const where: Prisma.FinanceiroTransacaoWhereInput = {};
    const de = filtro.de ? dataCompetencia(filtro.de) : undefined;
    const ate = filtro.ate ? dataCompetencia(filtro.ate) : undefined;
    if (de || ate) where.dataCompetencia = { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) };
    if (filtro.tipo === 'entrada' || filtro.tipo === 'saida') where.tipo = filtro.tipo;
    if (filtro.categoriaId) where.categoriaId = filtro.categoriaId;
    if (filtro.responsavelId) where.responsavelId = filtro.responsavelId;
    if (filtro.status === 'pago' || filtro.status === 'pendente') where.status = filtro.status;
    if (filtro.origem && (ORIGENS as readonly string[]).includes(filtro.origem)) where.origem = filtro.origem;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const transacoes = await tx.financeiroTransacao.findMany({ where, orderBy: [{ dataCompetencia: 'desc' }, { createdAt: 'desc' }] });
      const categorias = await tx.financeiroCategoria.findMany({ select: { id: true, nome: true, tipo: true, cor: true } });
      const porId = new Map(categorias.map((c) => [c.id, c]));
      return transacoes.map(({ chaveImportacao: _chave, ...t }) => ({ ...t, categoria: t.categoriaId ? (porId.get(t.categoriaId) ?? null) : null }));
    });
  }

  /** Categoria do tipo certo, contato e responsável do MESMO tenant. */
  private async validarReferencias(
    tx: Prisma.TransactionClient,
    tenantId: string,
    tipo: 'entrada' | 'saida',
    refs: { categoriaId?: string | null; contactId?: string | null; responsavelId?: string | null },
  ) {
    if (refs.categoriaId) {
      const cat = await tx.financeiroCategoria.findFirst({ where: { id: refs.categoriaId }, select: { tipo: true } });
      if (!cat) throw new BadRequestException('categoria inexistente');
      if (cat.tipo !== tipo) throw new BadRequestException(`essa categoria é de ${cat.tipo === 'entrada' ? 'entrada' : 'saída'}`);
    }
    if (refs.contactId) {
      const c = await tx.contact.findFirst({ where: { id: refs.contactId }, select: { id: true } });
      if (!c) throw new BadRequestException('contato inexistente');
    }
    if (refs.responsavelId) {
      const m = await tx.membership.findFirst({ where: { tenantId, identityId: refs.responsavelId }, select: { id: true } });
      if (!m) throw new BadRequestException('responsável não é membro desta conta');
    }
  }

  async criarTransacao(tenantId: string, identityId: string, dto: TransacaoInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const t = await this.criarNoTx(tx, tenantId, identityId, dto, 'manual');
      await audit(tx, tenantId, identityId, 'transacao.criada', 'financeiro_transacao', t.id);
      return t;
    });
  }

  /** Núcleo de criação reutilizável dentro de uma transação aberta (gatilhos/importação). */
  async criarNoTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    identityId: string | null,
    dto: TransacaoInput & { cobrancaId?: string | null; compromissoId?: string | null; chaveImportacao?: string | null },
    origem: Origem,
    opcoes: { gerarComissao?: boolean } = {},
  ): Promise<TransacaoRow> {
    const descricao = dto.descricao.trim().slice(0, 200);
    if (!descricao) throw new BadRequestException('informe a descrição');
    if (!Number.isInteger(dto.valorCentavos) || dto.valorCentavos <= 0) throw new BadRequestException('valor inválido (centavos, inteiro > 0)');
    await this.validarReferencias(tx, tenantId, dto.tipo, dto);
    const t = await tx.financeiroTransacao.create({
      data: {
        tenantId,
        tipo: dto.tipo,
        descricao,
        valorCentavos: dto.valorCentavos,
        categoriaId: dto.categoriaId ?? null,
        dataCompetencia: dataCompetencia(dto.dataCompetencia),
        status: dto.status ?? 'pago',
        contactId: dto.contactId ?? null,
        responsavelId: dto.responsavelId ?? null,
        cobrancaId: dto.cobrancaId ?? null,
        compromissoId: dto.compromissoId ?? null,
        chaveImportacao: dto.chaveImportacao ?? null,
        observacao: dto.observacao ?? null,
        origem,
        createdBy: identityId,
      },
    });
    if (opcoes.gerarComissao !== false) await this.gerarComissao(tx, tenantId, t);
    return t;
  }

  /**
   * Entrada PAGA atribuída a um membro com % de comissão → comissão prevista
   * na competência (mês) da entrada. Uma por transação. Arredondamento: meio
   * para cima no centavo (calcularComissaoCentavos).
   */
  private async gerarComissao(tx: Prisma.TransactionClient, tenantId: string, t: Pick<TransacaoRow, 'id' | 'tipo' | 'status' | 'responsavelId' | 'valorCentavos' | 'dataCompetencia'>) {
    if (t.tipo !== 'entrada' || t.status !== 'pago' || !t.responsavelId) return;
    const cfg = await tx.equipeComissao.findUnique({ where: { tenantId_identityId: { tenantId, identityId: t.responsavelId } } });
    if (!cfg) return;
    const valor = calcularComissaoCentavos(t.valorCentavos, cfg.comissaoPercent);
    if (valor <= 0) return;
    const ja = await tx.financeiroComissao.findFirst({ where: { transacaoId: t.id }, select: { id: true } });
    if (ja) return;
    const comp = t.dataCompetencia;
    await tx.financeiroComissao.create({
      data: {
        tenantId,
        identityId: t.responsavelId,
        transacaoId: t.id,
        baseCentavos: t.valorCentavos,
        percent: cfg.comissaoPercent,
        valorCentavos: valor,
        competencia: new Date(Date.UTC(comp.getUTCFullYear(), comp.getUTCMonth(), 1)),
      },
    });
  }

  /** Comissão já paga desta entrada? Então valor/responsável/data/status não podem mais mudar. */
  private async exigirComissaoNaoPaga(tx: Prisma.TransactionClient, transacaoId: string, mensagem: string) {
    const paga = await tx.financeiroComissao.findFirst({ where: { transacaoId, status: 'paga' }, select: { id: true } });
    if (paga) throw new ConflictException(mensagem);
  }

  /** Refaz a comissão prevista depois de mudar valor/responsável/data/status da entrada. */
  private async recalcularComissao(tx: Prisma.TransactionClient, tenantId: string, t: TransacaoRow, sempre: boolean) {
    const removidas = await tx.financeiroComissao.deleteMany({ where: { transacaoId: t.id, status: 'prevista' } });
    // Importação sem comissão (histórico já pago no sistema antigo) continua sem.
    if (sempre || removidas.count > 0 || t.origem !== 'importacao') await this.gerarComissao(tx, tenantId, t);
  }

  async atualizarTransacao(tenantId: string, identityId: string, id: string, patch: TransacaoPatch) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.financeiroTransacao.findFirst({ where: { id } });
      if (!atual) throw new NotFoundException('lançamento inexistente');
      const descricao = patch.descricao !== undefined ? patch.descricao.trim() : undefined;
      if (descricao === '') throw new BadRequestException('informe a descrição');
      if (patch.valorCentavos !== undefined && (!Number.isInteger(patch.valorCentavos) || patch.valorCentavos <= 0)) {
        throw new BadRequestException('valor inválido (centavos, inteiro > 0)');
      }
      const novaData = patch.dataCompetencia !== undefined ? dataCompetencia(patch.dataCompetencia) : undefined;
      const mexeNoDinheiro =
        (patch.valorCentavos !== undefined && patch.valorCentavos !== atual.valorCentavos) ||
        (patch.responsavelId !== undefined && patch.responsavelId !== atual.responsavelId) ||
        (patch.status !== undefined && patch.status !== atual.status) ||
        (novaData !== undefined && +novaData !== +atual.dataCompetencia);
      if (mexeNoDinheiro && atual.origem === 'comissao') {
        throw new ConflictException('este lançamento é o pagamento de uma comissão: para desfazer, estorne o pagamento em Comissões');
      }
      if (mexeNoDinheiro) await this.exigirComissaoNaoPaga(tx, id, 'a comissão desta entrada já foi paga: estorne o pagamento da comissão antes de mudar valor, profissional, data ou status');
      await this.validarReferencias(tx, tenantId, atual.tipo as 'entrada' | 'saida', {
        categoriaId: patch.categoriaId,
        contactId: patch.contactId,
        responsavelId: patch.responsavelId,
      });
      const t = await tx.financeiroTransacao.update({
        where: { id },
        data: {
          ...(descricao !== undefined ? { descricao: descricao.slice(0, 200) } : {}),
          ...(patch.valorCentavos !== undefined ? { valorCentavos: patch.valorCentavos } : {}),
          ...(patch.categoriaId !== undefined ? { categoriaId: patch.categoriaId } : {}),
          ...(novaData !== undefined ? { dataCompetencia: novaData } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}),
          ...(patch.responsavelId !== undefined ? { responsavelId: patch.responsavelId } : {}),
          ...(patch.observacao !== undefined ? { observacao: patch.observacao } : {}),
          updatedAt: new Date(),
        },
      });
      if (mexeNoDinheiro) await this.recalcularComissao(tx, tenantId, t, false);
      await audit(tx, tenantId, identityId, 'transacao.editada', 'financeiro_transacao', id);
      return t;
    });
  }

  async statusTransacao(tenantId: string, identityId: string, id: string, status: 'pago' | 'pendente') {
    return this.atualizarTransacao(tenantId, identityId, id, { status });
  }

  /**
   * Exclui o lançamento. Entrada com comissão já paga → 409 (estornar antes).
   * Se for o pagamento de uma comissão, a comissão volta para "prevista".
   */
  async removerTransacao(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.financeiroTransacao.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('lançamento inexistente');
      await this.exigirComissaoNaoPaga(tx, id, 'a comissão desta entrada já foi paga: estorne o pagamento da comissão antes de excluir');
      await tx.financeiroComissao.updateMany({
        where: { pagamentoTransacaoId: id },
        data: { status: 'prevista', pagoEm: null, pagamentoTransacaoId: null },
      });
      await tx.financeiroTransacao.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'transacao.removida', 'financeiro_transacao', id);
      return { ok: true };
    });
  }

  /**
   * Resumo do período: totais de entrada/saída (pagos), a receber/a pagar
   * (pendentes), saldo e quebra por categoria e por dia: o "pra onde o
   * dinheiro está indo". Somas em bigint no banco, devolvidas em número.
   */
  async fluxo(tenantId: string, filtro: { de?: string; ate?: string } = {}) {
    const de = filtro.de ? dataCompetencia(filtro.de) : null;
    const ate = filtro.ate ? dataCompetencia(filtro.ate) : null;
    if (de && ate && de > ate) throw new BadRequestException('o início do período é depois do fim');
    const periodo = Prisma.sql`
      ${de ? Prisma.sql`AND t.data_competencia >= ${de}::date` : Prisma.empty}
      ${ate ? Prisma.sql`AND t.data_competencia <= ${ate}::date` : Prisma.empty}`;
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.garantirPadroes(tx, tenantId);
      const totais = await tx.$queryRaw<{ tipo: string; status: string; total: bigint; qtd: bigint }[]>`
        SELECT t.tipo, t.status, COALESCE(SUM(t.valor_centavos), 0)::bigint AS total, COUNT(*)::bigint AS qtd
        FROM financeiro_transacoes t
        WHERE t.tenant_id = ${tenantId}::uuid ${periodo}
        GROUP BY t.tipo, t.status`;
      const porCategoria = await tx.$queryRaw<{ categoriaId: string | null; nome: string | null; tipo: string; total: bigint; qtd: bigint }[]>`
        SELECT t.categoria_id AS "categoriaId", c.nome, t.tipo,
               COALESCE(SUM(t.valor_centavos), 0)::bigint AS total, COUNT(*)::bigint AS qtd
        FROM financeiro_transacoes t
        LEFT JOIN financeiro_categorias c ON c.id = t.categoria_id
        WHERE t.tenant_id = ${tenantId}::uuid AND t.status = 'pago' ${periodo}
        GROUP BY t.categoria_id, c.nome, t.tipo
        ORDER BY total DESC`;
      const porDia = await tx.$queryRaw<{ dia: string; tipo: string; total: bigint }[]>`
        SELECT t.data_competencia::text AS dia, t.tipo, COALESCE(SUM(t.valor_centavos), 0)::bigint AS total
        FROM financeiro_transacoes t
        WHERE t.tenant_id = ${tenantId}::uuid AND t.status = 'pago' ${periodo}
        GROUP BY t.data_competencia, t.tipo
        ORDER BY t.data_competencia`;
      const soma = (tipo: string, status: string) => Number(totais.find((r) => r.tipo === tipo && r.status === status)?.total ?? 0);
      return {
        entradasCentavos: soma('entrada', 'pago'),
        saidasCentavos: soma('saida', 'pago'),
        saldoCentavos: soma('entrada', 'pago') - soma('saida', 'pago'),
        aReceberCentavos: soma('entrada', 'pendente'),
        aPagarCentavos: soma('saida', 'pendente'),
        porCategoria: porCategoria.map((r) => ({ ...r, total: Number(r.total), qtd: Number(r.qtd) })),
        porDia: porDia.map((r) => ({ ...r, total: Number(r.total) })),
      };
    });
  }

  /**
   * Importação em lote (CSV/XLSX do Avec ou planilha, já mapeada pelo front).
   * - valor/data/tipo/status lidos no formato brasileiro (importacao-fin.ts);
   * - reimportar o mesmo arquivo não duplica (chave por conteúdo + ocorrência);
   * - categoria inexistente é criada; profissional casa por nome ou e-mail
   *   (sem acento/caixa) e, se não achar, a linha entra sem ele (aviso);
   * - cada linha roda num SAVEPOINT: erro de uma não aborta as demais;
   * - comissão só com `gerarComissoes` (histórico costuma já estar pago).
   * `linhaInicial` = número da 1ª linha deste lote no arquivo (relatório).
   */
  async importar(tenantId: string, identityId: string, linhas: LinhaFinanceiro[], opcoes: OpcoesImportacaoFin = {}, linhaInicial = 1): Promise<ResultadoImportacaoFin> {
    if (!Array.isArray(linhas) || linhas.length === 0) throw new BadRequestException('nenhuma linha para importar');
    if (linhas.length > MAX_LINHAS_POR_LOTE) throw new BadRequestException(`lote máximo de ${MAX_LINHAS_POR_LOTE} linhas`);
    const res: ResultadoImportacaoFin = { total: linhas.length, criados: 0, ignorados: 0, erros: [], avisos: [] };
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.garantirPadroes(tx, tenantId);
      const membros = await tx.$queryRaw<MembroImportacao[]>`
        SELECT m.identity_id AS "identityId", u.nome, i.email
        FROM memberships m JOIN identities i ON i.id = m.identity_id
        LEFT JOIN users u ON u.identity_id = m.identity_id AND u.tenant_id = m.tenant_id
        WHERE m.tenant_id = ${tenantId}::uuid`;
      const acharMembro = (v: string) => acharMembroPorNomeOuEmail(membros, v);
      const categorias = new Map(
        (await tx.financeiroCategoria.findMany({ select: { id: true, nome: true, tipo: true } })).map((c) => [`${c.tipo}:${normalizarTexto(c.nome)}`, c.id]),
      );

      for (let i = 0; i < linhas.length; i++) {
        const nLinha = linhaInicial + i;
        const l = (linhas[i] ?? {}) as LinhaFinanceiro;
        await tx.$executeRawUnsafe('SAVEPOINT fin_linha');
        try {
          const status = statusLancamento(l.status);
          if (status === null) throw new Error(`status não reconhecido: "${String(l.status).slice(0, 40)}" (use pago ou pendente)`);
          if (status === 'cancelado') {
            res.ignorados++;
            res.avisos.push({ linha: nLinha, motivo: 'lançamento cancelado na origem: não entra no caixa' });
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT fin_linha');
            continue;
          }
          const descricao = String(l.descricao ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
          if (!descricao) throw new Error('sem descrição');
          const centavos = valorEmCentavos(l.valor);
          if (centavos === null || centavos === 0) throw new Error(`valor inválido: "${String(l.valor ?? '').slice(0, 40)}"`);
          const tipo = tipoLancamento(l.tipo, centavos < 0);
          if (!tipo) throw new Error(`tipo não reconhecido: "${String(l.tipo).slice(0, 40)}" (use entrada ou saída)`);
          let data: string | null = null;
          if (String(l.data ?? '').trim()) {
            data = dataPlanilha(l.data);
            if (!data) throw new Error(`data inválida: "${String(l.data).slice(0, 40)}" (use dd/mm/aaaa)`);
          }
          const chave = chaveImportacao(
            { tipo: l.tipo, descricao: l.descricao, valor: l.valor, data: l.data, categoria: l.categoria, status: l.status, responsavel: l.responsavel },
            Number(l.ocorrencia ?? 1),
          );
          const ja = await tx.financeiroTransacao.findFirst({ where: { chaveImportacao: chave }, select: { id: true } });
          if (ja) {
            res.ignorados++;
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT fin_linha');
            continue;
          }
          let categoriaId: string | null = null;
          const nomeCat = String(l.categoria ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
          if (nomeCat) {
            const k = `${tipo}:${normalizarTexto(nomeCat)}`;
            categoriaId = categorias.get(k) ?? null;
            if (!categoriaId) {
              categoriaId = (await tx.financeiroCategoria.create({ data: { tenantId, nome: nomeCat, tipo }, select: { id: true } })).id;
              categorias.set(k, categoriaId);
            }
          }
          let responsavelId: string | null = null;
          const nomeResp = String(l.responsavel ?? '').trim();
          if (nomeResp) {
            responsavelId = acharMembro(nomeResp);
            if (!responsavelId) res.avisos.push({ linha: nLinha, motivo: `profissional "${nomeResp.slice(0, 60)}" não encontrado na equipe: importado sem profissional` });
            else if (tipo === 'saida') responsavelId = null;
          }
          await this.criarNoTx(tx, tenantId, identityId, {
            tipo,
            descricao,
            valorCentavos: Math.abs(centavos),
            categoriaId,
            dataCompetencia: data,
            status,
            responsavelId,
            chaveImportacao: chave,
          }, 'importacao', { gerarComissao: !!opcoes.gerarComissoes });
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fin_linha');
          res.criados++;
        } catch (e) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fin_linha');
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          res.erros.push({ linha: nLinha, motivo: (msg.split('\n').pop() ?? msg).slice(0, 200) });
        }
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'transacao.importacao', 'financeiro_transacao', NULL,
                ${JSON.stringify({ total: res.total, criados: res.criados, ignorados: res.ignorados, erros: res.erros.length, linhaInicial, gerarComissoes: !!opcoes.gerarComissoes })}::jsonb)`;
    }, { timeout: 120_000, maxWait: 10_000 });
    return res;
  }

  // --------------------- gatilhos (outros módulos) ---------------------

  /**
   * Cobrança ↔ caixa. Paga → garante UMA entrada (origem 'cobranca', na data do
   * pagamento). Saiu de "paga" (cancelada/reaberta) → a entrada automática sai.
   * Idempotente: chamar duas vezes não duplica.
   */
  async sincronizarCobranca(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cob: { id: string; descricao: string; valorCentavos: number; contactId: string | null; status: string; pagoEm: Date | null },
  ) {
    const existente = await tx.financeiroTransacao.findFirst({ where: { cobrancaId: cob.id } });
    if (cob.status !== 'paga') {
      if (existente) {
        await this.exigirComissaoNaoPaga(tx, existente.id, 'a comissão da entrada desta cobrança já foi paga: estorne o pagamento da comissão antes');
        await tx.financeiroTransacao.delete({ where: { id: existente.id } });
      }
      return null;
    }
    if (existente || cob.valorCentavos <= 0) return existente;
    return this.criarNoTx(tx, tenantId, null, {
      tipo: 'entrada',
      descricao: cob.descricao,
      valorCentavos: cob.valorCentavos,
      contactId: cob.contactId,
      cobrancaId: cob.id,
      dataCompetencia: dataNoFuso(+(cob.pagoEm ?? new Date()), FUSO_PADRAO),
      status: 'pago',
    }, 'cobranca');
  }

  /**
   * Atendimento ↔ caixa. Concluído com valor → UMA entrada (categoria
   * "Serviços", competência = dia do atendimento) + comissão do responsável.
   * Mudou valor/responsável depois de concluído → entrada e comissão prevista
   * acompanham. Deixou de estar concluído ou ficou sem valor → a entrada sai.
   * Comissão já paga trava qualquer mudança no dinheiro (409).
   */
  async sincronizarCompromisso(
    tx: Prisma.TransactionClient,
    tenantId: string,
    c: { id: string; titulo: string; valorCentavos: number | null; contactId: string | null; responsavelId: string | null; status: string; inicio: Date },
    opcoes: { gerarComissao?: boolean } = {},
  ) {
    const deve = c.status === 'concluido' && !!c.valorCentavos && c.valorCentavos > 0;
    const existente = await tx.financeiroTransacao.findFirst({ where: { compromissoId: c.id } });
    const travada = 'a comissão deste atendimento já foi paga: estorne o pagamento em Financeiro > Comissões antes de mudar o atendimento';
    if (!deve) {
      if (existente) {
        await this.exigirComissaoNaoPaga(tx, existente.id, travada);
        await tx.financeiroTransacao.delete({ where: { id: existente.id } });
      }
      return null;
    }
    const valorCentavos = c.valorCentavos as number;
    if (!existente) {
      await this.garantirPadroes(tx, tenantId);
      const servicos = await tx.financeiroCategoria.findFirst({ where: { tipo: 'entrada', nome: { equals: 'Serviços', mode: 'insensitive' } }, select: { id: true } });
      return this.criarNoTx(tx, tenantId, null, {
        tipo: 'entrada',
        descricao: c.titulo,
        valorCentavos,
        categoriaId: servicos?.id ?? null,
        contactId: c.contactId,
        responsavelId: c.responsavelId,
        compromissoId: c.id,
        dataCompetencia: dataNoFuso(+c.inicio, FUSO_PADRAO),
        status: 'pago',
      }, 'agenda', { gerarComissao: opcoes.gerarComissao !== false });
    }
    const mudouDinheiro = existente.valorCentavos !== valorCentavos || existente.responsavelId !== c.responsavelId;
    if (!mudouDinheiro && existente.contactId === c.contactId && existente.descricao === c.titulo.slice(0, 200)) return existente;
    if (mudouDinheiro) await this.exigirComissaoNaoPaga(tx, existente.id, travada);
    const t = await tx.financeiroTransacao.update({
      where: { id: existente.id },
      data: { valorCentavos, responsavelId: c.responsavelId, contactId: c.contactId, descricao: c.titulo.slice(0, 200), updatedAt: new Date() },
    });
    if (mudouDinheiro) await this.recalcularComissao(tx, tenantId, t, opcoes.gerarComissao !== false);
    return t;
  }
}
