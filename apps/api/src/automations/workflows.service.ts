import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { RunsService } from './runs.service';
import { CATALOGO, ehGatilho, grafoSchema, validarConfig, type Grafo, type TipoNo } from './catalogo';
import type { Contexto } from './executor.service';

export interface ProblemaGrafo {
  noId?: string;
  problema: string;
}

/** Configurações operacionais do fluxo (migration 011). */
export interface ConfigWorkflow {
  reentrada?: 'uma_vez' | 'sempre' | 'apos_terminar';
  pararNoReply?: boolean;
  janelaAtiva?: boolean;
  janelaDias?: number[];
  janelaInicio?: number;
  janelaFim?: number;
  timezone?: string;
}

/**
 * Workflows + versionamento (PRD §7.2).
 *
 * Regra central: **rascunho é editável, versão publicada é imutável**. O run
 * guarda a `version_id` que executou — se o usuário editar o fluxo enquanto uma
 * espera de 7 dias corre, a execução termina com a lógica com que começou.
 */
@Injectable()
export class WorkflowsService {
  private readonly log = new Logger('Automations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
    private readonly config: ConfigService,
  ) {}

  catalogo() {
    return CATALOGO;
  }

  async listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wfs = await tx.workflow.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { versaoAtiva: { select: { versao: true, publicadoEm: true } }, _count: { select: { runs: true } } },
      });
      // contagem de falhas por workflow, para a lista não mentir "tudo bem"
      const falhas = await tx.workflowRun.groupBy({ by: ['workflowId'], where: { status: 'falhou' }, _count: { _all: true } });
      const mapaFalhas = new Map(falhas.map((f) => [f.workflowId, f._count._all]));
      return wfs.map((w) => ({
        id: w.id, nome: w.nome, descricao: w.descricao, tags: w.tags, status: w.status,
        versaoAtiva: w.versaoAtiva?.versao ?? null, publicadoEm: w.versaoAtiva?.publicadoEm ?? null,
        execucoes: w._count.runs, falhas: mapaFalhas.get(w.id) ?? 0,
        updatedAt: w.updatedAt,
      }));
    });
  }

  /** Workflow + rascunho corrente (o que o canvas edita). */
  async obter(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, include: { versaoAtiva: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      const rascunho = await tx.workflowVersion.findFirst({ where: { workflowId: id, publicadoEm: null }, orderBy: { versao: 'desc' } });
      const versoes = await tx.workflowVersion.findMany({
        where: { workflowId: id, publicadoEm: { not: null } },
        orderBy: { versao: 'desc' },
        select: { id: true, versao: true, publicadoEm: true },
      });
      const base = rascunho ?? w.versaoAtiva;
      return {
        id: w.id, nome: w.nome, descricao: w.descricao, tags: w.tags, status: w.status,
        versaoAtivaId: w.versaoAtivaId, versaoAtiva: w.versaoAtiva?.versao ?? null,
        rascunhoId: rascunho?.id ?? null,
        temRascunho: !!rascunho,
        grafo: base?.grafo ?? { nos: [], arestas: [] },
        versoes,
        config: {
          reentrada: w.reentrada, pararNoReply: w.pararNoReply, janelaAtiva: w.janelaAtiva,
          janelaDias: w.janelaDias, janelaInicio: w.janelaInicio, janelaFim: w.janelaFim, timezone: w.timezone,
        },
        webhookUrl: w.webhookKey ? `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/hooks/${w.webhookKey}` : null,
      };
    });
  }

  async criar(tenantId: string, identityId: string, dto: { nome: string; descricao?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.create({
        data: { tenantId, nome: dto.nome, descricao: dto.descricao ?? null, criadoPor: identityId, status: 'rascunho' },
        select: { id: true },
      });
      // todo workflow nasce com um rascunho vazio: o canvas nunca abre no nada
      await tx.workflowVersion.create({ data: { tenantId, workflowId: w.id, versao: 1, grafo: { nos: [], arestas: [] } } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.create', 'workflow', ${w.id})`;
      return { id: w.id };
    });
  }

  /**
   * Configurações do fluxo (migration 011). Separadas do grafo de propósito:
   * mexer na janela de envio não pode gerar versão nova nem afetar quem já está
   * correndo — é operação, não lógica.
   */
  async configurar(tenantId: string, id: string, identityId: string, dto: ConfigWorkflow) {
    if (dto.janelaInicio !== undefined && dto.janelaFim !== undefined && dto.janelaInicio >= dto.janelaFim) {
      throw new BadRequestException('a janela de envio precisa começar antes de terminar');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      await tx.workflow.update({
        where: { id },
        data: {
          reentrada: dto.reentrada ?? undefined,
          pararNoReply: dto.pararNoReply ?? undefined,
          janelaAtiva: dto.janelaAtiva ?? undefined,
          janelaDias: dto.janelaDias ?? undefined,
          janelaInicio: dto.janelaInicio ?? undefined,
          janelaFim: dto.janelaFim ?? undefined,
          timezone: dto.timezone ?? undefined,
          updatedAt: new Date(),
        },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.settings', 'workflow', ${id}, ${JSON.stringify(dto)}::jsonb)`;
      return { ok: true };
    });
  }

  /**
   * Gera (ou troca) a chave do webhook de entrada. Regenerar **invalida a URL
   * antiga** — é o botão de pânico se a URL vazar.
   */
  async gerarWebhook(tenantId: string, id: string, identityId: string) {
    const chave = randomBytes(24).toString('base64url');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      await tx.workflow.update({ where: { id }, data: { webhookKey: chave } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.webhook_key', 'workflow', ${id})`;
      return { url: `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/hooks/${chave}`, chave };
    });
  }

  async renomear(tenantId: string, id: string, dto: { nome?: string; descricao?: string; tags?: string[] }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.workflow.updateMany({ where: { id }, data: { nome: dto.nome ?? undefined, descricao: dto.descricao ?? undefined, tags: dto.tags ?? undefined, updatedAt: new Date() } });
      if (!r.count) throw new NotFoundException('workflow inexistente');
      return { ok: true };
    });
  }

  /** Salva o rascunho (autosave do canvas). Nunca toca na versão publicada. */
  async salvarRascunho(tenantId: string, id: string, grafoBruto: unknown) {
    const parsed = grafoSchema.safeParse(grafoBruto);
    if (!parsed.success) throw new BadRequestException(`grafo inválido: ${parsed.error.issues[0]?.message}`);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true } });
      if (!w) throw new NotFoundException('workflow inexistente');

      const rascunho = await tx.workflowVersion.findFirst({ where: { workflowId: id, publicadoEm: null }, orderBy: { versao: 'desc' } });
      const grafo = parsed.data as unknown as Prisma.InputJsonValue;
      if (rascunho) {
        await tx.workflowVersion.update({ where: { id: rascunho.id }, data: { grafo, updatedAt: new Date() } });
        return { ok: true, versao: rascunho.versao };
      }
      // publicado sem rascunho → abre a próxima versão como rascunho
      const ultima = await tx.workflowVersion.findFirst({ where: { workflowId: id }, orderBy: { versao: 'desc' }, select: { versao: true } });
      const nova = await tx.workflowVersion.create({
        data: { tenantId, workflowId: id, versao: (ultima?.versao ?? 0) + 1, grafo },
        select: { versao: true },
      });
      return { ok: true, versao: nova.versao };
    });
  }

  /**
   * Validação de publicação. Regra: o que passa daqui **executa** — não dá para
   * publicar um fluxo que vai morrer no primeiro nó por config faltando.
   */
  validar(grafo: Grafo): ProblemaGrafo[] {
    const problemas: ProblemaGrafo[] = [];
    const gatilhos = grafo.nos.filter((n) => ehGatilho(n.tipo));

    if (!gatilhos.length) problemas.push({ problema: 'o fluxo precisa de pelo menos um gatilho' });
    if (!grafo.nos.some((n) => !ehGatilho(n.tipo))) problemas.push({ problema: 'o fluxo não faz nada: adicione uma ação' });

    const ids = new Set(grafo.nos.map((n) => n.id));
    for (const a of grafo.arestas) {
      if (!ids.has(a.de)) problemas.push({ problema: `conexão saindo de nó inexistente (${a.de})` });
      if (!ids.has(a.para)) problemas.push({ problema: `conexão para nó inexistente (${a.para})` });
    }

    for (const no of grafo.nos) {
      const r = validarConfig(no.tipo as TipoNo, no.config);
      if (!r.ok) problemas.push({ noId: no.id, problema: `${no.rotulo ?? no.tipo}: ${r.erro}` });

      if (ehGatilho(no.tipo)) {
        if (!grafo.arestas.some((a) => a.de === no.id)) problemas.push({ noId: no.id, problema: `${no.rotulo ?? no.tipo}: gatilho sem nenhum nó ligado` });
        if (grafo.arestas.some((a) => a.para === no.id)) problemas.push({ noId: no.id, problema: `${no.rotulo ?? no.tipo}: gatilho não pode receber conexão` });
        continue;
      }

      // nó órfão (sem entrada) nunca roda — é lixo no canvas, não um fluxo
      if (!grafo.arestas.some((a) => a.para === no.id)) {
        problemas.push({ noId: no.id, problema: `${no.rotulo ?? no.tipo}: nó solto, nada leva até ele` });
      }
      if (no.tipo === 'controle.condicao') {
        const ramos = (no.config as { ramos?: { id: string }[] }).ramos ?? [];
        for (const ramo of ramos) {
          if (!grafo.arestas.some((a) => a.de === no.id && a.ramo === ramo.id)) {
            problemas.push({ noId: no.id, problema: `${no.rotulo ?? 'Condição'}: o ramo "${ramo.id}" não leva a lugar nenhum` });
          }
        }
      }
      if (no.tipo === 'controle.ir_para') {
        const alvo = (no.config as { alvoNoId?: string }).alvoNoId;
        if (alvo && !ids.has(alvo)) problemas.push({ noId: no.id, problema: `"Ir para" aponta para nó inexistente` });
      }
    }
    return problemas;
  }

  /** Publica o rascunho: valida, congela a versão e ativa o workflow. */
  async publicar(tenantId: string, id: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true, versaoAtivaId: true } });
      if (!w) throw new NotFoundException('workflow inexistente');

      const rascunho = await tx.workflowVersion.findFirst({ where: { workflowId: id, publicadoEm: null }, orderBy: { versao: 'desc' } });
      if (!rascunho) throw new BadRequestException('não há rascunho para publicar');

      const grafo = grafoSchema.parse(rascunho.grafo);
      const problemas = this.validar(grafo);
      if (problemas.length) {
        throw new BadRequestException({ title: 'workflow inválido', problemas });
      }

      await tx.workflowVersion.update({ where: { id: rascunho.id }, data: { publicadoEm: new Date(), publicadoPor: identityId } });
      await tx.workflow.update({ where: { id }, data: { versaoAtivaId: rascunho.id, status: 'ativo', updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.publish', 'workflow', ${id}, ${JSON.stringify({ versao: rascunho.versao })}::jsonb)`;
      return { ok: true, versao: rascunho.versao };
    });
  }

  /** Rollback: volta a ativa para uma versão antiga já publicada. */
  async rollback(tenantId: string, id: string, versionId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const v = await tx.workflowVersion.findFirst({ where: { id: versionId, workflowId: id, publicadoEm: { not: null } }, select: { id: true, versao: true } });
      if (!v) throw new NotFoundException('versão publicada inexistente');
      await tx.workflow.update({ where: { id }, data: { versaoAtivaId: v.id, status: 'ativo', updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.rollback', 'workflow', ${id}, ${JSON.stringify({ versao: v.versao })}::jsonb)`;
      return { ok: true, versao: v.versao };
    });
  }

  async mudarStatus(tenantId: string, id: string, status: 'ativo' | 'pausado', identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { versaoAtivaId: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      if (status === 'ativo' && !w.versaoAtivaId) throw new BadRequestException('publique o workflow antes de ativar');
      await tx.workflow.update({ where: { id }, data: { status, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${`workflow.${status}`}, 'workflow', ${id})`;
      return { ok: true };
    });
  }

  async remover(tenantId: string, id: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.workflow.deleteMany({ where: { id } });
      if (!r.count) throw new NotFoundException('workflow inexistente');
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.delete', 'workflow', ${id})`;
      return { ok: true };
    });
  }

  /**
   * Teste com contato real do tenant (PRD §7.2), sem esperar o gatilho.
   * A run é marcada `teste: true` — as ações acontecem de verdade, então a UI
   * avisa. Sem isso, "testar" seria simulação, e simulação mente.
   */
  async testar(tenantId: string, id: string, contactId: string) {
    const dados = await this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, include: { versaoAtiva: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      const versao = w.versaoAtiva ?? (await tx.workflowVersion.findFirst({ where: { workflowId: id }, orderBy: { versao: 'desc' } }));
      if (!versao) throw new BadRequestException('workflow sem versão');
      const c = await tx.contact.findUnique({ where: { id: contactId } });
      if (!c) throw new NotFoundException('contato inexistente');
      return { versao, contato: c };
    });

    const grafo = grafoSchema.parse(dados.versao.grafo);
    const problemas = this.validar(grafo);
    if (problemas.length) throw new BadRequestException({ title: 'workflow inválido', problemas });

    const gatilho = grafo.nos.find((n) => ehGatilho(n.tipo))!;
    const ctx: Contexto = {
      contato: {
        id: dados.contato.id, nome: dados.contato.nome, email: dados.contato.email, telefone: dados.contato.telefone,
        empresa: dados.contato.empresa, tag: dados.contato.tag, tags: dados.contato.tags, valor: Number(dados.contato.valorEstimado ?? 0),
      },
    };
    const r = await this.runs.iniciar({
      tenantId, workflowId: id, versionId: dados.versao.id, gatilho: `${gatilho.tipo} (teste)`,
      grafo, noInicial: gatilho.id, contexto: ctx, teste: true,
      dedupeKey: `teste:${Date.now()}:${contactId}`,
    });
    return r;
  }
}
