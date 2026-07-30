import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from '../automations/workflows.service';

export interface FiltroTemplates {
  categoria?: string;
  q?: string;
  oficial?: boolean;
  premium?: boolean;
  featured?: boolean;
}

/** Campos da listagem (sem o grafo cru — só o detalhe carrega o workflow). */
const LISTA = {
  id: true, slug: true, name: true, description: true, category: true, subcategory: true,
  icon: true, segment: true, difficulty: true, estimatedMin: true, tags: true, author: true,
  isOfficial: true, isPremium: true, featured: true, installs: true, rating: true,
  requirements: true, tenantId: true,
} as const;

/**
 * Marketplace de templates (ADR-0020). Leitura roda em `withTenant`: a RLS já
 * mostra os globais publicados + os do próprio tenant. Instalar **reusa** o
 * `WorkflowsService` (criar → salvar grafo → publicar) — zero duplicação do motor.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async listar(tenantId: string, f: FiltroTemplates) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.automationTemplate.findMany({
        where: {
          ...(f.categoria ? { category: f.categoria } : {}),
          ...(f.oficial !== undefined ? { isOfficial: f.oficial } : {}),
          ...(f.premium !== undefined ? { isPremium: f.premium } : {}),
          ...(f.featured !== undefined ? { featured: f.featured } : {}),
          ...(f.q
            ? {
                OR: [
                  { name: { contains: f.q, mode: 'insensitive' } },
                  { description: { contains: f.q, mode: 'insensitive' } },
                  { tags: { has: f.q.toLowerCase() } },
                ],
              }
            : {}),
        },
        select: LISTA,
        orderBy: [{ featured: 'desc' }, { installs: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  async categorias(tenantId: string) {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.automationTemplate.groupBy({ by: ['category'], _count: { _all: true } }),
    );
    return rows.map((r) => ({ categoria: r.category, total: r._count._all })).sort((a, b) => b.total - a.total);
  }

  async obter(tenantId: string, id: string) {
    const t = await this.prisma.withTenant(tenantId, (tx) => tx.automationTemplate.findUnique({ where: { id } }));
    if (!t) throw new NotFoundException('template não encontrado');
    return t;
  }

  /**
   * Instala: cria um workflow do tenant a partir do grafo do template e publica.
   * `valores` liga as variáveis declaradas pelo template (`{{var.chave}}` no config
   * dos nós) aos dados reais do tenant (etapa, tag, textos) — sem isso o template
   * viria com placeholders do autor.
   */
  async instalar(tenantId: string, identityId: string, id: string, valores?: Record<string, string>) {
    const tpl = await this.obter(tenantId, id); // 404 se não visível (RLS)
    // valores efetivos = defaults declarados no template + o que o usuário informou.
    const vars = Array.isArray(tpl.variables) ? (tpl.variables as { chave?: string; default?: string }[]) : [];
    const defaults = Object.fromEntries(vars.filter((v) => v?.chave).map((v) => [v.chave as string, v.default ?? '']));
    const efetivos = { ...defaults, ...(valores ?? {}) };
    const grafo = Object.keys(efetivos).length ? bindVariaveis(tpl.workflow, efetivos) : tpl.workflow;
    const w = await this.workflows.criar(tenantId, identityId, { nome: tpl.name, descricao: tpl.description });
    await this.workflows.salvarRascunho(tenantId, w.id, grafo);
    await this.workflows.publicar(tenantId, w.id, identityId); // valida o grafo; lança se inválido
    return { workflowId: w.id, nome: tpl.name };
  }
}

/** Substitui `{{var.chave}}` (com/sem espaços) por `valores[chave]` em toda string
 *  do grafo. Profundo e imutável — o template no banco não é tocado. */
function bindVariaveis<T>(node: T, valores: Record<string, string>): T {
  if (typeof node === 'string') {
    return node.replace(/\{\{\s*var\.(\w+)\s*\}\}/g, (m, k) => (valores[k] !== undefined ? valores[k] : m)) as unknown as T;
  }
  if (Array.isArray(node)) return node.map((n) => bindVariaveis(n, valores)) as unknown as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = bindVariaveis(v, valores);
    return out as T;
  }
  return node;
}
