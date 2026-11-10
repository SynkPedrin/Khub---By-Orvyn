import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CAUDA_TELEFONE, MAX_LINHAS_LOTE, normalizarLinha, planejarImport, separarTags, type ContatoImport, type Estrategia, type Existente } from './contatos-import';

export interface EntradaImport {
  estrategia: Estrategia;
  linhas: unknown[];
  /** Tag aplicada a todas as linhas do arquivo (ex.: "planilha-nov"). */
  tagsExtras?: string[];
  /** Origem gravada nos contatos NOVOS sem origem na linha. */
  origemPadrao?: string;
}
export interface ResultadoImport {
  total: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  erros: { linha: number; motivo: string }[];
  /** Por que cada linha foi ignorada (duplicata, já existe...). */
  avisos: { linha: number; motivo: string }[];
}

const ORIGEM_PADRAO = 'Importação CSV';

/**
 * Importação de contatos por CSV (Q2.2): o front faz upload, parse e
 * mapeamento; aqui chegam lotes de até 500 linhas já mapeadas.
 *
 * - Linha inválida vai para `erros[{linha, motivo}]` e NÃO derruba o lote.
 * - Dedupe contra o banco e dentro do próprio arquivo (contatos-import.ts).
 * - Lotes do mesmo tenant são serializados por advisory lock: dois lotes
 *   simultâneos com a mesma pessoa não criam duas.
 * - `contact.created`/`contact.tagged` saem pelos gatilhos de outbox do banco,
 *   como qualquer contato criado (decisão da Q2.2: importar é cadastrar).
 */
@Injectable()
export class ContatosImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importar(tenantId: string, identityId: string, entrada: EntradaImport): Promise<ResultadoImport> {
    if (!Array.isArray(entrada.linhas) || !entrada.linhas.length) throw new BadRequestException('nenhuma linha para importar');
    if (entrada.linhas.length > MAX_LINHAS_LOTE) throw new BadRequestException(`no máximo ${MAX_LINHAS_LOTE} linhas por lote`);
    const tagsExtras = separarTags(entrada.tagsExtras ?? []);
    const origemPadrao = entrada.origemPadrao?.trim().slice(0, 80) || ORIGEM_PADRAO;

    const erros: ResultadoImport['erros'] = [];
    const validas: ContatoImport[] = [];
    for (const bruta of entrada.linhas) {
      const r = normalizarLinha(bruta, tagsExtras);
      if (r.ok) validas.push(r.dado);
      else erros.push({ linha: r.linha, motivo: r.motivo });
    }

    const plano = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:contacts-import`}))) AS trava`;
      const existentes = await this.existentes(tx, validas);
      const p = planejarImport(validas, existentes, entrada.estrategia);

      if (p.criar.length) {
        await tx.contact.createMany({
          data: p.criar.map((c) => {
            const origem = c.origem ?? origemPadrao;
            return {
              tenantId, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa, cargo: c.cargo,
              origem, tag: 'Lead', tags: c.tags, valorEstimado: c.valor,
              // `origem` em campos_custom é o que o gatilho de outbox lê para o
              // payload de `contact.created` (fluxo pode filtrar "Importação CSV")
              camposCustom: { ...c.campos, origem } as Prisma.InputJsonValue,
            };
          }),
        });
      }
      for (const u of p.atualizar) {
        const a = u.antes;
        const d = u.depois;
        await tx.contact.update({
          where: { id: u.id },
          data: {
            nome: d.nome !== a.nome ? d.nome : undefined,
            email: d.email !== a.email ? d.email : undefined,
            telefone: d.telefone !== a.telefone ? d.telefone : undefined,
            empresa: d.empresa !== a.empresa ? d.empresa : undefined,
            cargo: d.cargo !== a.cargo ? d.cargo : undefined,
            origem: d.origem !== a.origem ? d.origem : undefined,
            valorEstimado: d.valor !== a.valor ? d.valor : undefined,
            tags: d.tags.length !== a.tags.length ? d.tags : undefined,
            camposCustom: JSON.stringify(d.campos) !== JSON.stringify(a.campos) ? (d.campos as Prisma.InputJsonValue) : undefined,
            updatedAt: new Date(),
          },
        });
      }

      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `importou ${p.criar.length} contato(s) e atualizou ${p.atualizar.length} por CSV`, tone: 'neutral' } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'contacts.import', 'contact', NULL,
                ${JSON.stringify({ estrategia: entrada.estrategia, linhas: entrada.linhas.length, criados: p.criar.length, atualizados: p.atualizar.length, ignorados: p.ignorados.length, erros: erros.length, atualizadosIds: p.atualizar.map((u) => u.id), tagsExtras, origemPadrao })}::jsonb)`;
      return p;
    }, { timeout: 60_000 });

    return {
      total: entrada.linhas.length,
      criados: plano.criar.length,
      atualizados: plano.atualizar.length,
      ignorados: plano.ignorados.length,
      erros: erros.sort((x, y) => x.linha - y.linha),
      avisos: plano.ignorados,
    };
  }

  /**
   * Contatos do tenant que casam com o lote por e-mail OU pelos 8 últimos
   * dígitos do telefone, numa ida ao banco (índices idx_contacts_email_lower,
   * db/052, e idx_contacts_fone_cauda, db/012 — mesma expressão).
   */
  private async existentes(tx: Prisma.TransactionClient, linhas: ContatoImport[]): Promise<Existente[]> {
    const emails = [...new Set(linhas.map((l) => l.email).filter((e): e is string => !!e))];
    const caudas = [...new Set(linhas.map((l) => (l.telefone ?? '').slice(-CAUDA_TELEFONE)).filter((t) => t.length === CAUDA_TELEFONE))];
    if (!emails.length && !caudas.length) return [];
    const rows = await tx.$queryRaw<{ id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null; cargo: string | null; origem: string | null; valor: number; tags: string[]; campos_custom: Prisma.JsonValue }[]>`
      SELECT id::text AS id, nome, email, telefone, empresa, cargo, origem, valor_estimado::float8 AS valor, tags, campos_custom
      FROM contacts
      WHERE (email IS NOT NULL AND lower(email) = ANY(${emails}::text[]))
         OR (telefone IS NOT NULL AND right(regexp_replace(telefone, '[^0-9]', '', 'g'), ${CAUDA_TELEFONE}::int) = ANY(${caudas}::text[]))
      ORDER BY created_at ASC, id ASC`;
    return rows.map((r) => ({
      id: r.id, nome: r.nome, email: r.email, telefone: r.telefone, empresa: r.empresa, cargo: r.cargo, origem: r.origem,
      valor: Number(r.valor), tags: r.tags ?? [],
      campos: r.campos_custom && typeof r.campos_custom === 'object' && !Array.isArray(r.campos_custom) ? (r.campos_custom as Record<string, unknown>) : {},
    }));
  }
}
