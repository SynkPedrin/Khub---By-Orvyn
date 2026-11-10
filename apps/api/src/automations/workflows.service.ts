import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { RunsService } from './runs.service';
import { CATALOGO, RAMOS_ESPERAR_RESPOSTA, ehGatilho, grafoSchema, validarConfig, type Grafo, type No, type TipoNo } from './catalogo';
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
  /** A janela também segura "Notificar equipe" (db/050). */
  janelaIncluiEquipe?: boolean;
}

/**
 * Ramos de um nó ramificado, tolerando config legada/corrompida (RV-05.1):
 * `ramos` que não é array (ausente, objeto, string) vira lista vazia aqui — o
 * `validarConfig` do mesmo nó já reporta o erro de schema. Nada de
 * `ramos is not iterable` estourando 500 na validação/publicação.
 */
function ramosDoNo(no: No): { id: string; rotulo?: string }[] {
  if (no.tipo === 'controle.esperar_resposta') return [...RAMOS_ESPERAR_RESPOSTA];
  const bruto = (no.config as { ramos?: unknown }).ramos;
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((r): r is { id: string; rotulo?: unknown } => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({ id: r.id, rotulo: typeof r.rotulo === 'string' && r.rotulo.trim() ? r.rotulo : undefined }));
}

const NOS_RAMIFICADOS = new Set<string>(['controle.condicao', 'controle.split', 'controle.esperar_resposta']);
const NOME_RAMIFICADO: Record<string, string> = {
  'controle.condicao': 'Condição',
  'controle.split': 'Dividir (A/B)',
  'controle.esperar_resposta': 'Esperar resposta',
};

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
          janelaIncluiEquipe: w.janelaIncluiEquipe,
        },
        webhookUrl: w.webhookKey ? `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/hooks/${w.webhookKey}` : null,
        // O segredo em si nunca sai no GET: só aparece uma vez, ao gerar.
        webhookAssinado: !!w.webhookSegredo,
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
          janelaIncluiEquipe: dto.janelaIncluiEquipe ?? undefined,
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

  /**
   * Gera (ou rotaciona) o segredo de assinatura do webhook de entrada (W5).
   * A partir daqui, todo POST na URL do fluxo precisa de
   * `X-KHUB-Signature: sha256=<HMAC-SHA256 hex do corpo cru>`; sem ela, 401 e
   * nenhuma execução. Rotacionar invalida o segredo antigo na hora. O valor é
   * devolvido SÓ nesta resposta (o GET mostra apenas `webhookAssinado`).
   */
  async gerarSegredoWebhook(tenantId: string, id: string, identityId: string) {
    const segredo = `whsec_${randomBytes(32).toString('base64url')}`;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true, webhookSegredo: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      await tx.workflow.update({ where: { id }, data: { webhookSegredo: segredo } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.webhook_secret', 'workflow', ${id}, ${JSON.stringify({ rotacionado: !!w.webhookSegredo })}::jsonb)`;
      return { segredo, header: 'X-KHUB-Signature', formato: 'sha256=<hmac_sha256_hex(segredo, corpo cru)>' };
    });
  }

  /** Remove a exigência de assinatura (volta a valer só a URL como credencial). */
  async removerSegredoWebhook(tenantId: string, id: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, select: { id: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      await tx.workflow.update({ where: { id }, data: { webhookSegredo: null } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.webhook_secret_removed', 'workflow', ${id})`;
      return { ok: true };
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
      // Ramificações (Q1.5): cada saída nomeada precisa levar a algum nó — para
      // terminar o caminho de propósito, ligue-a a "Encerrar". Ramo solto é o
      // contato sumindo do fluxo sem ninguém ter decidido isso.
      if (NOS_RAMIFICADOS.has(no.tipo)) {
        const nomeNo = no.rotulo ?? NOME_RAMIFICADO[no.tipo];
        const ramos = ramosDoNo(no);
        const idsRamos = new Set(ramos.map((r) => r.id));
        for (const ramo of ramos) {
          if (!grafo.arestas.some((a) => a.de === no.id && a.ramo === ramo.id)) {
            problemas.push({ noId: no.id, problema: `${nomeNo}: o ramo "${ramo.rotulo ?? ramo.id}" não leva a lugar nenhum. Ligue-o a um nó ou a "Encerrar"` });
          }
        }
        // conexão saindo de um ramo que não existe mais (ramo apagado no painel)
        for (const a of grafo.arestas.filter((x) => x.de === no.id && x.ramo && !idsRamos.has(x.ramo))) {
          if (ramos.length) problemas.push({ noId: no.id, problema: `${nomeNo}: conexão sai do ramo "${a.ramo}", que não existe mais neste nó` });
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
   * Disparo por um AGENTE de IA (Action Engine · db/034): só workflow ATIVO com
   * versão publicada, e respeitando a regra de reentrada do próprio workflow
   * (`runs.iniciar`). A permissão "este agente pode acionar este workflow" é
   * checada pelo módulo de agentes antes de chegar aqui.
   */
  async dispararPorAgente(tenantId: string, id: string, contactId: string, origem: { agentId: string; agentNome: string }) {
    const dados = await this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id }, include: { versaoAtiva: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      if (w.status !== 'ativo' || !w.versaoAtiva) throw new BadRequestException('workflow não está ativo');
      const c = await tx.contact.findUnique({ where: { id: contactId } });
      if (!c) throw new NotFoundException('contato inexistente');
      return { versao: w.versaoAtiva, contato: c, nome: w.nome };
    });
    const grafo = grafoSchema.parse(dados.versao.grafo);
    const gatilho = grafo.nos.find((n) => ehGatilho(n.tipo));
    if (!gatilho) throw new BadRequestException('workflow sem gatilho');
    const ctx: Contexto = {
      contato: {
        id: dados.contato.id, nome: dados.contato.nome, email: dados.contato.email, telefone: dados.contato.telefone,
        empresa: dados.contato.empresa, tag: dados.contato.tag, tags: dados.contato.tags, valor: Number(dados.contato.valorEstimado ?? 0),
      },
    };
    const dia = new Date().toISOString().slice(0, 10);
    const r = await this.runs.iniciar({
      tenantId, workflowId: id, versionId: dados.versao.id, gatilho: `agente:${origem.agentNome}`.slice(0, 120),
      grafo, noInicial: gatilho.id, contexto: ctx,
      dedupeKey: `agente:${origem.agentId}:${id}:${contactId}:${dia}`,
    });
    return { workflow: dados.nome, ...r };
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
      // Q1.3: "Testar" roda o que está NO CANVAS — o rascunho em edição. Sem
      // rascunho (nada mudou desde a publicação), o rascunho É a versão ativa.
      const rascunho = await tx.workflowVersion.findFirst({ where: { workflowId: id, publicadoEm: null }, orderBy: { versao: 'desc' } });
      const versao = rascunho ?? w.versaoAtiva;
      if (!versao) throw new BadRequestException('workflow sem versão');
      const c = await tx.contact.findUnique({ where: { id: contactId } });
      if (!c) throw new NotFoundException('contato inexistente');
      return { versao, contato: c, doRascunho: !!rascunho };
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
      // Rascunho é mutável: o grafo testado fica congelado no run (a versão
      // publicada já é imutável e dispensa a cópia).
      grafoTeste: dados.doRascunho ? grafo : undefined,
      dedupeKey: `teste:${Date.now()}:${contactId}`,
    });
    return { ...r, versao: dados.versao.versao, rascunho: dados.doRascunho };
  }
}
