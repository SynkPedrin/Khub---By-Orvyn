import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Agent } from '@prisma/client';
import type { RagEscopo } from '@orvyn/types';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicProvider } from '../ai/anthropic.provider';
import { AgentRuntimeService, historicoParaModelo, type ConfigAgente } from './agent-runtime.service';
import {
  CANAIS,
  ESCOPOS_CONHECIMENTO,
  FERRAMENTAS,
  IDS_ESCOPOS,
  IDS_FERRAMENTAS_OPCIONAIS,
  IDS_MODELOS,
  IDS_TONS,
  MODELOS,
  MODELO_PADRAO,
  TONS,
} from './catalogo';

/** Campos editáveis de um agente (o que a API aceita). */
export interface AgenteInput {
  nome?: string;
  descricao?: string | null;
  modelo?: string;
  instrucoes?: string;
  tom?: string;
  personalidade?: string;
  ferramentas?: string[];
  conhecimentoAtivo?: boolean;
  conhecimentoEscopos?: string[];
  maxRespostasConversa?: number;
  maxCaracteres?: number;
  canais?: string[];
  padrao?: boolean;
}

/** Só quem administra a conta configura agente (ele fala em nome da empresa). */
const PAPEIS_ESCRITA = ['owner', 'admin'];
/** Instrução mínima para ativar: agente sem instrução vira agente genérico. */
const MIN_INSTRUCOES_ATIVAR = 20;

