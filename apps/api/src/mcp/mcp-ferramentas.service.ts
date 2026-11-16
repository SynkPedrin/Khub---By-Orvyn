import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TOOLS, type Sensibilidade, type Tool } from '../nyro/tools';
import { ToolExecutorService, type ContextoNyro } from '../nyro/tool-executor.service';
import { AgentsService } from '../agents/agents.service';
import { AgentStudioService } from '../agents/agent-studio.service';
import { SimulatorService, PERSONAS } from '../agents/simulator/simulator.service';
import { VersioningService } from '../agents/versioning/versioning.service';
import { resolverConfig } from '../agents/config/agent-config';
import { CANAIS, IDS_MODELOS, IDS_TONS } from '../agents/catalogo';
import { WorkflowsService } from '../automations/workflows.service';
import { RunsService } from '../automations/runs.service';
import { CATALOGO as CATALOGO_NOS } from '../automations/catalogo';
import { SettingsService } from '../settings/settings.service';
import { paraJsonSchema } from './json-schema';
import { PAPEIS_MCP, type AtorMcp } from './oauth.service';

/**
 * Catálogo de tools do conector MCP (ADR-0049) — o que o Claude/ChatGPT podem
 * fazer no KHUB. Duas fontes, um executor:
 *
 *  1. as tools da NICO (CRM, funil, financeiro, automações, análises, web…),
 *     exceto as de memória/plano internos da conversa dela;
 *  2. tools de gestão da plataforma, daqui: agentes (ver, criar, editar
 *     rascunho, testar no simulador, publicar, ativar/pausar, canais),
 *     automações (ver grafo, execuções, testar no número de teste, rascunho,
 *     publicar), configurações e auditoria.
 *
 * Tudo passa pelos SERVIÇOS da plataforma (mesma validação, RLS e auditoria de
 * um humano; `actor:'mcp'`). Sensível = muda algo que o cliente final sente
 * (mensagem, agente/automação em produção) → NÃO executa: vira pedido de
 * aprovação no KHUB (o mesmo da NICO). Só o humano aprova, lá.
 */

export interface FerramentaMcp {
  nome: string;
  titulo: string;
  descricao: string;
  schema: z.ZodObject<z.ZodRawShape>;
  sensibilidade: Sensibilidade;
  /** Aciona sistema fora do KHUB (web, WhatsApp de teste)? */
  mundoAberto?: boolean;
}

export interface ResultadoMcp {
  ok: boolean;
  /** Conteúdo para o modelo (JSON enxuto). */
  dados?: unknown;
  erro?: string;
  aprovacao?: { id: string; resumo: string };
}

/** Internas da conversa da NICO: não fazem sentido fora dela. */
const NICO_FORA_DO_MCP = new Set(['atualizar_plano', 'lembrar', 'esquecer']);
const LIMITE_RESULTADO = 60_000;

const uuid = (o: string) => z.string().uuid().describe(o);
const tituloDe = (nome: string) => nome.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------- tools próprias

type Exec = (a: Record<string, unknown>, ctx: ContextoNyro & { role: string }) => Promise<unknown>;
interface Propria extends FerramentaMcp {
  resumir: (a: Record<string, never>) => string;
  exec: Exec;
}

const EDITAVEIS_AGENTE = {
  nome: z.string().min(1).max(80).optional().describe('Nome do agente'),
  descricao: z.string().max(500).optional().describe('Descrição interna'),
  instrucoes: z.string().max(30000).optional().describe('Prompt/instruções completas do agente (substitui o texto atual)'),
  tom: z.enum(IDS_TONS as [string, ...string[]]).optional().describe('Tom de voz'),
  personalidade: z.string().max(2000).optional(),
  modelo: z.enum(IDS_MODELOS as [string, ...string[]]).optional().describe('Modelo de IA que responde os clientes'),
  maxCaracteres: z.number().int().min(50).max(4000).optional().describe('Tamanho máximo de cada resposta'),
  maxRespostasConversa: z.number().int().min(1).max(500).optional(),
  conhecimentoAtivo: z.boolean().optional().describe('Usar a base de conhecimento ao responder'),
  config: z.record(z.unknown()).optional().describe('Seções da configuração avançada a mesclar (as mesmas de ver_agente.config). A seção "modo" só muda pela tela do KHUB.'),
};

