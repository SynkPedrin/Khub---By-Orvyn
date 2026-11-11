import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { BlueprintService } from '../blueprints/blueprint.service';
import { MessagesService } from '../crm/messaging/messages.service';
import { TasksService } from '../crm/tasks.service';
import { NotesService } from '../crm/notes.service';
import { WorkflowsService } from '../automations/workflows.service';
import { RetrievalService } from '../rag/retrieval.service';
import { TOOLS_POR_NOME } from './tools';
import { NicoAnalisesService } from './analises.service';

export interface ContextoNyro {
  tenantId: string;
  identityId: string;
  nicho: string | null;
  subespecialidade: string | null;
  /** Execução por rotina agendada (sem humano na conversa). */
  origem?: 'chat' | 'agendamento';
  agendamentoId?: string | null;
}

export interface ResultadoTool {
  ok: boolean;
  dados?: unknown;
  erro?: string;
  /** Chunks citados, quando a tool leu o RAG (rastreabilidade — invariante 2). */
  fontes?: { chunkId: string; titulo: string; escopo: string }[];
}

/**
 * Executa as tools da Nyro (ADR-0014).
 *
 * Invariante do CLAUDE.md — *"Nyro é usuário, não deus"*: toda tool vira chamada
 * de **serviço do CRM**, com a mesma validação, RLS e auditoria de um humano.
 * Nenhum `INSERT` direto aqui. O `actor:'nyro'` no audit_log é o que permite
 * responder depois "quem fez isso?".
 */
