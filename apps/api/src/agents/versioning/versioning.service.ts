import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Agent } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverConfig } from '../config/agent-config';
import type { AgenteEfetivo } from '../intelligence/intelligence-core.service';

type Tx = Prisma.TransactionClient;

/** Campos que definem o comportamento do agente (o que uma versão congela). */
export const CAMPOS_SNAPSHOT = ['nome', 'descricao', 'modelo', 'instrucoes', 'tom', 'personalidade', 'ferramentas', 'conhecimentoAtivo', 'conhecimentoEscopos', 'maxRespostasConversa', 'maxCaracteres', 'canais', 'config'] as const;
export type SnapshotAgente = Pick<Agent, Exclude<(typeof CAMPOS_SNAPSHOT)[number], 'config'>> & { config: unknown };

export function snapshotDoAgente(a: Pick<Agent, (typeof CAMPOS_SNAPSHOT)[number]>): SnapshotAgente {
  return {
    nome: a.nome,
    descricao: a.descricao,
    modelo: a.modelo,
    instrucoes: a.instrucoes,
    tom: a.tom,
    personalidade: a.personalidade,
    ferramentas: [...a.ferramentas].sort(),
    conhecimentoAtivo: a.conhecimentoAtivo,
    conhecimentoEscopos: [...a.conhecimentoEscopos].sort(),
    maxRespostasConversa: a.maxRespostasConversa,
    maxCaracteres: a.maxCaracteres,
    canais: [...a.canais].sort(),
    config: resolverConfig(a.config).config,
  };
}