@Injectable()
export class McpFerramentasService implements OnModuleInit {
  private readonly log = new Logger('McpTools');
  private readonly proprias: Propria[];
  private readonly catalogo: (FerramentaMcp & { origem: 'nico' | 'mcp' })[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: ToolExecutorService,
    private readonly agentes: AgentsService,
    private readonly studio: AgentStudioService,
    private readonly simulador: SimulatorService,
    private readonly versoes: VersioningService,
    private readonly workflows: WorkflowsService,
    private readonly runs: RunsService,
    private readonly settings: SettingsService,
  ) {
    this.proprias = this.definirProprias();
    const nico = TOOLS.filter((t) => !NICO_FORA_DO_MCP.has(t.nome)).map((t) => ({
      nome: t.nome,
      titulo: tituloDe(t.nome),
      descricao: t.descricao,
      schema: t.schema as z.ZodObject<z.ZodRawShape>,
      sensibilidade: t.sensibilidade,
      mundoAberto: ['pesquisar_web', 'ler_pagina', 'benchmark_biblioteca_anuncios', 'enviar_mensagem'].includes(t.nome),
      origem: 'nico' as const,
    }));
    this.catalogo = [...this.proprias.map((p) => ({ ...p, origem: 'mcp' as const })), ...nico];
  }

  /** As tools próprias entram no executor da NICO: aprovar no KHUB executa por lá. */
  onModuleInit(): void {
    for (const p of this.proprias) {
      const tool: Tool = { nome: p.nome, descricao: p.descricao, schema: p.schema, sensibilidade: p.sensibilidade, resumir: p.resumir };
      this.executor.registrarExtra(tool, async (args, ctx) => p.exec(args, { ...ctx, role: await this.papel(ctx) }));
    }
  }

  /** Formato `tools/list` do MCP. */
  listar() {
    return this.catalogo.map((t) => ({
      name: t.nome,
      title: t.titulo,
      description: t.sensibilidade === 'sensivel'
        ? `${t.descricao}\n\n[Ação sensível: NÃO executa na hora. Cria um pedido de aprovação no KHUB; um humano aprova em KHUB > NICO > Aprovações.]`
        : t.descricao,
      inputSchema: paraJsonSchema(t.schema),
      annotations: {
        title: t.titulo,
        readOnlyHint: t.sensibilidade === 'leitura',
        destructiveHint: t.sensibilidade === 'sensivel',
        idempotentHint: t.sensibilidade === 'leitura',
        openWorldHint: !!t.mundoAberto,
      },
    }));
  }

  existe(nome: string): boolean {
    return this.catalogo.some((t) => t.nome === nome);
  }

  async chamar(nome: string, args: Record<string, unknown>, ator: AtorMcp): Promise<ResultadoMcp> {
    const t = this.catalogo.find((x) => x.nome === nome);
    if (!t) return { ok: false, erro: `ferramenta desconhecida: ${nome}` };
    const parsed = t.schema.safeParse(args ?? {});
    if (!parsed.success) {
      return { ok: false, erro: `argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}` };
    }
    const ctx = await this.contexto(ator);

    if (t.sensibilidade === 'sensivel') {
      const resumo = this.resumir(nome, parsed.data);
      const a = await this.prisma.withTenant(ator.tenantId, (tx) =>
        tx.nyroAction.create({
          data: {
            tenantId: ator.tenantId, conversationId: null, tool: nome,
            argumentos: parsed.data as Prisma.InputJsonValue,
            resumo: `[${ator.nomeCliente}] ${resumo}`.slice(0, 500),
            expiraEm: new Date(Date.now() + 24 * 3600_000),
          },
          select: { id: true, resumo: true },
        }),
      );
      await this.auditar(ator, `mcp.aprovacao_pedida.${nome}`, parsed.data);
      return { ok: true, aprovacao: a };
    }

    const r = await this.executor.executar(nome, parsed.data, ctx);
    return r.ok ? { ok: true, dados: r.fontes ? { ...((r.dados as object) ?? {}), fontes: r.fontes } : r.dados } : { ok: false, erro: r.erro };
  }

  /** Texto final para o modelo, cortado com aviso (resultado gigante estoura o contexto dele). */
  static serializar(dados: unknown): string {
    const s = JSON.stringify(dados ?? { ok: true }, null, 1);
    return s.length > LIMITE_RESULTADO ? `${s.slice(0, LIMITE_RESULTADO)}\n…[resultado cortado: peça um recorte menor]` : s;
  }

  private resumir(nome: string, args: unknown): string {
    const p = this.proprias.find((x) => x.nome === nome);
    if (p) return p.resumir(args as Record<string, never>);
    const nico = TOOLS.find((x) => x.nome === nome);
    return nico ? nico.resumir(args as Record<string, never>) : nome;
  }

