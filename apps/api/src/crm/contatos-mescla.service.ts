import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { agruparDuplicados, fundirContatos, IDENT, type ContatoFundivel, type ParDuplicado } from './contatos-mescla';

export const MAX_DUPLICADOS_POR_MESCLA = 20;
/** `Prisma.join` recusa lista vazia. */
const juntar = (xs: Prisma.Sql[]): Prisma.Sql => (xs.length ? Prisma.join(xs, '') : Prisma.empty);
const MAX_GRUPOS = 100;

/** Coluna de uma tabela que aponta (FK) para `contacts.id`, com as unicidades que a envolvem. */
interface ReferenciaContato {
  tabela: string;
  coluna: string;
  /** Para cada índice único que contém a coluna: as OUTRAS colunas (null = tem expressão). */
  unicos: (string[] | null)[];
}

export interface ContatoDuplicadoView {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  tags: string[];
  createdAt: Date;
  negocios: number;
  conversas: number;
}
export interface GrupoDuplicadoView {
  motivos: ('email' | 'telefone')[];
  sugeridoPrincipalId: string;
  contatos: ContatoDuplicadoView[];
}

/**
 * Duplicados e mesclagem de contatos (Q2.2).
 *
 * A mesclagem descobre no CATÁLOGO do Postgres todas as FKs que apontam para
 * `contacts` (16 hoje: negócios, conversas, atividades, tarefas, notas,
 * compromissos, cobranças, propostas, execuções de fluxo, campanhas e as
 * tabelas de memória dos agentes). Lista fixa no código ficaria velha na
 * próxima migração, e a linha esquecida seria apagada em CASCADE junto com o
 * duplicado. Onde há índice único envolvendo o contato (ex.: um perfil de
 * agente por contato), só move o que não colide; o resto segue a regra da FK
 * ao apagar o duplicado (o principal já tem o equivalente).
 */
@Injectable()
export class ContatosMesclaService {
  constructor(private readonly prisma: PrismaService) {}

