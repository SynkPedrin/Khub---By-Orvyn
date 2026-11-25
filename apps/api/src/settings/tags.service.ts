import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { chaveParecida, garantirTagsNoCatalogo, normalizarTag, tagsDoGrafo, type PapelTag } from '../common/tags-catalogo';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string, payload?: Record<string, unknown>) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'crm_tag', ${entidadeId ?? null}, ${JSON.stringify(payload ?? {})}::jsonb)`;
}

export interface TagInput {
  name: string;
  color?: string;
  descricao?: string;
}

/** Uma automação que cita a tag, com o papel dela no fluxo. */
export interface AutomacaoComTag {
  id: string;
  nome: string;
  status: string;
  papeis: PapelTag[];
}

export interface TagComUso {
  id: string;
  name: string;
  color: string;
  descricao: string;
  createdAt: Date;
  /** Contatos com a tag agora (mesmo que `contatos`; mantido pelo contrato antigo). */
  usos: number;
  contatos: number;
  automacoes: AutomacaoComTag[];
}

export interface CruzamentoTags {
  totais: { catalogo: number; emContatos: number; emAutomacoes: number; contatosComTag: number };
  /** Tag gravada em contato (importação, API antiga) que não está no catálogo. */
  foraDoCatalogoEmContatos: { tag: string; contatos: number }[];
  /** Tag citada em automação que não está no catálogo. */
  foraDoCatalogoEmAutomacoes: { tag: string; automacoes: AutomacaoComTag[] }[];
  /** Mesma tag escrita de jeitos diferentes (caixa, acento, hífen, espaço). */
  parecidas: { grupo: string[]; contatos: number }[];
  /** No catálogo, sem nenhum contato e sem nenhuma automação. */
  semUso: string[];
  /** Gatilho "tag adicionada" de fluxo ativo cuja tag nenhuma automação adiciona e nenhum contato tem. */
  gatilhosSemOrigem: { tag: string; automacoes: AutomacaoComTag[] }[];
  /** Tag que uma automação adiciona e outra (ou a mesma) remove: risco de vai e volta. */
  adicionaERemove: { tag: string; adicionam: AutomacaoComTag[]; removem: AutomacaoComTag[] }[];
}

const k = (t: string) => t.toLowerCase();

/**
 * Catálogo de tags do CRM (nome + cor), isolado por tenant via RLS, cruzado
 * com os contatos e com as automações (ADR-0055).
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Contagem de contatos por tag (chave minúscula) e o nome mais usado de cada uma. */
  private async usoEmContatos(tx: Prisma.TransactionClient) {
    const linhas = await tx.$queryRaw<{ tag: string; nome: string; total: bigint }[]>`
      SELECT lower(t) AS tag, mode() WITHIN GROUP (ORDER BY t) AS nome, count(*)::bigint AS total
      FROM contacts c, unnest(c.tags) AS t
      WHERE btrim(t) <> ''
      GROUP BY lower(t)`;
    const porTag = new Map(linhas.map((l) => [l.tag, { nome: l.nome, total: Number(l.total) }]));
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM contacts WHERE cardinality(tags) > 0`;
    return { porTag, contatosComTag: Number(n) };
  }

  /** Tags citadas pela versão mais recente (rascunho ou publicada) de cada automação. */
  private async usoEmAutomacoes(tx: Prisma.TransactionClient) {
    // Sequencial: consultas paralelas na mesma transação interativa não são suportadas.
    const fluxos = await tx.workflow.findMany({ select: { id: true, nome: true, status: true } });
    const versoes = await tx.$queryRaw<{ workflow_id: string; grafo: unknown }[]>`
      SELECT DISTINCT ON (workflow_id) workflow_id, grafo FROM workflow_versions ORDER BY workflow_id, versao DESC`;
    const grafo = new Map(versoes.map((v) => [v.workflow_id, v.grafo]));
    const porTag = new Map<string, { nome: string; automacoes: Map<string, AutomacaoComTag> }>();
    for (const f of fluxos) {
      for (const u of tagsDoGrafo(grafo.get(f.id))) {
        const e = porTag.get(k(u.tag)) ?? { nome: u.tag, automacoes: new Map<string, AutomacaoComTag>() };
        const a = e.automacoes.get(f.id) ?? { id: f.id, nome: f.nome, status: f.status, papeis: [] };
        if (!a.papeis.includes(u.papel)) a.papeis.push(u.papel);
        e.automacoes.set(f.id, a);
        porTag.set(k(u.tag), e);
      }
    }
    return porTag;
  }

  /** Catálogo com o uso real: quantos contatos têm a tag e quais automações a usam. */
  listar(tenantId: string): Promise<TagComUso[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const catalogo = await tx.crmTag.findMany({ orderBy: { name: 'asc' } });
      const contatos = await this.usoEmContatos(tx);
      const fluxos = await this.usoEmAutomacoes(tx);
      return catalogo.map((t) => {
        const n = contatos.porTag.get(k(t.name))?.total ?? 0;
        return {
          id: t.id, name: t.name, color: t.color, descricao: t.descricao, createdAt: t.createdAt,
          usos: n, contatos: n,
          automacoes: [...(fluxos.get(k(t.name))?.automacoes.values() ?? [])],
        };
      });
    });
  }

  /** Análise completa: catálogo × contatos × automações. */
  cruzamento(tenantId: string): Promise<CruzamentoTags> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const catalogo = await tx.crmTag.findMany({ select: { name: true } });
      const noCatalogo = new Set(catalogo.map((c) => k(c.name)));
      const contatos = await this.usoEmContatos(tx);
      const fluxos = await this.usoEmAutomacoes(tx);

      const foraDoCatalogoEmContatos = [...contatos.porTag.entries()]
        .filter(([tag]) => !noCatalogo.has(tag))
        .map(([, v]) => ({ tag: v.nome, contatos: v.total }))
        .sort((a, b) => b.contatos - a.contatos);
      const foraDoCatalogoEmAutomacoes = [...fluxos.entries()]
        .filter(([tag]) => !noCatalogo.has(tag))
        .map(([, v]) => ({ tag: v.nome, automacoes: [...v.automacoes.values()] }));

      // Variações da mesma tag em qualquer lugar (catálogo, contatos, automações)
      const todas = new Map<string, string>();
      for (const c of catalogo) todas.set(k(c.name), c.name);
      for (const [tag, v] of contatos.porTag) if (!todas.has(tag)) todas.set(tag, v.nome);
      for (const [tag, v] of fluxos) if (!todas.has(tag)) todas.set(tag, v.nome);
      const grupos = new Map<string, string[]>();
      for (const [, nome] of todas) {
        const g = grupos.get(chaveParecida(nome)) ?? [];
        g.push(nome);
        grupos.set(chaveParecida(nome), g);
      }
      const parecidas = [...grupos.values()]
        .filter((g) => g.length > 1)
        .map((g) => ({ grupo: g.sort(), contatos: g.reduce((s, t) => s + (contatos.porTag.get(k(t))?.total ?? 0), 0) }))
        .sort((a, b) => b.contatos - a.contatos);

      const semUso = catalogo
        .map((c) => c.name)
        .filter((t) => !contatos.porTag.has(k(t)) && !fluxos.has(k(t)))
        .sort((a, b) => a.localeCompare(b));

      const gatilhosSemOrigem: CruzamentoTags['gatilhosSemOrigem'] = [];
      const adicionaERemove: CruzamentoTags['adicionaERemove'] = [];
      for (const [tag, v] of fluxos) {
        const lista = [...v.automacoes.values()];
        const gatilham = lista.filter((a) => a.papeis.includes('gatilho') && a.status === 'ativo');
        const adicionam = lista.filter((a) => a.papeis.includes('adiciona'));
        const removem = lista.filter((a) => a.papeis.includes('remove'));
        if (gatilham.length && !adicionam.length && !contatos.porTag.has(tag)) gatilhosSemOrigem.push({ tag: v.nome, automacoes: gatilham });
        if (adicionam.length && removem.length) adicionaERemove.push({ tag: v.nome, adicionam, removem });
      }

      return {
        totais: { catalogo: catalogo.length, emContatos: contatos.porTag.size, emAutomacoes: fluxos.size, contatosComTag: contatos.contatosComTag },
        foraDoCatalogoEmContatos,
        foraDoCatalogoEmAutomacoes,
        parecidas,
        semUso,
        gatilhosSemOrigem,
        adicionaERemove,
      };
    });
  }

  /** Coloca no catálogo toda tag que já existe em contato ou automação. */
  async sincronizar(tenantId: string, identityId: string): Promise<{ adicionadas: string[] }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const antes = new Set((await tx.crmTag.findMany({ select: { name: true } })).map((c) => k(c.name)));
      const contatos = await this.usoEmContatos(tx);
      const fluxos = await this.usoEmAutomacoes(tx);
      const novas = [
        ...[...contatos.porTag.entries()].filter(([t]) => !antes.has(t)).map(([, v]) => v.nome),
        ...[...fluxos.entries()].filter(([t]) => !antes.has(t) && !contatos.porTag.has(t)).map(([, v]) => v.nome),
      ];
      await garantirTagsNoCatalogo(tx, tenantId, novas);
      if (novas.length) await audit(tx, tenantId, identityId, 'tag.sincronizadas', undefined, { adicionadas: novas });
      return { adicionadas: novas };
    });
  }

  async criar(tenantId: string, identityId: string, dto: TagInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      try {
        const tag = await tx.crmTag.create({
          data: { tenantId, name: normalizarTag(dto.name), color: dto.color ?? '#7B2EFF', descricao: dto.descricao ?? '' },
        });
        await audit(tx, tenantId, identityId, 'tag.criada', tag.id);
        return tag;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Já existe uma tag com esse nome.');
        }
        throw e;
      }
    });
  }

  /**
   * Editar. Renomear propaga para os contatos que têm a tag (mesma tag em
   * qualquer caixa). Automações NÃO são reescritas (versão publicada é
   * imutável): voltam em `automacoesParaRevisar` para a tela avisar.
   */
  async atualizar(tenantId: string, identityId: string, id: string, dto: Partial<TagInput>) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.crmTag.findFirst({ where: { id }, select: { id: true, name: true } });
      if (!existe) throw new NotFoundException('tag inexistente');
      const novoNome = dto.name !== undefined ? normalizarTag(dto.name) : undefined;
      try {
        const tag = await tx.crmTag.update({
          where: { id },
          data: {
            ...(novoNome !== undefined ? { name: novoNome } : {}),
            ...(dto.color !== undefined ? { color: dto.color } : {}),
            ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
          },
        });
        let contatosAtualizados = 0;
        let automacoesParaRevisar: AutomacaoComTag[] = [];
        if (novoNome && novoNome !== existe.name) {
          contatosAtualizados = await tx.$executeRaw`
            UPDATE contacts
               SET tags = ARRAY(
                     SELECT y FROM (
                       SELECT DISTINCT ON (lower(y)) y, o FROM (
                         SELECT CASE WHEN lower(x) = lower(${existe.name}) THEN ${novoNome}::text ELSE x END AS y, o
                         FROM unnest(tags) WITH ORDINALITY AS u(x, o)
                       ) a ORDER BY lower(y), o
                     ) b ORDER BY o),
                   updated_at = now()
             WHERE EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) = lower(${existe.name}))`;
          automacoesParaRevisar = [...((await this.usoEmAutomacoes(tx)).get(k(existe.name))?.automacoes.values() ?? [])];
        }
        await audit(tx, tenantId, identityId, 'tag.atualizada', id, novoNome && novoNome !== existe.name ? { de: existe.name, para: novoNome, contatosAtualizados } : {});
        return { ...tag, contatosAtualizados, automacoesParaRevisar };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Já existe uma tag com esse nome.');
        }
        throw e;
      }
    });
  }

  /** Tira do catálogo. Os contatos continuam com a tag (aparece em "fora do catálogo"). */
  async remover(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.crmTag.findFirst({ where: { id }, select: { id: true, name: true } });
      if (!existe) throw new NotFoundException('tag inexistente');
      await tx.crmTag.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'tag.removida', id, { nome: existe.name });
      return { ok: true };
    });
  }
}
