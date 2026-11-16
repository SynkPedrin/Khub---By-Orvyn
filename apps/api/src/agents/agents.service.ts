import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Agent } from '@prisma/client';
import { ZodError } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_LLM, type AgentLlm } from '../ai/provider.contract';
import { AiProviderRegistry } from '../ai/provider.registry';
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
import {
  CAMPOS_COMPORTAMENTO,
  CAMPOS_CONDICAO,
  CAMPOS_PERFIL,
  DIMENSOES_PERSONALIDADE,
  IDS_INTENCOES_BASE,
  OPERADORES,
  PERFIS_PERSONALIDADE,
  TIPOS_ACAO_REGRA,
  TIPOS_OBJECAO,
  mesclarConfig,
  personalidadeSchema,
  resolverConfig,
  type AgentConfig,
} from './config/agent-config';
import { CATALOGO_ESTRATEGIAS, ESTRATEGIAS } from './engines/followup-policy';
import { TIPOS_FONTE } from './knowledge/text-extraction';
import { PERSONAS } from './simulator/simulator.service';
import { EvaluationService } from './evaluation/evaluation.service';
import { hashSnapshot, snapshotDoAgente, type SnapshotAgente } from './versioning/versioning.service';
import { modoDoAgente } from '../common/modo-agente';

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
  /** Atualização parcial por seção da configuração estendida. */
  config?: Partial<Record<keyof AgentConfig, unknown>>;
}

/** Só quem administra a conta configura agente (ele fala em nome da empresa). */
const PAPEIS_ESCRITA = ['owner', 'admin'];
/** Instrução mínima para ativar: agente sem instrução vira agente genérico. */
const MIN_INSTRUCOES_ATIVAR = 20;

type Ator = { identityId: string; role: string };
/** Colunas editáveis já validadas contra o catálogo. */
type DadosAgente = Partial<Pick<Agent, 'descricao' | 'modelo' | 'instrucoes' | 'tom' | 'personalidade' | 'ferramentas' | 'conhecimentoAtivo' | 'conhecimentoEscopos' | 'maxRespostasConversa' | 'maxCaracteres' | 'canais' | 'padrao'>>;
type Tx = Prisma.TransactionClient;

function erroConfig(e: unknown): never {
  if (e instanceof ZodError) {
    throw new BadRequestException({ title: 'configuração inválida', problemas: e.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })) });
  }
  throw e;
}