  async duplicados(tenantId: string): Promise<{ grupos: GrupoDuplicadoView[]; total: number }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const pares = await tx.$queryRaw<ParDuplicado[]>`
        SELECT 'email' AS motivo, lower(email) AS chave, array_agg(id::text ORDER BY created_at, id) AS ids
          FROM contacts WHERE email IS NOT NULL AND btrim(email) <> ''
          GROUP BY lower(email) HAVING count(*) > 1
        UNION ALL
        SELECT 'telefone', right(regexp_replace(telefone, '[^0-9]', '', 'g'), 8), array_agg(id::text ORDER BY created_at, id)
          FROM contacts WHERE telefone IS NOT NULL AND length(regexp_replace(telefone, '[^0-9]', '', 'g')) >= 8
          GROUP BY right(regexp_replace(telefone, '[^0-9]', '', 'g'), 8) HAVING count(*) > 1`;
      const todos = agruparDuplicados(pares);
      const grupos = todos.slice(0, MAX_GRUPOS);
      const ids = grupos.flatMap((g) => g.ids);
      const contatos = ids.length
        ? await tx.contact.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true, email: true, telefone: true, empresa: true, tags: true, createdAt: true, _count: { select: { deals: true, conversations: true } } },
          })
        : [];
      const porId = new Map(contatos.map((c) => [c.id, c]));
      return {
        total: todos.length,
        grupos: grupos.map((g) => {
          const lista = g.ids.map((id) => porId.get(id)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({
            id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa, tags: c.tags, createdAt: c.createdAt,
            negocios: c._count.deals, conversas: c._count.conversations,
          }));
          // sugestão: quem tem mais histórico; empate, o mais antigo
          const sugerido = [...lista].sort((a, b) => b.negocios + b.conversas - (a.negocios + a.conversas) || a.createdAt.getTime() - b.createdAt.getTime())[0];
          return { motivos: g.motivos, sugeridoPrincipalId: sugerido?.id ?? g.ids[0], contatos: lista };
        }).filter((g) => g.contatos.length > 1),
      };
    });
  }

  async mesclar(tenantId: string, identityId: string, principalId: string, duplicadoIds: string[]) {
    const dupIds = [...new Set(duplicadoIds)];
    if (!dupIds.length) throw new BadRequestException('informe ao menos um duplicado');
    if (dupIds.length > MAX_DUPLICADOS_POR_MESCLA) throw new BadRequestException(`no máximo ${MAX_DUPLICADOS_POR_MESCLA} duplicados por mesclagem`);
    if (dupIds.includes(principalId)) throw new BadRequestException('o principal não pode estar entre os duplicados');

    return this.prisma.withTenant(tenantId, async (tx) => {
      // trava as linhas: outra mesclagem/edição simultânea espera esta terminar
      const travados = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM contacts WHERE id = ANY(${[principalId, ...dupIds]}::uuid[]) FOR UPDATE`;
      if (travados.length !== dupIds.length + 1) throw new NotFoundException('contato inexistente (principal ou duplicado)');

      const sel = {
        id: true, nome: true, email: true, telefone: true, empresa: true, cargo: true, origem: true, localizacao: true, site: true, linkedin: true,
        companyId: true, ownerId: true, fotoUrl: true, fotoEm: true, tags: true, camposCustom: true, consentimento: true, valorEstimado: true,
        optedOutAt: true, ultimoContatoAt: true, lastInboundAt: true, createdAt: true,
      } as const;
      const linhas = await tx.contact.findMany({ where: { id: { in: [principalId, ...dupIds] } }, select: sel });
      const fundivel = (c: (typeof linhas)[number]): ContatoFundivel => ({ ...c, valorEstimado: Number(c.valorEstimado) });
      const principal = linhas.find((c) => c.id === principalId)!;
      const dups = linhas.filter((c) => c.id !== principalId);

      // 1. move tudo que aponta para os duplicados
      const refs = await this.referencias(tx);
      const movidos: Record<string, number> = {};
      for (const dupId of dupIds) {
        for (const r of refs) {
          const n = await tx.$executeRaw(this.sqlMover(r, principalId, dupId));
          if (n) movidos[`${r.tabela}.${r.coluna}`] = (movidos[`${r.tabela}.${r.coluna}`] ?? 0) + n;
        }
      }

      // 2. dados do principal (campos vazios completados, tags somadas)
      const f = fundirContatos(fundivel(principal), dups.map(fundivel));
      await tx.contact.update({
        where: { id: principalId },
        data: {
          ...f,
          camposCustom: f.camposCustom as Prisma.InputJsonValue,
          consentimento: (f.consentimento ?? {}) as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
      // A tag herdada do duplicado não é tag NOVA da pessoa: o fluxo de "tag
      // adicionada" já rodou para ela no registro antigo. O gatilho do banco
      // gera `contact.tagged` mesmo assim; neutraliza só os desta transação.
      await tx.$executeRaw`UPDATE outbox_events SET status = 'processed', processed_at = now(), last_error = 'mesclagem: tag herdada de duplicado'
        WHERE tenant_id = ${tenantId}::uuid AND kind = 'contact.tagged' AND status = 'pending' AND created_at = now() AND payload->>'id' = ${principalId}`;

      // 3. apaga os duplicados (o que não pôde ser movido segue a regra da FK)
      await tx.contact.deleteMany({ where: { id: { in: dupIds } } });

      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `mesclou ${dupIds.length} contato(s) duplicado(s) em "${principal.nome}"`, tone: 'neutral', contactId: principalId } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'contacts.merge', 'contact', ${principalId},
                ${JSON.stringify({ principalId, duplicadoIds: dupIds, duplicados: dups.map((d) => ({ id: d.id, nome: d.nome, email: d.email, telefone: d.telefone })), movidos })}::jsonb)`;
      return { ok: true as const, principalId, mesclados: dupIds.length, movidos };
    }, { timeout: 60_000 });
  }

  /** FKs para `contacts(id)` + colunas dos índices únicos que envolvem cada uma. */
  private async referencias(tx: Prisma.TransactionClient): Promise<ReferenciaContato[]> {
    const fks = await tx.$queryRaw<{ tabela: string; coluna: string; colnum: number }[]>`
      SELECT c.conrelid::regclass::text AS tabela, a.attname::text AS coluna, a.attnum::int AS colnum
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'contacts'::regclass AND array_length(c.conkey, 1) = 1
      ORDER BY 1, 2`;
    const out: ReferenciaContato[] = [];
    for (const fk of fks) {
      if (!IDENT.test(fk.tabela) || !IDENT.test(fk.coluna)) throw new Error(`referência a contacts com nome inesperado: ${fk.tabela}.${fk.coluna}`);
      const idx = await tx.$queryRaw<{ cols: (string | null)[] }[]>`
        SELECT array_agg(att.attname::text ORDER BY k.ord) AS cols
        FROM pg_index x
        CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        LEFT JOIN pg_attribute att ON att.attrelid = x.indrelid AND att.attnum = k.attnum AND k.attnum > 0
        WHERE x.indrelid = ${fk.tabela}::regclass AND x.indisunique
        GROUP BY x.indexrelid
        HAVING bool_or(k.attnum = ${fk.colnum}) OR bool_or(k.attnum = 0)`;
      const unicos = idx.map(({ cols }) => {
        if (cols.some((c) => c === null)) return null; // índice com expressão: conservador
        const outras = cols.filter((c): c is string => c !== fk.coluna);
        return outras.every((c) => IDENT.test(c)) ? outras : null;
      });
      out.push({ tabela: fk.tabela, coluna: fk.coluna, unicos });
    }
    return out;
  }

  /**
   * `UPDATE t SET col = principal WHERE col = dup AND <não colide>`. Para cada
   * índice único com a coluna: não existe linha do principal com as mesmas
   * OUTRAS colunas (NULL tratado como igual: mais conservador que o índice).
   */
  private sqlMover(r: ReferenciaContato, principalId: string, dupId: string): Prisma.Sql {
    const t = Prisma.raw(`"${r.tabela}"`);
    const col = Prisma.raw(`"${r.coluna}"`);
    const conds = r.unicos.map((outras) => {
      const iguais = (outras ?? []).map((c) => Prisma.raw(` AND x."${c}" IS NOT DISTINCT FROM alvo."${c}"`));
      return Prisma.sql` AND NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.${col} = ${principalId}::uuid${juntar(iguais)})`;
    });
    return Prisma.sql`UPDATE ${t} AS alvo SET ${col} = ${principalId}::uuid WHERE alvo.${col} = ${dupId}::uuid${juntar(conds)}`;
  }
}