@Injectable()
export class ToolExecutorService {
  private readonly log = new Logger('Nyro');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly mensagens: MessagesService,
    private readonly tarefas: TasksService,
    private readonly notas: NotesService,
    private readonly workflows: WorkflowsService,
    private readonly rag: RetrievalService,
    private readonly marketplace: MarketplaceService,
    private readonly blueprints: BlueprintService,
    private readonly analises: NicoAnalisesService,
  ) {}

  async executar(nome: string, argsBrutos: Record<string, unknown>, ctx: ContextoNyro): Promise<ResultadoTool> {
    const tool = TOOLS_POR_NOME.get(nome);
    // modelo alucinou nome de tool: recusa em vez de tentar adivinhar
    if (!tool) return { ok: false, erro: `tool desconhecida: ${nome}` };

    const parsed = tool.schema.safeParse(argsBrutos);
    if (!parsed.success) {
      return { ok: false, erro: `argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
    }
    const args = parsed.data as Record<string, never>;

    try {
      const dados = await this.despachar(nome, args, ctx);
      await this.auditar(ctx, nome, args);
      return typeof dados === 'object' && dados !== null && 'fontes' in (dados as object)
        ? { ok: true, ...(dados as object) }
        : { ok: true, dados };
    } catch (e) {
      const erro = (e as Error).message;
      this.log.warn(`tool ${nome} falhou: ${erro}`);
      return { ok: false, erro };
    }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private async despachar(nome: string, a: any, ctx: ContextoNyro): Promise<unknown> {
    switch (nome) {
      // ---------------- leitura ----------------
      case 'buscar_conhecimento': {
        const hits = await this.rag.search(
          { tenantId: ctx.tenantId, nicho: ctx.nicho ?? 'geral', subespecialidade: ctx.subespecialidade },
          a.pergunta,
        );
        // Invariante 2 (grounding): sem chunk, a Nyro declara lacuna — quem
        // decide isso é o prompt, mas a tool precisa dizer a verdade aqui.
        return {
          dados: hits.length
            ? hits.map((h) => ({ id: h.chunkId, titulo: h.titulo, trecho: h.conteudo.slice(0, 1200), escopo: h.escopo }))
            : { vazio: true, aviso: 'Nada na base de conhecimento responde isso. Declare a lacuna; não use conhecimento próprio para nicho, preço, prazo ou protocolo.' },
          fontes: hits.map((h) => ({ chunkId: h.chunkId, titulo: h.titulo, escopo: h.escopo })),
        };
      }
      case 'resumo_do_funil':
        return this.crm.overview(ctx.tenantId);
      case 'buscar_contatos':
        return this.crm.search(ctx.tenantId, a.termo);
      case 'ver_contato':
        return this.crm.getContact(ctx.tenantId, a.contactId);
      case 'listar_automacoes':
        return this.workflows.listar(ctx.tenantId);

      // ---------------- escrita ----------------
      case 'criar_contato':
        return this.crm.createContact(ctx.tenantId, { ...a, origem: 'Nyro' });
      case 'atualizar_contato': {
        const patch = a.campo === 'valorEstimado' ? { valorEstimado: Number(a.valor) || 0 } : { [a.campo]: a.valor };
        return this.crm.updateContact(ctx.tenantId, a.contactId, patch);
      }
      case 'criar_tarefa':
        return this.tarefas.create(ctx.tenantId, ctx.identityId, {
          titulo: a.titulo,
          contactId: a.contactId,
          prioridade: a.prioridade,
          dueAt: a.emDias > 0 ? new Date(Date.now() + a.emDias * 86_400_000).toISOString() : undefined,
        });
      case 'adicionar_nota':
        return this.notas.create(ctx.tenantId, ctx.identityId, { corpo: a.corpo, contactId: a.contactId });
      case 'criar_oportunidade':
        return this.crm.createDeal(ctx.tenantId, { titulo: a.titulo, contactId: a.contactId, stageId: a.stageId, valor: a.valor ?? 0, origem: 'Nyro' });
      case 'lembrar':
        return this.lembrar(ctx.tenantId, a.chave, a.valor);

      // ---------------- sensível (só chega aqui DEPOIS de aprovado) ----------------
      case 'enviar_mensagem':
        return this.enviarMensagem(ctx.tenantId, a.contactId, a.texto);
      case 'mover_etapa':
        return this.crm.moveDeal(ctx.tenantId, a.dealId, a.stageId);
      // ---------------- configuração (a Nyro monta o CRM) ----------------
      case 'criar_funil':
        return this.crm.createPipeline(ctx.tenantId, { nome: a.nome, etapas: a.etapas });
      case 'criar_etapa':
        return this.crm.createStage(ctx.tenantId, { pipelineId: a.pipelineId, nome: a.nome, cor: a.cor });
      case 'instalar_automacao': {
        const achados = await this.marketplace.listar(ctx.tenantId, { q: a.busca });
        if (!achados.length) return { instalado: false, motivo: 'nenhum template do marketplace bate com essa descrição' };
        const r = await this.marketplace.instalar(ctx.tenantId, ctx.identityId, achados[0].id);
        return { instalado: true, workflowId: r.workflowId, template: r.nome };
      }
      case 'aplicar_blueprint':
        return this.blueprints.aplicar(ctx.tenantId, ctx.identityId, a.blueprint);
      case 'mudar_status_automacao':
        return this.workflows.mudarStatus(ctx.tenantId, a.workflowId, a.status, ctx.identityId);

      // ---------------- marketing e operação (ADR-0044) ----------------
      case 'analisar_campanhas':
        return this.analises.analisarCampanhas(ctx.tenantId, a.dias);
      case 'benchmark_biblioteca_anuncios':
        return this.analises.benchmarkBiblioteca(a.termos, a.pais);
      case 'analisar_prompt_agentes':
        return this.analises.analisarPromptAgentes(ctx.tenantId, a.agentId);
      case 'diagnosticar_automacoes':
        return this.analises.diagnosticarAutomacoes(ctx.tenantId, a.workflowId);
      case 'gerar_relatorio':
        return this.analises.gerarRelatorio(ctx.tenantId, ctx.identityId, { titulo: a.titulo, tipo: a.tipo, conteudoMd: a.conteudoMd, origem: ctx.origem ?? 'chat', agendamentoId: ctx.agendamentoId ?? null });
      case 'agendar_rotina':
        return this.analises.agendar(ctx.tenantId, ctx.identityId, a);
      case 'listar_rotinas':
        return this.analises.listarAgendamentos(ctx.tenantId);
      case 'pausar_rotina':
        return this.analises.cancelarAgendamento(ctx.tenantId, a.id);

      default:
        throw new Error(`tool sem implementação: ${nome}`);
    }
  }

  /** Memória nível 2 (conta): fato que a Nyro reusa em toda conversa futura. */
  private async lembrar(tenantId: string, chave: string, valor: string) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroMemory.upsert({
        where: { tenantId_chave: { tenantId, chave } },
        create: { tenantId, chave, valor, origem: 'nyro' },
        update: { valor, updatedAt: new Date() },
      }),
    );
    return { lembrado: { chave, valor } };
  }

  private async enviarMensagem(tenantId: string, contactId: string, texto: string) {
    const conversationId = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, nome: true } });
      if (!c) throw new Error('contato inexistente');
      const existente = await tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, select: { id: true } });
      if (existente) return existente.id;
      const nova = await tx.conversation.create({ data: { tenantId, contactId, nome: c.nome, canal: 'WhatsApp' }, select: { id: true } });
      return nova.id;
    });
    // passa pelo MessagesService: gating do STEVO, auditoria e socket vêm de graça
    return this.mensagens.send(tenantId, conversationId, texto);
  }

  /** `actor:'nyro'` — sem isto, não dá para separar o que a IA fez do que o humano fez. */
  private async auditar(ctx: ContextoNyro, tool: string, args: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.withTenant(ctx.tenantId, (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, payload)
          VALUES (${ctx.tenantId}::uuid, 'nyro', ${ctx.identityId}, ${`nyro.${tool}`}, 'tool', ${JSON.stringify(args)}::jsonb)`,
      );
    } catch (e) {
      this.log.warn(`falha ao auditar tool ${tool}: ${(e as Error).message}`);
    }
  }
}