/**
 * Agent Manager (RV-03.2 · ADR-0030): CRUD com validação contra o catálogo,
 * ciclo de vida (rascunho → ativo ⇄ pausado → arquivado) e playground.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AnthropicProvider,
    private readonly runtime: AgentRuntimeService,
  ) {}

  catalogo() {
    return {
      modelos: MODELOS,
      modeloPadrao: MODELO_PADRAO,
      tons: IDS_TONS.map((id) => ({ id, nome: TONS[id].nome, instrucao: TONS[id].instrucao })),
      ferramentas: FERRAMENTAS.map((f) => ({ nome: f.nome, rotulo: f.rotulo, descricao: f.descricao, tipo: f.tipo, obrigatoria: !!f.obrigatoria })),
      escopos: IDS_ESCOPOS.map((id) => ({ id, nome: ESCOPOS_CONHECIMENTO[id] })),
      canais: CANAIS,
      ia: { configurada: this.llm.configured(), faltando: this.llm.missing() },
    };
  }

  async listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const desde = new Date(Date.now() - 7 * 86_400_000);
      const [agentes, runs, conversas] = await Promise.all([
        tx.agent.findMany({ where: { status: { not: 'arquivado' } }, orderBy: [{ padrao: 'desc' }, { updatedAt: 'desc' }] }),
        tx.agentRun.groupBy({ by: ['agentId', 'status'], where: { createdAt: { gte: desde } }, _count: { _all: true }, _sum: { custoUsd: true } }),
        tx.conversation.groupBy({ by: ['agentId'], where: { atendimento: 'ia', status: 'aberta' }, _count: { _all: true } }),
      ]);
      return agentes.map((a) => {
        const meus = runs.filter((r) => r.agentId === a.id);
        const conta = (s: string) => meus.find((r) => r.status === s)?._count._all ?? 0;
        return {
          ...this.publico(a),
          metricas7d: {
            respondidas: conta('respondido'),
            transferidas: conta('transferido'),
            erros: conta('erro'),
            custoUsd: meus.reduce((t, r) => t + Number(r._sum.custoUsd ?? 0), 0),
          },
          conversasAtivas: conversas.find((c) => c.agentId === a.id)?._count._all ?? 0,
        };
      });
    });
  }

  async obter(tenantId: string, id: string) {
    const a = await this.prisma.withTenant(tenantId, (tx) => tx.agent.findUnique({ where: { id } }));
    if (!a || a.status === 'arquivado') throw new NotFoundException('agente inexistente');
    return this.publico(a);
  }

  async criar(tenantId: string, ator: { identityId: string; role: string }, input: AgenteInput) {
    this.exigirEscrita(ator.role);
    if (!input.nome?.trim()) throw new BadRequestException('nome é obrigatório');
    const dados = this.validar(input);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dados.padrao) await tx.agent.updateMany({ where: { padrao: true }, data: { padrao: false } });
      const a = await tx.agent.create({
        data: { tenantId, modelo: MODELO_PADRAO, ...dados, nome: input.nome!.trim(), status: 'rascunho', createdBy: ator.identityId },
      });
      await this.auditar(tx, tenantId, ator.identityId, 'agente.criado', a.id, { nome: a.nome, modelo: a.modelo });
      return this.publico(a);
    });
  }

  async atualizar(tenantId: string, ator: { identityId: string; role: string }, id: string, input: AgenteInput) {
    this.exigirEscrita(ator.role);
    const dados = this.validar(input);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.agent.findUnique({ where: { id } });
      if (!atual || atual.status === 'arquivado') throw new NotFoundException('agente inexistente');
      // Agente ativo não pode ficar sem instrução (passaria a atender "no escuro").
      if (atual.status === 'ativo' && dados.instrucoes !== undefined && dados.instrucoes.trim().length < MIN_INSTRUCOES_ATIVAR) {
        throw new BadRequestException(`agente ativo precisa de instruções (mínimo ${MIN_INSTRUCOES_ATIVAR} caracteres)`);
      }
      if (dados.padrao) await tx.agent.updateMany({ where: { padrao: true, id: { not: id } }, data: { padrao: false } });
      const a = await tx.agent.update({ where: { id }, data: { ...dados, ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}), updatedAt: new Date() } });
      await this.auditar(tx, tenantId, ator.identityId, 'agente.atualizado', id, { campos: Object.keys(input) });
      return this.publico(a);
    });
  }

  async mudarStatus(tenantId: string, ator: { identityId: string; role: string }, id: string, status: 'ativo' | 'pausado' | 'arquivado') {
    this.exigirEscrita(ator.role);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.agent.findUnique({ where: { id } });
      if (!atual || atual.status === 'arquivado') throw new NotFoundException('agente inexistente');
      if (status === 'ativo' && atual.instrucoes.trim().length < MIN_INSTRUCOES_ATIVAR) {
        throw new BadRequestException(`escreva as instruções do agente antes de ativar (mínimo ${MIN_INSTRUCOES_ATIVAR} caracteres)`);
      }
      // Arquivado deixa de ser padrão (o índice único ignora arquivados, mas a
      // flag ficaria mentindo na tela).
      const a = await tx.agent.update({ where: { id }, data: { status, ...(status === 'arquivado' ? { padrao: false } : {}), updatedAt: new Date() } });
      await this.auditar(tx, tenantId, ator.identityId, `agente.${status}`, id, {});
      return this.publico(a);
    });
  }

  /**
   * Playground: conversa de teste com o agente salvo (ou com um rascunho do
   * formulário). Leitura roda de verdade (a base de conhecimento é a real);
   * escrita é só descrita. Nada é enviado no WhatsApp. Gated: 501 sem chave.
   */
  async testar(tenantId: string, id: string, rascunho: AgenteInput | undefined, mensagens: { de: 'contato' | 'ia'; texto: string }[]) {
    this.llm.exigirCredencial();
    const { agente, tenant } = await this.prisma.withTenant(tenantId, async (tx) => ({
      agente: await tx.agent.findUnique({ where: { id } }),
      tenant: await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true, subespecialidade: true } }),
    }));
    if (!agente || agente.status === 'arquivado') throw new NotFoundException('agente inexistente');

    const config: ConfigAgente = { ...agente, ...(rascunho ? this.validar(rascunho) : {}), ...(rascunho?.nome ? { nome: rascunho.nome } : {}) };
    const historico = historicoParaModelo(mensagens.map((m) => ({ autorTipo: m.de === 'contato' ? 'contato' : 'ia', corpo: m.texto })));
    if (!historico.length) throw new BadRequestException('a última mensagem do teste precisa ser do contato');

    const r = await this.runtime.turno(config, historico, {
      tenantId,
      agentId: agente.id,
      agentNome: config.nome,
      conversationId: null,
      contactId: null,
      nicho: tenant?.nicho ?? null,
      subespecialidade: tenant?.subespecialidade ?? null,
      escopos: config.conhecimentoEscopos as RagEscopo[],
      simulacao: true,
    }, { empresa: tenant?.nome ?? 'a empresa', contatoNome: null });

    return {
      texto: r.texto,
      transferiria: r.recusa ? 'o modelo recusou responder' : r.transferir ?? (r.texto ? null : 'sem resposta'),
      ferramentas: r.ferramentas,
      fontes: r.fontes,
      guardrail: r.guardrail ?? null,
      modelo: r.modelo,
      custoUsd: r.custoUsd,
    };
  }

  // ------------------------------------------------------------ internos

  /** Valida contra o catálogo e devolve só os campos presentes. */
  validar(input: AgenteInput): Partial<Agent> {
    const erros: string[] = [];
    const fora = (lista: readonly string[] | undefined, permitidos: readonly string[]) => (lista ?? []).filter((x) => !permitidos.includes(x));

    if (input.modelo !== undefined && !IDS_MODELOS.includes(input.modelo)) erros.push(`modelo não permitido: ${input.modelo}`);
    if (input.tom !== undefined && !(IDS_TONS as string[]).includes(input.tom)) erros.push(`tom inválido: ${input.tom}`);
    const ferramentasInvalidas = fora(input.ferramentas, IDS_FERRAMENTAS_OPCIONAIS);
    if (ferramentasInvalidas.length) erros.push(`ferramentas não permitidas: ${ferramentasInvalidas.join(', ')}`);
    const escoposInvalidos = fora(input.conhecimentoEscopos, IDS_ESCOPOS);
    if (escoposInvalidos.length) erros.push(`escopos inválidos: ${escoposInvalidos.join(', ')}`);
    const canaisInvalidos = fora(input.canais, CANAIS);
    if (canaisInvalidos.length) erros.push(`canais não suportados: ${canaisInvalidos.join(', ')}`);
    if (input.canais !== undefined && input.canais.length === 0) erros.push('escolha ao menos um canal');
    if (erros.length) throw new BadRequestException(erros.join('; '));

    const d: Partial<Agent> = {};
    if (input.descricao !== undefined) d.descricao = input.descricao?.trim() || null;
    if (input.modelo !== undefined) d.modelo = input.modelo;
    if (input.instrucoes !== undefined) d.instrucoes = input.instrucoes;
    if (input.tom !== undefined) d.tom = input.tom;
    if (input.personalidade !== undefined) d.personalidade = input.personalidade.trim();
    if (input.ferramentas !== undefined) d.ferramentas = [...new Set(input.ferramentas)];
    if (input.conhecimentoAtivo !== undefined) d.conhecimentoAtivo = input.conhecimentoAtivo;
    if (input.conhecimentoEscopos !== undefined) d.conhecimentoEscopos = [...new Set(input.conhecimentoEscopos)];
    if (input.maxRespostasConversa !== undefined) d.maxRespostasConversa = input.maxRespostasConversa;
    if (input.maxCaracteres !== undefined) d.maxCaracteres = input.maxCaracteres;
    if (input.canais !== undefined) d.canais = [...new Set(input.canais)];
    if (input.padrao !== undefined) d.padrao = input.padrao;
    return d;
  }

  private exigirEscrita(role: string) {
    if (!PAPEIS_ESCRITA.includes(role)) throw new ForbiddenException('só owner ou admin configuram agentes');
  }

  private publico(a: Agent) {
    return {
      id: a.id,
      nome: a.nome,
      descricao: a.descricao,
      status: a.status,
      modelo: a.modelo,
      instrucoes: a.instrucoes,
      tom: a.tom,
      personalidade: a.personalidade,
      ferramentas: a.ferramentas,
      conhecimentoAtivo: a.conhecimentoAtivo,
      conhecimentoEscopos: a.conhecimentoEscopos,
      maxRespostasConversa: a.maxRespostasConversa,
      maxCaracteres: a.maxCaracteres,
      canais: a.canais,
      padrao: a.padrao,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  private async auditar(tx: { $executeRaw: PrismaService['$executeRaw'] }, tenantId: string, actorId: string, acao: string, id: string, payload: Record<string, unknown>) {
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'agent', ${id}, ${JSON.stringify(payload)}::jsonb)`;
  }
}
