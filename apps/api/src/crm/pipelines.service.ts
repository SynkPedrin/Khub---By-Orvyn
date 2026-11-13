import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';

export const CORES_ETAPA = ['#9B4DE0', '#7B2FBE', '#5B1E9E', '#B7791F', '#0E9F6E', '#2563EB', '#DB2777', '#EA580C'];
export const MAX_ETAPAS = 20;
export const MAX_FUNIS = 30;

type Tx = Prisma.TransactionClient;

/**
 * Estrutura do funil pela tela (ADR-0042): criar/renomear/apagar funis e
 * criar/renomear/recolorir/reordenar/apagar etapas.
 *
 * Por que apagar é cauteloso: `deals.stage_id` e `deals.pipeline_id` são
 * `ON DELETE CASCADE` — apagar uma etapa com negócios APAGARIA os negócios.
 * Então: etapa/funil com negócios só sai informando para onde os negócios vão
 * (`moverPara`), e etapa usada por automação ativa ou por permissão de agente
 * não sai até a referência ser trocada (senão o fluxo quebra em silêncio).
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  /** Todos os funis com etapas e contagem de negócios (para a tela de configuração). */
  async listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [funis, etapas, contagem] = await Promise.all([
        tx.pipeline.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nome: true, tipo: true } }),
        tx.stage.findMany({ orderBy: [{ pipelineId: 'asc' }, { ordem: 'asc' }], select: { id: true, pipelineId: true, nome: true, cor: true, ordem: true } }),
        tx.deal.groupBy({ by: ['stageId', 'status'], _count: { _all: true } }),
      ]);
      const porEtapa = new Map<string, { abertos: number; total: number }>();
      for (const c of contagem) {
        const atual = porEtapa.get(c.stageId) ?? { abertos: 0, total: 0 };
        atual.total += c._count._all;
        if (c.status === 'aberto') atual.abertos += c._count._all;
        porEtapa.set(c.stageId, atual);
      }
      return funis.map((f) => {
        const doFunil = etapas.filter((e) => e.pipelineId === f.id);
        const ets = doFunil.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, ordem: e.ordem, abertos: porEtapa.get(e.id)?.abertos ?? 0, total: porEtapa.get(e.id)?.total ?? 0 }));
        return { id: f.id, nome: f.nome, tipo: f.tipo, etapas: ets, negocios: ets.reduce((t, e) => t + e.total, 0) };
      });
    });
  }

  async criarFunil(tenantId: string, input: { nome: string; tipo?: string; etapas?: string[] }) {
    const nome = limpar(input.nome, 'nome do funil', 80);
    const etapas = (input.etapas?.length ? input.etapas : ['Novo', 'Em andamento', 'Proposta', 'Fechado']).map((e) => limpar(e, 'nome da etapa', 60));
    if (etapas.length > MAX_ETAPAS) throw new BadRequestException(`no máximo ${MAX_ETAPAS} etapas por funil`);
    if (new Set(etapas.map((e) => e.toLowerCase())).size !== etapas.length) throw new BadRequestException('há etapas com o mesmo nome');
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      if ((await tx.pipeline.count()) >= MAX_FUNIS) throw new BadRequestException(`limite de ${MAX_FUNIS} funis atingido`);
      if (await tx.pipeline.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' } }, select: { id: true } })) throw new ConflictException('já existe um funil com esse nome');
      const pl = await tx.pipeline.create({ data: { tenantId, nome, tipo: input.tipo?.trim() || 'vendas' } });
      for (let i = 0; i < etapas.length; i++) {
        await tx.stage.create({ data: { tenantId, pipelineId: pl.id, nome: etapas[i], ordem: i, cor: CORES_ETAPA[i % CORES_ETAPA.length] } });
      }
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `criou o funil "${nome}" com ${etapas.length} etapas`, tone: 'neutral' } });
      return { id: pl.id };
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id: r.id });
    return r;
  }

  async renomearFunil(tenantId: string, id: string, input: { nome?: string; tipo?: string }) {
    const nome = input.nome !== undefined ? limpar(input.nome, 'nome do funil', 80) : undefined;
    await this.prisma.withTenant(tenantId, async (tx) => {
      const pl = await tx.pipeline.findUnique({ where: { id }, select: { id: true } });
      if (!pl) throw new NotFoundException('funil inexistente');
      if (nome && (await tx.pipeline.findFirst({ where: { id: { not: id }, nome: { equals: nome, mode: 'insensitive' } }, select: { id: true } }))) throw new ConflictException('já existe um funil com esse nome');
      await tx.pipeline.update({ where: { id }, data: { nome, tipo: input.tipo?.trim() || undefined } });
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id });
    return { ok: true };
  }

  /**
   * Apaga o funil. Negócios (de qualquer status) vão para `moverParaStageId`,
   * que precisa ser etapa de OUTRO funil. O último funil não pode sair.
   */
  async apagarFunil(tenantId: string, id: string, moverParaStageId?: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const pl = await tx.pipeline.findUnique({ where: { id }, select: { id: true, nome: true } });
      if (!pl) throw new NotFoundException('funil inexistente');
      if ((await tx.pipeline.count()) <= 1) throw new BadRequestException('a operação precisa de pelo menos um funil');
      const etapas = await tx.stage.findMany({ where: { pipelineId: id }, select: { id: true } });
      for (const e of etapas) await this.exigirSemReferencias(tx, e.id);
      const negocios = await tx.deal.count({ where: { pipelineId: id } });
      let movidos = 0;
      if (negocios > 0) {
        if (!moverParaStageId) throw new ConflictException(`o funil tem ${negocios} negócio(s); escolha para qual etapa de outro funil eles vão`);
        const destino = await tx.stage.findUnique({ where: { id: moverParaStageId }, select: { id: true, pipelineId: true } });
        if (!destino || destino.pipelineId === id) throw new BadRequestException('a etapa de destino precisa ser de outro funil');
        movidos = (await tx.deal.updateMany({ where: { pipelineId: id }, data: { stageId: destino.id, pipelineId: destino.pipelineId, updatedAt: new Date() } })).count;
      }
      await tx.pipeline.delete({ where: { id } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `apagou o funil "${pl.nome}"${movidos ? ` e moveu ${movidos} negócio(s)` : ''}`, tone: 'warn' } });
      return { movidos };
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id });
    return { ok: true, ...r };
  }

  async criarEtapa(tenantId: string, pipelineId: string, input: { nome: string; cor?: string; posicao?: number }) {
    const nome = limpar(input.nome, 'nome da etapa', 60);
    const cor = validarCor(input.cor);
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM pipelines WHERE id = ${pipelineId}::uuid FOR UPDATE`;
      const pl = await tx.pipeline.findUnique({ where: { id: pipelineId }, select: { id: true } });
      if (!pl) throw new NotFoundException('funil inexistente');
      const atuais = await tx.stage.findMany({ where: { pipelineId }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true } });
      if (atuais.length >= MAX_ETAPAS) throw new BadRequestException(`no máximo ${MAX_ETAPAS} etapas por funil`);
      if (atuais.some((a) => a.nome.toLowerCase() === nome.toLowerCase())) throw new ConflictException('já existe uma etapa com esse nome neste funil');
      const pos = input.posicao === undefined ? atuais.length : Math.max(0, Math.min(atuais.length, Math.trunc(input.posicao)));
      const s = await tx.stage.create({ data: { tenantId, pipelineId, nome, ordem: pos, cor: cor ?? CORES_ETAPA[atuais.length % CORES_ETAPA.length] } });
      const ordem = [...atuais.map((a) => a.id)];
      ordem.splice(pos, 0, s.id);
      await gravarOrdem(tx, ordem);
      return { id: s.id };
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id: pipelineId });
    return r;
  }

  async atualizarEtapa(tenantId: string, id: string, input: { nome?: string; cor?: string }) {
    const nome = input.nome !== undefined ? limpar(input.nome, 'nome da etapa', 60) : undefined;
    const cor = validarCor(input.cor);
    const pipelineId = await this.prisma.withTenant(tenantId, async (tx) => {
      const s = await tx.stage.findUnique({ where: { id }, select: { id: true, pipelineId: true } });
      if (!s) throw new NotFoundException('etapa inexistente');
      if (nome && (await tx.stage.findFirst({ where: { pipelineId: s.pipelineId, id: { not: id }, nome: { equals: nome, mode: 'insensitive' } }, select: { id: true } }))) throw new ConflictException('já existe uma etapa com esse nome neste funil');
      await tx.stage.update({ where: { id }, data: { nome, cor } });
      return s.pipelineId;
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id: pipelineId });
    return { ok: true };
  }

  /** Nova ordem das etapas de um funil: a lista precisa conter exatamente as etapas dele. */
  async reordenar(tenantId: string, pipelineId: string, ids: string[]) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM pipelines WHERE id = ${pipelineId}::uuid FOR UPDATE`;
      const atuais = await tx.stage.findMany({ where: { pipelineId }, select: { id: true } });
      if (!atuais.length) throw new NotFoundException('funil inexistente');
      const conjunto = new Set(atuais.map((a) => a.id));
      if (ids.length !== conjunto.size || new Set(ids).size !== ids.length || ids.some((i) => !conjunto.has(i))) {
        throw new BadRequestException('a nova ordem precisa listar todas as etapas do funil, uma vez cada');
      }
      await gravarOrdem(tx, ids);
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id: pipelineId });
    return { ok: true };
  }

  /**
   * Apaga a etapa. Com negócios, exige `moverParaStageId` (etapa do MESMO funil).
   * A última etapa do funil não sai (apague o funil inteiro).
   */
  async apagarEtapa(tenantId: string, id: string, moverParaStageId?: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const s = await tx.stage.findUnique({ where: { id }, select: { id: true, nome: true, pipelineId: true } });
      if (!s) throw new NotFoundException('etapa inexistente');
      await tx.$queryRaw`SELECT id FROM pipelines WHERE id = ${s.pipelineId}::uuid FOR UPDATE`;
      const irmas = await tx.stage.findMany({ where: { pipelineId: s.pipelineId }, orderBy: { ordem: 'asc' }, select: { id: true } });
      if (irmas.length <= 1) throw new BadRequestException('o funil precisa de pelo menos uma etapa; apague o funil inteiro se for o caso');
      await this.exigirSemReferencias(tx, id);
      const negocios = await tx.deal.count({ where: { stageId: id } });
      let movidos = 0;
      if (negocios > 0) {
        if (!moverParaStageId) throw new ConflictException(`a etapa tem ${negocios} negócio(s); escolha para qual etapa eles vão`);
        if (moverParaStageId === id) throw new BadRequestException('a etapa de destino precisa ser outra');
        const destino = await tx.stage.findUnique({ where: { id: moverParaStageId }, select: { pipelineId: true } });
        if (!destino || destino.pipelineId !== s.pipelineId) throw new BadRequestException('a etapa de destino precisa ser do mesmo funil');
        movidos = (await tx.deal.updateMany({ where: { stageId: id }, data: { stageId: moverParaStageId, updatedAt: new Date() } })).count;
      }
      await tx.stage.delete({ where: { id } });
      await gravarOrdem(tx, irmas.map((i) => i.id).filter((i) => i !== id));
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `apagou a etapa "${s.nome}"${movidos ? ` e moveu ${movidos} negócio(s)` : ''}`, tone: 'warn' } });
      return { movidos, pipelineId: s.pipelineId };
    });
    this.eventos.publicar(tenantId, 'pipeline.updated', { id: r.pipelineId });
    return { ok: true, movidos: r.movidos };
  }

  /** Etapa usada por automação ativa ou por permissão de agente não pode sumir. */
  private async exigirSemReferencias(tx: Tx, stageId: string) {
    const fluxos = await tx.$queryRaw<{ nome: string }[]>`
      SELECT DISTINCT w.nome FROM workflows w JOIN workflow_versions v ON v.workflow_id = w.id
      WHERE w.status = 'ativo' AND v.grafo::text LIKE ${'%' + stageId + '%'} ORDER BY 1 LIMIT 5`;
    if (fluxos.length) throw new ConflictException(`etapa usada por automação ativa: ${fluxos.map((f) => `"${f.nome}"`).join(', ')}. Troque a etapa no fluxo ou pause-o antes.`);
    const agentes = await tx.$queryRaw<{ nome: string }[]>`
      SELECT nome FROM agents WHERE status <> 'arquivado' AND config -> 'permissoes' -> 'etapasPermitidas' ? ${stageId} ORDER BY 1 LIMIT 5`;
    if (agentes.length) throw new ConflictException(`etapa liberada para agente de IA: ${agentes.map((a) => `"${a.nome}"`).join(', ')}. Ajuste as permissões do agente antes.`);
  }
}

function limpar(valor: string, campo: string, max: number): string {
  const v = (valor ?? '').replace(/\s+/g, ' ').trim();
  if (!v) throw new BadRequestException(`${campo} é obrigatório`);
  if (v.length > max) throw new BadRequestException(`${campo} pode ter no máximo ${max} caracteres`);
  return v;
}

function validarCor(cor?: string): string | undefined {
  if (cor === undefined) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(cor)) throw new BadRequestException('cor inválida (use #RRGGBB)');
  return cor;
}

async function gravarOrdem(tx: Tx, ids: string[]) {
  for (let i = 0; i < ids.length; i++) await tx.stage.update({ where: { id: ids[i] }, data: { ordem: i } });
}