  private async contexto(ator: AtorMcp): Promise<ContextoNyro & { role: string }> {
    const t = await this.prisma.withTenant(ator.tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: ator.tenantId }, select: { nicho: true, subespecialidade: true } }),
    );
    return { tenantId: ator.tenantId, identityId: ator.identityId, nicho: t?.nicho ?? null, subespecialidade: t?.subespecialidade ?? null, origem: 'mcp', role: ator.role };
  }

  /** Papel de quem executa (no caminho da aprovação é quem APROVOU no KHUB). */
  private async papel(ctx: ContextoNyro): Promise<string> {
    const m = await this.prisma.membership.findUnique({
      where: { identityId_tenantId: { identityId: ctx.identityId, tenantId: ctx.tenantId } },
      select: { role: true },
    });
    return m?.role ?? 'viewer';
  }

  private async auditar(ator: AtorMcp, acao: string, payload: unknown) {
    try {
      await this.prisma.withTenant(ator.tenantId, (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
          VALUES (${ator.tenantId}::uuid, 'mcp', ${ator.identityId}, ${acao}, 'mcp_conexao', ${ator.conexaoId}, ${JSON.stringify({ aplicativo: ator.nomeCliente, args: payload })}::jsonb)`,
      );
    } catch (e) {
      this.log.warn(`falha ao auditar ${acao}: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- definições

  private definirProprias(): Propria[] {
    const ator = (ctx: { identityId: string; role: string }) => {
      if (!PAPEIS_MCP.includes(ctx.role)) throw new ForbiddenException('só dono ou admin gerencia agentes e configurações');
      return { identityId: ctx.identityId, role: ctx.role };
    };
    const p = <S extends z.ZodRawShape>(
      nome: string, titulo: string, descricao: string, shape: S, sensibilidade: Sensibilidade,
      resumir: (a: z.infer<z.ZodObject<S>>) => string,
      exec: (a: z.infer<z.ZodObject<S>>, ctx: ContextoNyro & { role: string }) => Promise<unknown>,
      mundoAberto = false,
    ): Propria => ({
      nome, titulo, descricao, schema: z.object(shape).strict(), sensibilidade, mundoAberto,
      resumir: resumir as Propria['resumir'], exec: exec as Exec,
    });

    return [
      // ------------------------------ visão geral e configurações
      p('khub_visao_geral', 'Visão geral da conta',
        'Fotografia da subconta no KHUB: empresa, agentes de IA (status, padrão, versão publicada), automações (ativas/pausadas), canais conectados, conversas abertas com IA × humano nas últimas 48 h, execuções do agente nas últimas 24 h e aprovações pendentes. Use PRIMEIRO para se situar.',
        {}, 'leitura', () => 'ler a visão geral da conta',
        (_a, ctx) => this.visaoGeral(ctx.tenantId)),
      p('ver_configuracoes', 'Ver configurações',
        'Configurações da plataforma: dados da empresa, preferências da conta, membros da equipe e papéis, integrações e canais (status e saúde; nunca credenciais).',
        {}, 'leitura', () => 'ler as configurações',
        (_a, ctx) => this.configuracoes(ctx.tenantId)),
      p('atualizar_dados_empresa', 'Atualizar dados da empresa',
        'Altera nome, endereço, telefone ou site da empresa (aparecem para a equipe e podem ser usados pelos agentes).',
        {
          nome: z.string().min(2).max(120).optional(),
          endereco: z.string().max(300).optional(),
          telefone: z.string().max(40).optional(),
          website: z.string().max(200).optional(),
        }, 'escrita', (a) => `atualizar dados da empresa (${Object.keys(a).join(', ')})`,
        (a, ctx) => { ator(ctx); return this.settings.updateBusiness(ctx.tenantId, ctx.identityId, a); }),
      p('ver_auditoria', 'Ver auditoria',
        'Últimos registros do log de auditoria: quem fez o quê (humano, NICO, MCP, sistema) e quando.',
        { limite: z.number().int().min(1).max(200).default(50) }, 'leitura', () => 'ler a auditoria',
        async (a, ctx) => this.settings.auditLogs(ctx.tenantId, a.limite)),
      p('aprovacoes_pendentes', 'Aprovações pendentes',
        'Ações sensíveis esperando um humano aprovar no KHUB (pedidas pela NICO ou por este conector).',
        {}, 'leitura', () => 'listar aprovações pendentes',
        (_a, ctx) => this.prisma.withTenant(ctx.tenantId, (tx) => tx.nyroAction.findMany({
          where: { status: 'pendente', expiraEm: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 30,
          select: { id: true, tool: true, resumo: true, createdAt: true, expiraEm: true },
        }))),

      // ------------------------------ agentes
      p('listar_agentes', 'Listar agentes',
        'Agentes de IA de atendimento: status, padrão, canais, modelo, versão publicada, se há alterações não publicadas e métricas de 7 dias (respondidas, transferidas, erros, custo).',
        {}, 'leitura', () => 'listar os agentes',
        async (_a, ctx) => (await this.agentes.listar(ctx.tenantId)).map((x) => ({ ...x, instrucoes: `${x.instrucoes.slice(0, 280)}${x.instrucoes.length > 280 ? '…' : ''}` }))),
      p('ver_agente', 'Ver agente',
        'Tudo de um agente: instruções completas (rascunho), configuração avançada resolvida, versão publicada (é ela que atende os clientes) e histórico de versões.',
        { agentId: uuid('id do agente (de listar_agentes)') }, 'leitura', () => 'abrir o agente',
        async (a, ctx) => {
          const ag = await this.agentes.obter(ctx.tenantId, a.agentId);
          const bruto = await this.prisma.withTenant(ctx.tenantId, (tx) => tx.agent.findUnique({ where: { id: a.agentId }, select: { config: true } }));
          const { config, avisos } = resolverConfig(bruto?.config);
          const historico = await this.versoes.historico(ctx.tenantId, a.agentId);
          return { ...ag, config, avisosConfig: avisos, historico: (historico as unknown[]).slice(0, 10) };
        }),
      p('atividade_agente', 'Atividade do agente',
        'Últimas execuções do agente (respondeu, transferiu para humano, erro, motivo, modelo, latência) e as conversas recentes que ele atendeu.',
        { agentId: uuid('id do agente'), limite: z.number().int().min(1).max(50).default(15) }, 'leitura', () => 'ler a atividade do agente',
        async (a, ctx) => ({
          execucoes: await this.studio.atividadeDoAgente(ctx.tenantId, a.agentId, a.limite),
          conversas: await this.studio.conversasDoAgente(ctx.tenantId, a.agentId, a.limite),
        })),
      p('analisar_agente', 'Analisar prompt do agente',
        'Revisão técnica das instruções do agente feita pela IA do KHUB: lacunas, contradições, riscos (promessa, dado sensível), sugestões concretas.',
        { agentId: uuid('id do agente') }, 'leitura', () => 'analisar o prompt do agente',
        (a, ctx) => this.studio.analisarAgente(ctx.tenantId, a.agentId)),
      p('criar_agente', 'Criar agente',
        'Cria um agente NOVO como rascunho (não atende ninguém até ser publicado e ativado). Use testar_agente antes de pedir a publicação.',
        { ...EDITAVEIS_AGENTE, nome: z.string().min(1).max(80).describe('Nome do agente') }, 'escrita', (a) => `criar o agente "${a.nome}"`,
        (a, ctx) => this.agentes.criar(ctx.tenantId, ator(ctx), this.semModo(a))),
      p('editar_agente', 'Editar rascunho do agente',
        'Edita o RASCUNHO do agente (instruções, tom, modelo, limites, configuração avançada). Os clientes continuam sendo atendidos pela versão publicada até publicar_agente ser aprovado — edite, teste com testar_agente e então peça a publicação.',
        { agentId: uuid('id do agente'), ...EDITAVEIS_AGENTE }, 'escrita', () => 'editar o rascunho do agente',
        ({ agentId, ...resto }, ctx) => this.agentes.atualizar(ctx.tenantId, ator(ctx), agentId, this.semModo(resto))),
      p('testar_agente', 'Testar agente no simulador',
        `Conversa de teste com o agente no simulador (nada é enviado a cliente nenhum). Mande 1 a 5 mensagens como se fosse o cliente; devolve as respostas, a decisão (responder/transferir), intenção detectada e custo. Para continuar a MESMA conversa, repita com simulacaoId. Perfis: ${PERSONAS.map((x) => `${x.id} (${x.nome})`).join(', ')}.`,
        {
          agentId: uuid('id do agente'),
          mensagens: z.array(z.string().min(1).max(2000)).min(1).max(5).describe('Mensagens do "cliente" neste turno'),
          simulacaoId: z.string().uuid().optional().describe('Continua uma simulação anterior'),
          perfil: z.string().max(40).optional().describe('Perfil do cliente simulado (só ao criar)'),
          usarRascunho: z.boolean().default(true).describe('true = testa o rascunho em edição; false = a versão publicada'),
        }, 'escrita', () => 'testar o agente no simulador',
        async (a, ctx) => {
          const simId = a.simulacaoId ?? (await this.simulador.criar(ctx.tenantId, a.agentId, ctx.identityId, { perfil: a.perfil, usarRascunho: a.usarRascunho })).id;
          const r = await this.simulador.turno(ctx.tenantId, simId, a.mensagens);
          const tr = r.trace as Record<string, unknown>;
          return {
            simulacaoId: simId,
            respostas: r.resposta.map((m) => m.texto),
            decisao: r.decisao,
            versaoTestada: tr.versao,
            intencao: tr.intencao ?? null,
            custoUsd: tr.custoUsd,
            execucaoMs: tr.execucaoMs,
            iaConfigurada: r.iaConfigurada,
          };
        }, true),
      p('publicar_agente', 'Publicar agente',
        'Publica o rascunho atual do agente: a partir daí ELE responde os clientes reais. Sensível: vira pedido de aprovação no KHUB.',
        { agentId: uuid('id do agente'), notas: z.string().max(500).optional().describe('O que mudou nesta versão') }, 'sensivel',
        () => 'PUBLICAR o rascunho do agente (passa a atender clientes reais)',
        (a, ctx) => { ator(ctx); return this.versoes.publicar(ctx.tenantId, { identityId: ctx.identityId }, a.agentId, { notas: a.notas, origem: 'publicacao' }); }),
      p('mudar_status_agente', 'Ativar ou pausar agente',
        'Ativa ou pausa um agente (pausado = não responde ninguém). Sensível: vira pedido de aprovação no KHUB.',
        { agentId: uuid('id do agente'), status: z.enum(['ativo', 'pausado']) }, 'sensivel',
        (a) => `${a.status === 'ativo' ? 'ATIVAR' : 'PAUSAR'} um agente de atendimento`,
        (a, ctx) => this.agentes.mudarStatus(ctx.tenantId, ator(ctx), a.agentId, a.status)),
      p('configurar_canais_agente', 'Canais e padrão do agente',
        'Define em quais canais o agente atende e se ele é o PADRÃO (o padrão assume toda conversa nova do canal). Sensível: vira pedido de aprovação no KHUB.',
        {
          agentId: uuid('id do agente'),
          canais: z.array(z.enum(CANAIS)).max(10).optional().describe('Canais em que o agente atende'),
          padrao: z.boolean().optional(),
        }, 'sensivel', (a) => `mudar canais/padrão de um agente${a.padrao === true ? ' (tornar PADRÃO)' : ''}`,
        (a, ctx) => this.agentes.atualizar(ctx.tenantId, ator(ctx), a.agentId, { canais: a.canais, padrao: a.padrao })),

      // ------------------------------ automações
      p('ver_automacao', 'Ver automação',
        'Grafo completo de uma automação (gatilho, nós com configuração, ligações), versão ativa, se há rascunho e as regras de janela/reentrada.',
        { workflowId: uuid('id da automação (de listar_automacoes)') }, 'leitura', () => 'abrir a automação',
        (a, ctx) => this.workflows.obter(ctx.tenantId, a.workflowId)),
      p('execucoes_automacao', 'Execuções da automação',
        'Últimas execuções de uma automação (status, nó atual, erro). Com runId, devolve o passo a passo de uma execução.',
        { workflowId: uuid('id da automação'), runId: z.string().uuid().optional(), limite: z.number().int().min(1).max(100).default(20) }, 'leitura',
        () => 'ler execuções da automação',
        (a, ctx) => (a.runId ? this.runs.detalheRun(ctx.tenantId, a.runId) : this.runs.listarRuns(ctx.tenantId, a.workflowId, a.limite))),
      p('tipos_de_no_automacao', 'Tipos de nó de automação',
        'Catálogo dos gatilhos e ações disponíveis no construtor de automações (tipo, grupo, nome, descrição). Use antes de montar ou editar um grafo.',
        {}, 'leitura', () => 'ler o catálogo de nós',
        async () => CATALOGO_NOS),
      p('testar_automacao', 'Testar automação',
        'Roda a automação (o rascunho, se houver) em MODO TESTE com os dados de um contato: mensagens vão SÓ para o número de teste configurado no servidor; CRM, webhooks e e-mail são simulados. Não afeta a operação.',
        { workflowId: uuid('id da automação'), contactId: uuid('contato cujos dados alimentam o teste (de buscar_contatos)') }, 'escrita',
        () => 'testar a automação no número de teste',
        (a, ctx) => this.workflows.testar(ctx.tenantId, a.workflowId, a.contactId), true),
      p('salvar_rascunho_automacao', 'Salvar rascunho da automação',
        'Grava um novo grafo como RASCUNHO da automação (validado: tipos de nó, configs e ligações). A versão ativa continua rodando até publicar_automacao ser aprovado. Mande o grafo inteiro no formato de ver_automacao.grafo.',
        { workflowId: uuid('id da automação'), grafo: z.record(z.unknown()).describe('{ nos: [...], arestas: [...] } completo') }, 'escrita',
        () => 'salvar rascunho da automação',
        (a, ctx) => { ator(ctx); return this.workflows.salvarRascunho(ctx.tenantId, a.workflowId, a.grafo); }),
      p('publicar_automacao', 'Publicar automação',
        'Publica o rascunho da automação: passa a valer para os contatos reais. Sensível: vira pedido de aprovação no KHUB.',
        { workflowId: uuid('id da automação') }, 'sensivel', () => 'PUBLICAR o rascunho de uma automação (passa a valer para contatos reais)',
        (a, ctx) => { ator(ctx); return this.workflows.publicar(ctx.tenantId, a.workflowId, ctx.identityId); }),
    ];
  }

  private semModo<T extends { config?: Record<string, unknown> }>(a: T): T {
    if (!a.config) return a;
    const { modo: _modo, ...resto } = a.config;
    return { ...a, config: resto };
  }

  // ---------------------------------------------------------------- leituras compostas

  private async visaoGeral(tenantId: string) {
    const desde48h = new Date(Date.now() - 48 * 3600_000);
    const desde24h = new Date(Date.now() - 24 * 3600_000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [tenant, agentes, automacoes, canais, integracoes, conversas, runs, pendentes] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, nicho: true, subespecialidade: true, plano: true, status: true } }),
        tx.agent.findMany({ where: { status: { not: 'arquivado' } }, select: { id: true, nome: true, status: true, padrao: true, canais: true, modelo: true, versaoPublicadaId: true } }),
        tx.workflow.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.channelConnection.findMany({ select: { rede: true, nome: true, status: true, erro: true, ultimaSyncAt: true } }),
        tx.integration.findMany({ select: { provider: true, status: true, health: true, erro: true, lastSyncAt: true } }),
        tx.conversation.groupBy({ by: ['canal', 'atendimento', 'status'], where: { updatedAt: { gte: desde48h } }, _count: { _all: true } }),
        tx.agentRun.groupBy({ by: ['status'], where: { createdAt: { gte: desde24h } }, _count: { _all: true } }),
        tx.nyroAction.count({ where: { status: 'pendente', expiraEm: { gt: new Date() } } }),
      ]);
      return {
        empresa: tenant,
        agentes: agentes.map(({ versaoPublicadaId, ...a }) => ({ ...a, publicado: !!versaoPublicadaId })),
        automacoesPorStatus: Object.fromEntries(automacoes.map((x) => [x.status, x._count._all])),
        canais,
        integracoes,
        conversas48h: conversas.map((c) => ({ canal: c.canal, atendimento: c.atendimento, status: c.status, total: c._count._all })),
        execucoesAgente24h: Object.fromEntries(runs.map((r) => [r.status, r._count._all])),
        aprovacoesPendentes: pendentes,
      };
    });
  }

  private async configuracoes(tenantId: string) {
    const [empresa, membros] = await Promise.all([this.settings.business(tenantId), this.settings.members(tenantId)]);
    const [canais, integracoes] = await this.prisma.withTenant(tenantId, (tx) => Promise.all([
      tx.channelConnection.findMany({ select: { rede: true, nome: true, status: true, erro: true, ultimaSyncAt: true } }),
      tx.integration.findMany({ select: { provider: true, status: true, health: true, erro: true, lastSyncAt: true, connectedAt: true } }),
    ]));
    return {
      empresa,
      membros: (membros.members as { email: string; nome: string | null; role: string; modulos: string[] | null }[]).map((m) => ({ email: m.email, nome: m.nome, papel: m.role, modulos: m.modulos })),
      canais,
      integracoes,
    };
  }
}