/**
 * AGENT MANAGER (ADR-0030 + docs/AI_AGENT_ARCHITECTURE.md §4–5): CRUD validado
 * contra o catálogo, configuração estendida por seção (Zod), ciclo de vida
 * (rascunho → ativo ⇄ pausado → arquivado → excluído), duplicação, categorias
 * de intenção e perfis de personalidade do tenant.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm,
    private readonly registry: AiProviderRegistry,
    private readonly avaliacoes: EvaluationService,
  ) {}

  async catalogo(tenantId: string) {
    const perfisTenant = await this.perfisPersonalidade(tenantId);
    // Modelos vêm do provedor ativo: Anthropic usa o catálogo fixo (MODELOS);
    // OpenAI/Ollama lista o que o servidor tem de verdade (`modelosDisponiveis`).
    const ativo = this.registry.ativo();
    const modelos = ativo.modelosDisponiveis ? await ativo.modelosDisponiveis() : [...MODELOS];
    return {
      modelos,
      modeloPadrao: modelos[0]?.id ?? MODELO_PADRAO,
      tons: IDS_TONS.map((id) => ({ id, nome: TONS[id].nome, instrucao: TONS[id].instrucao })),
      ferramentas: FERRAMENTAS.map((f) => ({ nome: f.nome, rotulo: f.rotulo, descricao: f.descricao, tipo: f.tipo, grupo: f.grupo, critica: !!f.critica, obrigatoria: !!f.obrigatoria })),
      escopos: IDS_ESCOPOS.map((id) => ({ id, nome: ESCOPOS_CONHECIMENTO[id] })),
      canais: CANAIS,
      personalidade: { dimensoes: DIMENSOES_PERSONALIDADE, perfis: [...Object.entries(PERFIS_PERSONALIDADE).map(([id, p]) => ({ id, nome: p.nome, valores: p.valores, embutido: true })), ...perfisTenant] },
      comportamento: CAMPOS_COMPORTAMENTO,
      regras: { campos: CAMPOS_CONDICAO, operadores: OPERADORES, acoes: TIPOS_ACAO_REGRA },
      intencoesBase: IDS_INTENCOES_BASE,
      objecoes: TIPOS_OBJECAO,
      camposPerfil: CAMPOS_PERFIL,
      estrategiasFollowup: ESTRATEGIAS.map((e) => ({ id: e, ...CATALOGO_ESTRATEGIAS[e] })),
      tiposFonte: TIPOS_FONTE,
      personas: PERSONAS.map(({ id, nome, descricao }) => ({ id, nome, descricao })),
      configPadrao: resolverConfig({}).config,
      ia: { configurada: this.llm.configured(), faltando: this.llm.missing(), provedor: this.llm.provedor() },
    };
  }

  async listar(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const desde = new Date(Date.now() - 7 * 86_400_000);
      const [agentes, runs, conversas, fontes, aprovacoes] = await Promise.all([
        tx.agent.findMany({ where: { status: { not: 'arquivado' } }, orderBy: [{ padrao: 'desc' }, { updatedAt: 'desc' }] }),
        tx.agentRun.groupBy({ by: ['agentId', 'status'], where: { createdAt: { gte: desde } }, _count: { _all: true }, _sum: { custoUsd: true, tokensEntrada: true, tokensSaida: true } }),
        tx.conversation.groupBy({ by: ['agentId'], where: { atendimento: 'ia', status: 'aberta' }, _count: { _all: true } }),
        tx.agentKnowledgeSource.groupBy({ by: ['agentId'], where: { ativo: true }, _count: { _all: true } }),
        tx.agentToolExecution.groupBy({ by: ['agentId'], where: { status: 'aguardando_aprovacao' }, _count: { _all: true } }),
      ]);
      const publicadas = await tx.agentVersion.findMany({ where: { id: { in: agentes.map((a) => a.versaoPublicadaId).filter((x): x is string => !!x) } }, select: { id: true, numero: true, snapshot: true } });
      const porVersao = new Map(publicadas.map((v) => [v.id, v]));
      return agentes.map((a) => {
        const meus = runs.filter((r) => r.agentId === a.id);
        const conta = (s: string) => meus.find((r) => r.status === s)?._count._all ?? 0;
        const v = a.versaoPublicadaId ? porVersao.get(a.versaoPublicadaId) : undefined;
        return {
          ...this.publico(a),
          versaoPublicada: v ? { id: v.id, numero: v.numero } : null,
          alteracoesNaoPublicadas: v ? hashSnapshot(v.snapshot as unknown as SnapshotAgente) !== hashSnapshot(snapshotDoAgente(a)) : null,
          metricas7d: {
            respondidas: conta('respondido'),
            transferidas: conta('transferido'),
            erros: conta('erro'),
            custoUsd: meus.reduce((t, r) => t + Number(r._sum.custoUsd ?? 0), 0),
            tokens: meus.reduce((t, r) => t + Number(r._sum.tokensEntrada ?? 0) + Number(r._sum.tokensSaida ?? 0), 0),
          },
          conversasAtivas: conversas.find((c) => c.agentId === a.id)?._count._all ?? 0,
          fontesConhecimento: fontes.find((f) => f.agentId === a.id)?._count._all ?? 0,
          aprovacoesPendentes: aprovacoes.find((x) => x.agentId === a.id)?._count._all ?? 0,
        };
      });
    });
  }

  async obter(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await this.exigir(tx, id);
      const v = a.versaoPublicadaId ? await tx.agentVersion.findUnique({ where: { id: a.versaoPublicadaId }, select: { id: true, numero: true, snapshot: true, createdAt: true } }) : null;
      return {
        ...this.publico(a),
        versaoPublicada: v ? { id: v.id, numero: v.numero, publicadaEm: v.createdAt } : null,
        alteracoesNaoPublicadas: v ? hashSnapshot(v.snapshot as unknown as SnapshotAgente) !== hashSnapshot(snapshotDoAgente(a)) : null,
      };
    });
  }

  async criar(tenantId: string, ator: Ator, input: AgenteInput) {
    this.exigirEscrita(ator.role);
    if (!input.nome?.trim()) throw new BadRequestException('nome é obrigatório');
    const dados = this.validar(input);
    let config: AgentConfig;
    try {
      config = mesclarConfig(resolverConfig({}).config, input.config ?? {});
    } catch (e) {
      erroConfig(e);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dados.padrao) await tx.agent.updateMany({ where: { padrao: true }, data: { padrao: false } });
      const a = await tx.agent.create({
        data: { tenantId, modelo: MODELO_PADRAO, ...dados, config: config as unknown as Prisma.InputJsonValue, nome: input.nome!.trim(), status: 'rascunho', createdBy: ator.identityId },
      });
      await this.avaliacoes.semearPadrao(tx, tenantId, a.id);
      await this.auditar(tx, tenantId, ator.identityId, 'agente.criado', a.id, { nome: a.nome, modelo: a.modelo });
      return this.publico(a);
    });
  }

  async atualizar(tenantId: string, ator: Ator, id: string, input: AgenteInput) {
    this.exigirEscrita(ator.role);
    const dados = this.validar(input);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, id);
      // Agente ativo não pode ficar sem instrução (passaria a atender "no escuro").
      if (atual.status === 'ativo' && dados.instrucoes !== undefined && dados.instrucoes.trim().length < MIN_INSTRUCOES_ATIVAR) {
        throw new BadRequestException(`agente ativo precisa de instruções (mínimo ${MIN_INSTRUCOES_ATIVAR} caracteres)`);
      }
      let config: AgentConfig | undefined;
      if (input.config) {
        try {
          config = mesclarConfig(resolverConfig(atual.config).config, input.config);
        } catch (e) {
          erroConfig(e);
        }
      }
      if (dados.padrao) await tx.agent.updateMany({ where: { padrao: true, id: { not: id } }, data: { padrao: false } });
      const a = await tx.agent.update({
        where: { id },
        data: { ...dados, ...(config ? { config: config as unknown as Prisma.InputJsonValue } : {}), ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}), updatedAt: new Date() },
      });
      await this.auditar(tx, tenantId, ator.identityId, 'agente.atualizado', id, { campos: Object.keys(input), secoes: input.config ? Object.keys(input.config) : [] });
      await this.aplicarModo(tx, tenantId, ator.identityId, a, modoDoAgente(atual.config));
      return this.publico(a);
    });
  }

  async mudarStatus(tenantId: string, ator: Ator, id: string, status: 'ativo' | 'pausado' | 'arquivado') {
    this.exigirEscrita(ator.role);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await this.exigir(tx, id);
      if (status === 'ativo' && atual.instrucoes.trim().length < MIN_INSTRUCOES_ATIVAR) {
        throw new BadRequestException(`escreva as instruções do agente antes de ativar (mínimo ${MIN_INSTRUCOES_ATIVAR} caracteres)`);
      }
      // Arquivado deixa de ser padrão e libera as conversas para humanos.
      const a = await tx.agent.update({ where: { id }, data: { status, ...(status === 'arquivado' ? { padrao: false } : {}), updatedAt: new Date() } });
      if (status === 'arquivado') {
        await tx.agentFollowup.updateMany({ where: { agentId: id, status: 'agendado' }, data: { status: 'cancelado', motivo: 'agente arquivado' } });
      }
      await this.auditar(tx, tenantId, ator.identityId, `agente.${status}`, id, {});
      if (status === 'ativo') await this.aplicarModo(tx, tenantId, ator.identityId, a, null);
      return this.publico(a);
    });
  }

  /** Duplica configuração, fontes de conhecimento, regras de follow-up e cenários. Nasce rascunho. */
  async duplicar(tenantId: string, ator: Ator, id: string, nome?: string) {
    this.exigirEscrita(ator.role);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const o = await this.exigir(tx, id);
      const novo = await tx.agent.create({
        data: {
          tenantId,
          nome: (nome?.trim() || `${o.nome} (cópia)`).slice(0, 80),
          descricao: o.descricao,
          modelo: o.modelo,
          instrucoes: o.instrucoes,
          tom: o.tom,
          personalidade: o.personalidade,
          ferramentas: o.ferramentas,
          conhecimentoAtivo: o.conhecimentoAtivo,
          conhecimentoEscopos: o.conhecimentoEscopos,
          maxRespostasConversa: o.maxRespostasConversa,
          maxCaracteres: o.maxCaracteres,
          canais: o.canais,
          padrao: false,
          status: 'rascunho',
          config: o.config as Prisma.InputJsonValue,
          createdBy: ator.identityId,
        },
      });
      const [fontes, regras, cenarios] = await Promise.all([
        tx.agentKnowledgeSource.findMany({ where: { agentId: id } }),
        tx.agentFollowupRule.findMany({ where: { agentId: id } }),
        tx.agentEvalScenario.findMany({ where: { agentId: id } }),
      ]);
      if (fontes.length) await tx.agentKnowledgeSource.createMany({ data: fontes.map((f) => ({ tenantId, agentId: novo.id, documentId: f.documentId, categoria: f.categoria, ativo: f.ativo, createdBy: ator.identityId })) });
      if (regras.length) {
        await tx.agentFollowupRule.createMany({
          data: regras.map(({ id: _i, agentId: _a, createdAt: _c, updatedAt: _u, ...r }) => ({ ...r, agentId: novo.id, ativo: false })),
        });
      }
      if (cenarios.length) {
        await tx.agentEvalScenario.createMany({ data: cenarios.map((c) => ({ tenantId, agentId: novo.id, nome: c.nome, mensagens: c.mensagens as Prisma.InputJsonValue, expectativas: c.expectativas as Prisma.InputJsonValue, ativo: c.ativo, origem: c.origem })) });
      }
      await this.auditar(tx, tenantId, ator.identityId, 'agente.duplicado', novo.id, { origem: id });
      return this.publico(novo);
    });
  }

  /** Exclusão definitiva: só de agente ARQUIVADO e com o nome digitado como confirmação. */
  async excluir(tenantId: string, ator: Ator, id: string, confirmacao: string) {
    this.exigirEscrita(ator.role);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('agente inexistente');
      if (a.status !== 'arquivado') throw new BadRequestException('arquive o agente antes de excluir');
      if (confirmacao.trim() !== a.nome) throw new BadRequestException('confirmação não confere: digite o nome exato do agente');
      // Conversas e mensagens ficam (histórico do cliente); o vínculo vira NULL (FK SET NULL).
      await tx.agent.update({ where: { id }, data: { versaoPublicadaId: null } });
      await tx.agent.delete({ where: { id } });
      await this.auditar(tx, tenantId, ator.identityId, 'agente.excluido', id, { nome: a.nome });
      return { ok: true };
    });
  }

  async arquivados(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.agent.findMany({ where: { status: 'arquivado' }, orderBy: { updatedAt: 'desc' }, select: { id: true, nome: true, updatedAt: true } }));
  }

  // ------------------------------------------------------------------ intenções personalizadas (tenant)

  async intencoes(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.agentIntentCategory.findMany({ orderBy: { nome: 'asc' } }));
  }

  async salvarIntencao(tenantId: string, ator: Ator, i: { chave: string; nome: string; descricao?: string; exemplos?: string[]; ativo?: boolean }) {
    this.exigirEscrita(ator.role);
    const chave = i.chave.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(chave)) throw new BadRequestException('chave: letras minúsculas, números e _ (2–40)');
    if ((IDS_INTENCOES_BASE as readonly string[]).includes(chave)) throw new BadRequestException('essa intenção já existe na base');
    const dados = { nome: i.nome.trim().slice(0, 60), descricao: (i.descricao ?? '').slice(0, 400), exemplos: (i.exemplos ?? []).map((e) => e.trim()).filter(Boolean).slice(0, 20), ativo: i.ativo ?? true, updatedAt: new Date() };
    return this.prisma.withTenant(tenantId, (tx) => tx.agentIntentCategory.upsert({ where: { tenantId_chave: { tenantId, chave } }, create: { tenantId, chave, ...dados }, update: dados }));
  }

  async removerIntencao(tenantId: string, ator: Ator, id: string) {
    this.exigirEscrita(ator.role);
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.agentIntentCategory.deleteMany({ where: { id } }));
    if (!r.count) throw new NotFoundException('intenção inexistente');
    return { ok: true };
  }

  // ------------------------------------------------------------------ perfis de personalidade (tenant)

  private async perfisPersonalidade(tenantId: string): Promise<{ id: string; nome: string; valores: Record<string, number>; embutido: false }[]> {
    const t = await this.prisma.withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }));
    const lista = ((t?.settings as Record<string, unknown>)?.agentePerfisPersonalidade ?? []) as { id: string; nome: string; valores: Record<string, number> }[];
    return Array.isArray(lista) ? lista.map((p) => ({ ...p, embutido: false as const })) : [];
  }

  async salvarPerfilPersonalidade(tenantId: string, ator: Ator, i: { nome: string; valores: Record<string, number> }) {
    this.exigirEscrita(ator.role);
    const nome = i.nome.trim().slice(0, 60);
    if (!nome) throw new BadRequestException('nome é obrigatório');
    const p = personalidadeSchema.safeParse({ ...i.valores, perfil: 'personalizado' });
    if (!p.success) throw new BadRequestException(`valores inválidos: ${p.error.issues[0]?.message}`);
    const { perfil: _p, ...valores } = p.data;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      const settings = (t?.settings ?? {}) as Record<string, unknown>;
      const atuais = (Array.isArray(settings.agentePerfisPersonalidade) ? settings.agentePerfisPersonalidade : []) as { id: string; nome: string; valores: Record<string, number> }[];
      const id = `custom_${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
      const lista = [...atuais.filter((x) => x.id !== id), { id, nome, valores }].slice(-30);
      await tx.tenant.update({ where: { id: tenantId }, data: { settings: { ...settings, agentePerfisPersonalidade: lista } as Prisma.InputJsonValue } });
      return { id, nome, valores };
    });
  }

  // ------------------------------------------------------------------ internos

  /** Valida contra o catálogo e devolve só os campos presentes. */
  validar(input: AgenteInput): DadosAgente {
    const erros: string[] = [];
    const fora = (lista: readonly string[] | undefined, permitidos: readonly string[]) => (lista ?? []).filter((x) => !permitidos.includes(x));

    // A allowlist fixa (IDS_MODELOS) só vale para o catálogo Anthropic; com
    // outro provedor ativo os ids válidos vêm do próprio servidor (o catálogo
    // dinâmico exposto em GET /v1/agents/catalogo).
    if (input.modelo !== undefined && this.registry.nomeAtivo === 'anthropic' && !IDS_MODELOS.includes(input.modelo)) erros.push(`modelo não permitido: ${input.modelo}`);
    if (input.tom !== undefined && !(IDS_TONS as string[]).includes(input.tom)) erros.push(`tom inválido: ${input.tom}`);
    const ferramentasInvalidas = fora(input.ferramentas, IDS_FERRAMENTAS_OPCIONAIS);
    if (ferramentasInvalidas.length) erros.push(`ferramentas não permitidas: ${ferramentasInvalidas.join(', ')}`);
    const escoposInvalidos = fora(input.conhecimentoEscopos, IDS_ESCOPOS);
    if (escoposInvalidos.length) erros.push(`escopos inválidos: ${escoposInvalidos.join(', ')}`);
    const canaisInvalidos = fora(input.canais, CANAIS);
    if (canaisInvalidos.length) erros.push(`canais não suportados: ${canaisInvalidos.join(', ')}`);
    if (input.canais !== undefined && input.canais.length === 0) erros.push('escolha ao menos um canal');
    if (erros.length) throw new BadRequestException(erros.join('; '));

    const d: DadosAgente = {};
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

  private async exigir(tx: Tx, id: string): Promise<Agent> {
    const a = await tx.agent.findUnique({ where: { id } });
    if (!a || a.status === 'arquivado') throw new NotFoundException('agente inexistente');
    return a;
  }

  private exigirEscrita(role: string) {
    if (!PAPEIS_ESCRITA.includes(role)) throw new ForbiddenException('só owner ou admin configuram agentes');
  }

  publico(a: Agent) {
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
      config: resolverConfig(a.config).config,
      versaoPublicadaId: a.versaoPublicadaId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  /**
   * Modo do agente vale para TODOS os clientes (ADR-0048, pedido do product owner):
   * - piloto automático + principal + ativo: toda conversa aberta do canal que
   *   não está com um humano (sem responsável e sem transferência da IA) passa
   *   para a IA. Ela só fala quando o cliente mandar a próxima mensagem.
   * - virou sugestivo: a IA sai das conversas onde estava (voltam para humano,
   *   com o agente guardado para "Devolver para a IA"); dali em diante só entra
   *   pelo nó "Ativar IA" da automação ou pelo botão na conversa.
   */
  private async aplicarModo(tx: Tx, tenantId: string, atorId: string, a: { id: string; status: string; padrao: boolean; canais: string[]; config: unknown }, modoAnterior: string | null): Promise<void> {
    const modo = modoDoAgente(a.config);
    if (modo === 'sugestivo' && modoAnterior === 'automatico') {
      const r = await tx.conversation.updateMany({ where: { agentId: a.id, atendimento: 'ia' }, data: { atendimento: 'humano', handoffMotivo: null, handoffAt: null } });
      if (r.count) await this.auditar(tx, tenantId, atorId, 'agente.modo_sugestivo', a.id, { conversasLiberadas: r.count });
      return;
    }
    if (modo !== 'automatico' || a.status !== 'ativo' || !a.padrao || !a.canais.length) return;
    const r = await tx.conversation.updateMany({
      where: { atendimento: 'humano', assigneeId: null, handoffMotivo: null, status: { not: 'resolvida' }, canal: { in: a.canais } },
      data: { atendimento: 'ia', agentId: a.id },
    });
    if (r.count) await this.auditar(tx, tenantId, atorId, 'agente.piloto_automatico', a.id, { conversasAssumidas: r.count });
  }

  private async auditar(tx: Tx, tenantId: string, actorId: string, acao: string, id: string, payload: Record<string, unknown>) {
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'agent', ${id}, ${JSON.stringify(payload)}::jsonb)`;
  }
}