/** JSON estável (chaves ordenadas) → hash: "este rascunho é o que foi avaliado?". */
export function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${estavel((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export function hashSnapshot(s: SnapshotAgente): string {
  return createHash('sha256').update(estavel(s)).digest('hex').slice(0, 32);
}

export function efetivoDeSnapshot(id: string | null, s: SnapshotAgente, versionId: string | null): AgenteEfetivo {
  return {
    id,
    nome: s.nome,
    modelo: s.modelo,
    instrucoes: s.instrucoes,
    tom: s.tom,
    personalidade: s.personalidade,
    ferramentas: s.ferramentas,
    conhecimentoAtivo: s.conhecimentoAtivo,
    conhecimentoEscopos: s.conhecimentoEscopos,
    maxCaracteres: s.maxCaracteres,
    maxRespostasConversa: s.maxRespostasConversa,
    config: resolverConfig(s.config).config,
    versionId,
  };
}

/** Diferenças campo a campo (config por seção) entre dois snapshots. */
export function diffSnapshots(a: SnapshotAgente, b: SnapshotAgente): { campo: string; antes: unknown; depois: unknown }[] {
  const out: { campo: string; antes: unknown; depois: unknown }[] = [];
  for (const c of CAMPOS_SNAPSHOT) {
    if (c === 'config') {
      const ca = resolverConfig(a.config).config as unknown as Record<string, unknown>;
      const cb = resolverConfig(b.config).config as unknown as Record<string, unknown>;
      for (const secao of Object.keys(cb)) if (estavel(ca[secao]) !== estavel(cb[secao])) out.push({ campo: `config.${secao}`, antes: ca[secao], depois: cb[secao] });
    } else if (estavel(a[c]) !== estavel(b[c])) out.push({ campo: c, antes: a[c], depois: b[c] });
  }
  return out;
}

/**
 * AGENT VERSIONING ENGINE (docs/AI_AGENT_ARCHITECTURE.md §12/§16)
 *
 *  - O RASCUNHO é a linha de `agents` (o que a UI edita).
 *  - PUBLICAR congela um snapshot em `agent_versions` e aponta
 *    `agents.versao_publicada_id` para ele — o runtime passa a usar o
 *    snapshot, então editar o rascunho não muda o atendimento em produção.
 *  - Agente sem versão publicada (legado) continua usando a linha viva.
 *  - RESTAURAR (rollback) copia o snapshot de volta para o rascunho e publica
 *    uma nova versão com origem `restauracao` — o histórico nunca é reescrito.
 *  - Gate de regressão: se a última avaliação DESTE rascunho (mesmo hash)
 *    detectou regressão, publicar exige `forcar` explícito.
 */
@Injectable()
export class VersioningService {
  constructor(private readonly prisma: PrismaService) {}

  /** Configuração que o runtime deve usar agora. */
  async efetivo(tx: Tx, agente: Agent): Promise<AgenteEfetivo> {
    if (agente.versaoPublicadaId) {
      const v = await tx.agentVersion.findUnique({ where: { id: agente.versaoPublicadaId }, select: { id: true, snapshot: true } });
      if (v) return efetivoDeSnapshot(agente.id, v.snapshot as unknown as SnapshotAgente, v.id);
    }
    return efetivoDeSnapshot(agente.id, snapshotDoAgente(agente), null);
  }

  async publicar(
    tenantId: string,
    ator: { identityId: string },
    agentId: string,
    opts: { notas?: string; forcar?: boolean; origem?: 'publicacao' | 'restauracao' | 'proposta'; propostaId?: string | null },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId } });
      if (!a || a.status === 'arquivado') throw new NotFoundException('agente inexistente');
      const snap = snapshotDoAgente(a);
      const hash = hashSnapshot(snap);
      const atual = a.versaoPublicadaId ? await tx.agentVersion.findUnique({ where: { id: a.versaoPublicadaId } }) : null;
      if (atual && hashSnapshot(atual.snapshot as unknown as SnapshotAgente) === hash && opts.origem !== 'restauracao') {
        throw new BadRequestException('não há alterações desde a versão publicada');
      }
      const avaliacao = await tx.agentEvaluation.findFirst({ where: { agentId, alvo: { in: ['rascunho', 'proposta'] }, status: 'concluida' }, orderBy: { createdAt: 'desc' } });
      const avaliacaoDesteRascunho = avaliacao && (avaliacao.metricas as Record<string, unknown>)?.hash === hash ? avaliacao : null;
      if (avaliacaoDesteRascunho?.regressao && !opts.forcar) {
        throw new ConflictException({ title: 'a avaliação deste rascunho detectou regressão', avaliacaoId: avaliacaoDesteRascunho.id, comparacao: avaliacaoDesteRascunho.comparacao });
      }
      const ultimo = await tx.agentVersion.aggregate({ where: { agentId }, _max: { numero: true } });
      const numero = (ultimo._max.numero ?? 0) + 1;
      const v = await tx.agentVersion.create({
        data: {
          tenantId,
          agentId,
          numero,
          snapshot: snap as unknown as Prisma.InputJsonValue,
          notas: opts.notas?.trim().slice(0, 2000) || null,
          origem: opts.origem ?? 'publicacao',
          propostaId: opts.propostaId ?? null,
          avaliacaoId: avaliacaoDesteRascunho?.id ?? null,
          publicadoPor: ator.identityId || null,
        },
      });
      await tx.agent.update({ where: { id: agentId }, data: { versaoPublicadaId: v.id, updatedAt: new Date() } });
      if (avaliacaoDesteRascunho) await tx.agentEvaluation.update({ where: { id: avaliacaoDesteRascunho.id }, data: { versionId: v.id } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${ator.identityId}, 'agente.publicado', 'agent', ${agentId}, ${JSON.stringify({ versao: numero, origem: v.origem, forcado: !!opts.forcar, avaliado: !!avaliacaoDesteRascunho })}::jsonb)`;
      return { versao: { id: v.id, numero, origem: v.origem, createdAt: v.createdAt }, avaliado: !!avaliacaoDesteRascunho, regressaoIgnorada: !!avaliacaoDesteRascunho?.regressao };
    });
  }

  async historico(tenantId: string, agentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId }, select: { versaoPublicadaId: true } });
      if (!a) throw new NotFoundException('agente inexistente');
      const vs = await tx.agentVersion.findMany({ where: { agentId }, orderBy: { numero: 'desc' }, take: 100 });
      const avals = await tx.agentEvaluation.findMany({ where: { id: { in: vs.map((v) => v.avaliacaoId).filter((x): x is string => !!x) } }, select: { id: true, nota: true, regressao: true } });
      const porAval = new Map(avals.map((x) => [x.id, x]));
      return vs.map((v, i) => {
        const anterior = vs[i + 1];
        const av = v.avaliacaoId ? porAval.get(v.avaliacaoId) : undefined;
        return {
          id: v.id,
          numero: v.numero,
          origem: v.origem,
          notas: v.notas,
          publicadoPor: v.publicadoPor,
          createdAt: v.createdAt,
          atual: v.id === a.versaoPublicadaId,
          avaliacao: av ? { id: av.id, nota: av.nota === null ? null : Number(av.nota), regressao: av.regressao } : null,
          mudancas: anterior ? diffSnapshots(anterior.snapshot as unknown as SnapshotAgente, v.snapshot as unknown as SnapshotAgente).map((d) => d.campo) : ['versão inicial'],
        };
      });
    });
  }

  async obter(tenantId: string, agentId: string, versionId: string) {
    const v = await this.prisma.withTenant(tenantId, (tx) => tx.agentVersion.findFirst({ where: { id: versionId, agentId } }));
    if (!v) throw new NotFoundException('versão inexistente');
    return v;
  }

  /** Diferença entre o rascunho atual e uma versão (ou a publicada). */
  async diffRascunho(tenantId: string, agentId: string, versionId?: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId } });
      if (!a) throw new NotFoundException('agente inexistente');
      const alvoId = versionId ?? a.versaoPublicadaId;
      if (!alvoId) return { publicada: null, mudancas: [], pendente: true };
      const v = await tx.agentVersion.findFirst({ where: { id: alvoId, agentId } });
      if (!v) throw new NotFoundException('versão inexistente');
      const mudancas = diffSnapshots(v.snapshot as unknown as SnapshotAgente, snapshotDoAgente(a));
      return { publicada: { id: v.id, numero: v.numero }, mudancas, pendente: mudancas.length > 0 };
    });
  }

  /** Rollback: snapshot → rascunho → nova versão publicada (origem `restauracao`). */
  async restaurar(tenantId: string, ator: { identityId: string }, agentId: string, versionId: string) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const v = await tx.agentVersion.findFirst({ where: { id: versionId, agentId } });
      if (!v) throw new NotFoundException('versão inexistente');
      const s = v.snapshot as unknown as SnapshotAgente;
      await tx.agent.update({
        where: { id: agentId },
        data: {
          nome: s.nome,
          descricao: s.descricao,
          modelo: s.modelo,
          instrucoes: s.instrucoes,
          tom: s.tom,
          personalidade: s.personalidade,
          ferramentas: s.ferramentas,
          conhecimentoAtivo: s.conhecimentoAtivo,
          conhecimentoEscopos: s.conhecimentoEscopos,
          maxRespostasConversa: s.maxRespostasConversa,
          maxCaracteres: s.maxCaracteres,
          canais: s.canais,
          config: resolverConfig(s.config).config as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
    });
    return this.publicar(tenantId, ator, agentId, { notas: `Restauração da versão ${versionId}`, origem: 'restauracao', forcar: true });
  }
}
