import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHAVE_RE,
  ehTipo,
  montarFiltroCampos,
  normalizarOpcoes,
  opcoesDe,
  slugChave,
  tituloErros,
  validarValores,
  type DefCampo,
  type EntidadeCampo,
  type ErroCampo,
  type TipoCampo,
} from './custom-fields';

/** Teto por entidade: acima disso o formulário deixa de ser usável. */
export const MAX_CAMPOS_POR_ENTIDADE = 200;

export interface CustomFieldView {
  id: string;
  entidade: EntidadeCampo;
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  opcoes: string[];
  obrigatorio: boolean;
  ordem: number;
  grupo: string | null;
  arquivado: boolean;
  arquivadoEm: Date | null;
}

export interface CriarCampoInput {
  entidade: EntidadeCampo;
  rotulo: string;
  tipo: TipoCampo;
  chave?: string;
  opcoes?: string[];
  obrigatorio?: boolean;
  grupo?: string | null;
}

export interface AtualizarCampoInput {
  rotulo?: string;
  tipo?: TipoCampo;
  opcoes?: string[];
  obrigatorio?: boolean;
  grupo?: string | null;
}

/** Tabela que guarda os valores de cada entidade (lista fechada: nunca vem do cliente). */
const TABELA: Record<EntidadeCampo, Prisma.Sql> = {
  contact: Prisma.sql`contacts`,
  deal: Prisma.sql`deals`,
  company: Prisma.sql`companies`,
};

const view = (d: {
  id: string; entidade: string; chave: string; rotulo: string; tipo: string; opcoes: Prisma.JsonValue;
  obrigatorio: boolean; ordem: number; grupo: string | null; arquivadoEm: Date | null;
}): CustomFieldView => ({
  id: d.id,
  entidade: d.entidade as EntidadeCampo,
  chave: d.chave,
  rotulo: d.rotulo,
  tipo: d.tipo as TipoCampo,
  opcoes: opcoesDe(d),
  obrigatorio: d.obrigatorio,
  ordem: d.ordem,
  grupo: d.grupo,
  arquivado: d.arquivadoEm !== null,
  arquivadoEm: d.arquivadoEm,
});

/** Erro RFC 7807 com a lista de campos (extensão `campos`, ver ProblemDetailsFilter). */
export function erroCampos(erros: ErroCampo[]): BadRequestException {
  return new BadRequestException({ message: tituloErros(erros), code: 'campos_custom_invalidos', campos: erros });
}

/** Definições da entidade, lidas DENTRO da transação do chamador (RLS do tenant). */
export async function carregarDefs(tx: Prisma.TransactionClient, entidade: EntidadeCampo): Promise<DefCampo[]> {
  return tx.customFieldDef.findMany({
    where: { entidade },
    orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    select: { chave: true, rotulo: true, tipo: true, opcoes: true, obrigatorio: true, arquivadoEm: true },
  });
}

/**
 * Valida (e mescla) valores de campos personalizados dentro de uma transação
 * já aberta em `withTenant`. Lança 400 RFC 7807 com `campos: [{chave, rotulo, erro}]`.
 * Usado pelo CRUD de contato, negócio e empresa.
 */
export async function validarCamposNaTransacao(
  tx: Prisma.TransactionClient,
  entidade: EntidadeCampo,
  valores: Record<string, unknown>,
  opts: { atuais?: Record<string, unknown>; exigirObrigatorios?: boolean } = {},
): Promise<Record<string, unknown>> {
  const r = validarValores(await carregarDefs(tx, entidade), valores, opts);
  if (!r.ok) throw erroCampos(r.erros);
  return r.valores;
}

/**
 * Filtro `cf_*` da lista de contatos resolvido pelo TIPO das definições
 * (dentro da transação do chamador). Valor fora do tipo → 400 com `campos`.
 */
export async function filtroCamposContato(tx: Prisma.TransactionClient, cf: Record<string, string> | undefined): Promise<Prisma.ContactWhereInput[] | undefined> {
  if (!cf || !Object.keys(cf).length) return undefined;
  const r = montarFiltroCampos(await carregarDefs(tx, 'contact'), cf);
  if (r.erros.length) throw erroCampos(r.erros);
  return r.condicoes;
}

const objeto = (v: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Definições de campos personalizados (Q2.3). Escrita restrita a owner/admin
 * pelo PermissionsGuard (`custom-fields` → organization.manage).
 */
@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, entidade: EntidadeCampo, incluirArquivados = true): Promise<CustomFieldView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.customFieldDef.findMany({
        where: { entidade, ...(incluirArquivados ? {} : { arquivadoEm: null }) },
        orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(view);
    });
  }

  async create(tenantId: string, input: CriarCampoInput): Promise<CustomFieldView> {
    const rotulo = input.rotulo.trim();
    if (!rotulo) throw new BadRequestException('informe o nome do campo');
    const op = normalizarOpcoes(input.tipo, input.opcoes);
    if (!op.ok) throw new BadRequestException(op.erro);
    const chavePedida = input.chave?.trim();
    if (chavePedida !== undefined && chavePedida !== '' && !CHAVE_RE.test(chavePedida)) {
      throw new BadRequestException('chave inválida: use letras minúsculas, números e _, começando por letra (até 50)');
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const existentes = await tx.customFieldDef.findMany({ where: { entidade: input.entidade }, select: { chave: true, ordem: true } });
      if (existentes.length >= MAX_CAMPOS_POR_ENTIDADE) throw new ConflictException(`limite de ${MAX_CAMPOS_POR_ENTIDADE} campos por entidade atingido`);
      const usadas = new Set(existentes.map((e) => e.chave));

      let chave: string;
      if (chavePedida) {
        if (usadas.has(chavePedida)) throw new ConflictException(`já existe um campo com a chave "${chavePedida}"`);
        chave = chavePedida;
      } else {
        const base = slugChave(rotulo);
        chave = base;
        for (let i = 2; usadas.has(chave); i++) chave = `${base.slice(0, 46)}_${i}`;
      }

      const ordem = existentes.reduce((m, e) => Math.max(m, e.ordem), -1) + 1;
      try {
        const d = await tx.customFieldDef.create({
          data: {
            tenantId, entidade: input.entidade, chave, rotulo, tipo: input.tipo, opcoes: op.opcoes,
            obrigatorio: input.obrigatorio ?? false, ordem, grupo: input.grupo?.trim() || null,
          },
        });
        return view(d);
      } catch (e) {
        // corrida entre duas criações com o mesmo slug: a UNIQUE do banco decide
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`já existe um campo com a chave "${chave}"`);
        throw e;
      }
    });
  }

  async update(tenantId: string, id: string, input: AtualizarCampoInput): Promise<CustomFieldView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.customFieldDef.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('campo inexistente');
      if (input.rotulo !== undefined && !input.rotulo.trim()) throw new BadRequestException('informe o nome do campo');

      const tipo = input.tipo ?? (atual.tipo as TipoCampo);
      if (!ehTipo(tipo)) throw new BadRequestException('tipo inválido');
      // Trocar o tipo de um campo com dados deixaria valores gravados fora do
      // formato (ex.: "abc" num campo que virou número). Só sem uso.
      if (tipo !== atual.tipo) {
        const emUso = await this.contarUso(tx, atual.entidade as EntidadeCampo, atual.chave);
        if (emUso > 0) throw new ConflictException(`não é possível trocar o tipo: ${emUso} registro(s) já têm valor neste campo`);
      }

      let opcoes: string[] | undefined;
      if (input.opcoes !== undefined || tipo !== atual.tipo) {
        const op = normalizarOpcoes(tipo, input.opcoes ?? opcoesDe(atual));
        if (!op.ok) throw new BadRequestException(op.erro);
        opcoes = op.opcoes;
      }

      const d = await tx.customFieldDef.update({
        where: { id },
        data: {
          rotulo: input.rotulo?.trim() ?? undefined,
          tipo,
          opcoes,
          obrigatorio: input.obrigatorio ?? undefined,
          grupo: input.grupo === undefined ? undefined : input.grupo?.trim() || null,
          updatedAt: new Date(),
        },
      });
      return view(d);
    });
  }

  /** Arquivar: some do formulário e do filtro; os valores gravados ficam intactos. */
  async arquivar(tenantId: string, id: string, arquivado: boolean): Promise<CustomFieldView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.customFieldDef.findUnique({ where: { id }, select: { id: true, arquivadoEm: true } });
      if (!atual) throw new NotFoundException('campo inexistente');
      const d = await tx.customFieldDef.update({
        where: { id },
        data: { arquivadoEm: arquivado ? atual.arquivadoEm ?? new Date() : null, updatedAt: new Date() },
      });
      return view(d);
    });
  }

  /**
   * Excluir a DEFINIÇÃO. Só sem dados: com valores gravados devolve 409 e o
   * caminho é arquivar (exclusão com valores seria perda silenciosa de dado).
   */
  async remove(tenantId: string, id: string): Promise<{ ok: true }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.customFieldDef.findUnique({ where: { id }, select: { id: true, entidade: true, chave: true } });
      if (!atual) throw new NotFoundException('campo inexistente');
      const emUso = await this.contarUso(tx, atual.entidade as EntidadeCampo, atual.chave);
      if (emUso > 0) throw new ConflictException({ message: `${emUso} registro(s) têm valor neste campo: arquive em vez de excluir`, code: 'campo_em_uso', emUso });
      await tx.customFieldDef.delete({ where: { id } });
      return { ok: true };
    });
  }

  /** Nova ordem: `ids` na sequência desejada (todos da mesma entidade). */
  async reordenar(tenantId: string, entidade: EntidadeCampo, ids: string[]): Promise<CustomFieldView[]> {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('ids repetidos');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.customFieldDef.findMany({ where: { entidade }, select: { id: true } });
      const daEntidade = new Set(rows.map((r) => r.id));
      const fora = ids.filter((i) => !daEntidade.has(i));
      if (fora.length) throw new NotFoundException('campo inexistente nesta entidade');
      // os que não vieram na lista vão para o fim, na ordem relativa atual
      const resto = (await tx.customFieldDef.findMany({ where: { entidade, id: { notIn: ids } }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }], select: { id: true } })).map((r) => r.id);
      const sequencia = [...ids, ...resto];
      for (let i = 0; i < sequencia.length; i++) {
        await tx.customFieldDef.update({ where: { id: sequencia[i] }, data: { ordem: i } });
      }
      const fim = await tx.customFieldDef.findMany({ where: { entidade }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }] });
      return fim.map(view);
    });
  }

  /**
   * Serviço único de validação, para quem está FORA de uma transação do CRM
   * (ex.: motor de automação). Não grava nada: devolve o jsonb final.
   */
  async validarCamposCustom(
    tenantId: string,
    entidade: EntidadeCampo,
    valores: Record<string, unknown>,
    opts: { atuais?: Record<string, unknown>; exigirObrigatorios?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    return this.prisma.withTenant(tenantId, (tx) => validarCamposNaTransacao(tx, entidade, valores, opts));
  }

  /**
   * Helper para o motor de automação (nó `acao.atualizar_contato`, Q3.1):
   * grava um patch de campos personalizados no contato, validado pelo mesmo
   * serviço da API, mesclado com o que já existe. Não exige os obrigatórios
   * (uma automação que preenche UM campo não pode travar por outro vazio).
   * Retorna as chaves efetivamente alteradas.
   */
  async atualizarCamposContato(tenantId: string, contactId: string, valores: Record<string, unknown>): Promise<{ ok: true; alterados: string[] }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, camposCustom: true } });
      if (!c) throw new NotFoundException('contato inexistente');
      const atuais = objeto(c.camposCustom);
      const final = await validarCamposNaTransacao(tx, 'contact', valores, { atuais });
      const alterados = Object.keys(valores).filter((k) => JSON.stringify(atuais[k]) !== JSON.stringify(final[k]));
      if (alterados.length) {
        await tx.contact.update({ where: { id: contactId }, data: { camposCustom: final as Prisma.InputJsonValue, updatedAt: new Date() } });
      }
      return { ok: true, alterados };
    });
  }

  private async contarUso(tx: Prisma.TransactionClient, entidade: EntidadeCampo, chave: string): Promise<number> {
    const r = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM ${TABELA[entidade]} WHERE campos_custom ? ${chave}`;
    return Number(r[0]?.n ?? 0);
  }
}

/** Converte o jsonb gravado em objeto (tolerante a valor histórico não-objeto). */
export const camposDe = objeto;
