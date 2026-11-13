import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicProvider, MODELO_AGENTE, MODELO_ROTEADOR, type MensagemLLM } from '../ai/anthropic.provider';
import { AGENTES, PROMPT_ROTEADOR, toolsDoAgente, type Agente } from './agentes';
import { TOOLS_POR_NOME, paraAnthropic } from './tools';
import { ToolExecutorService, type ContextoNyro } from './tool-executor.service';
import { instrucaoDoNicho, validarResposta } from './guardrails';
import { comporMensagemComAnexos, lerAnexos, type AnexoEntrada } from './anexos';

/** Passo da resposta, como a UI mostra ("Analisando histórico…"). */
export interface PassoNyro {
  tipo: 'roteou' | 'tool' | 'aprovacao' | 'texto' | 'erro';
  rotulo: string;
  detalhe?: string;
}
export interface RespostaNyro {
  conversationId: string;
  agente: Agente;
  passos: PassoNyro[];
  texto: string;
  fontes: { chunkId: string; titulo: string; escopo: string }[];
  aprovacoes: { id: string; tool: string; resumo: string }[];
  guardrail?: string;
}

/** Teto de idas ao modelo por turno: sem isto, tool em loop vira conta infinita. */
const MAX_VOLTAS = 8;

/**
 * Provedor/modelos da NICO (ADR-0044). Com NICO_PROVEDOR=anthropic ela usa o
 * Claude mesmo que os agentes de WhatsApp estejam no Ollama (AI_PROVIDER):
 * analista interna precisa de raciocínio forte e rapidez. Padrão: segue o
 * provedor geral (decisão de custo do dono da conta).
 */
const provedorNico = (): 'anthropic' | 'padrao' => (process.env.NICO_PROVEDOR === 'anthropic' ? 'anthropic' : 'padrao');
const modeloNico = () => (provedorNico() === 'anthropic' ? process.env.NICO_MODELO || 'claude-opus-5-5' : MODELO_AGENTE);
const modeloRoteador = () => (provedorNico() === 'anthropic' ? process.env.NICO_MODELO_ROTEADOR || 'claude-haiku-5-5' : MODELO_ROTEADOR);

/**
 * Roteamento sem modelo quando a intenção é óbvia: economiza uma ida ao modelo
 * (no Ollama local, segundos). Só cai no roteador LLM quando ambíguo.
 */
export function rotaPorPalavras(texto: string): Agente | null {
  const t = texto.toLowerCase();
  if (/prompt/.test(t) && !/campanh|an[uú]ncio/.test(t)) return 'configuracao';
  if (/campanh|an[uú]ncio|tr[aá]fego|\bcpl\b|\broas\b|\bctr\b|\bcpc\b|\bcpm\b|biblioteca de an|benchmark|concorrent|relat[oó]rio|rotina|toda (segunda|ter[cç]a|quarta|quinta|sexta|semana|manh[aã])|conte[uú]do|post|reels|criativo|copy|roteiro|legenda|gancho|\bvsl\b|e-?mail marketing|landing|p[aá]gina de venda|slogan|lan[cç]amento|\bseo\b|calend[aá]rio editorial|estrat[eé]gia|receita|faturamento|ticket|ltv|\bcac\b|margem|funil|convers[aã]o|financeir|cobran[cç]|inadimpl|caixa|lucro|pagamento|vencid|verba|or[cç]amento de an/.test(t)) return 'growth';
  if (/onde (fica|est[aá]|acho)|como (eu )?(fa[cç]o|configuro|conecto)|engenharia de prompt|prompt|agente|automa[cç]|fluxo|workflow|erro na|n[aã]o (est[aá] )?funciona|configur|cri(e|ar) (um|uma|o|a) (funil|etapa)|instal/.test(t)) return 'configuracao';
  return null;
}

/**
 * Orquestrador da Nyro (PRD §5.1 · ADR-0014).
 *
 * Fluxo: roteador (Haiku, barato) escolhe o sub-agente → o agente recebe SÓ as
 * tools do papel dele → tools sensíveis viram pedido de aprovação em vez de
 * executar → a resposta passa pelo guardrail (camada 2) antes de sair.
 *
 * Gating (Brief §2): sem `ANTHROPIC_API_KEY` nada aqui roda — a rota devolve
 * 501 `config_required`. Nunca resposta simulada.
 */
@Injectable()
export class NyroService {
  private readonly log = new Logger('Nyro');

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AnthropicProvider,
    private readonly tools: ToolExecutorService,
  ) {}

  configurada(): boolean {
    return this.llm.configured();
  }
  missing(): string[] {
    return this.llm.missing();
  }

  async conversar(ctxBase: { tenantId: string; identityId: string }, texto: string, conversationId?: string, anexosBrutos?: AnexoEntrada[]): Promise<RespostaNyro> {
    this.llm.exigirCredencial(); // 501 config_required se faltar a chave
    // lê os arquivos ANTES de criar conversa: anexo inválido não deixa conversa órfã
    const anexos = await lerAnexos(anexosBrutos);
    const mensagemUsuario = comporMensagemComAnexos(texto, anexos);

    const ctx = await this.montarContexto(ctxBase);
    const conv = conversationId
      ? await this.carregarConversa(ctx.tenantId, conversationId)
      : await this.criarConversa(ctx, texto);

    await this.gravarMensagem(ctx.tenantId, conv.id, 'user', mensagemUsuario);

    const passos: PassoNyro[] = [];
    const agente = await this.rotear(ctx, texto, passos);
    const historico = await this.historico(ctx.tenantId, conv.id);
    const memoria = await this.memoria(ctx.tenantId);

    const resultado = await this.rodarAgente(ctx, agente, historico, memoria, conv.id, passos);

    // Guardrail camada 2: a resposta é checada ANTES de chegar ao usuário
    const veredito = validarResposta(resultado.texto, ctx.nicho);
    let textoFinal = resultado.texto;
    let guardrail: string | undefined;
    if (!veredito.ok) {
      textoFinal = veredito.substituto!;
      guardrail = veredito.motivo;
      passos.push({ tipo: 'erro', rotulo: 'Resposta ajustada por compliance', detalhe: veredito.motivo });
      await this.registrarGuardrail(ctx, veredito.regra!, resultado.texto);
      this.log.warn(`guardrail ${veredito.regra} barrou uma resposta (tenant ${ctx.tenantId})`);
    }

    await this.gravarMensagem(ctx.tenantId, conv.id, 'assistant', textoFinal, {
      agente,
      tools: resultado.toolsUsadas,
      fontes: resultado.fontes,
      guardrail: veredito.ok ? null : veredito.regra,
    });
    passos.push({ tipo: 'texto', rotulo: 'Pronto' });

    return {
      conversationId: conv.id,
      agente,
      passos,
      texto: textoFinal,
      fontes: resultado.fontes,
      aprovacoes: resultado.aprovacoes,
      guardrail,
    };
  }

  /** Roteador: Haiku, uma palavra. Falhou? cai em `conversas` (o mais genérico). */
  private async rotear(ctx: ContextoNyro, texto: string, passos: PassoNyro[]): Promise<Agente> {
    const direto = rotaPorPalavras(texto);
    if (direto) {
      passos.push({ tipo: 'roteou', rotulo: `${AGENTES[direto].nome} assumiu`, detalhe: AGENTES[direto].quando });
      return direto;
    }
    const t0 = Date.now();
    try {
      const r = await this.llm.conversar({
        modelo: modeloRoteador(),
        provedor: provedorNico(),
        system: PROMPT_ROTEADOR,
        mensagens: [{ role: 'user', content: texto }],
        maxTokens: 10,
        temperatura: 0,
        effort: 'low',
      });
      await this.registrarUso(ctx.tenantId, null, 'roteador', r, Date.now() - t0);
      const escolha = r.texto.trim().toLowerCase().replace(/[^a-z]/g, '') as Agente;
      const valido = (['configuracao', 'conversas', 'growth', 'consultoria'] as Agente[]).includes(escolha) ? escolha : 'conversas';
      passos.push({ tipo: 'roteou', rotulo: `${AGENTES[valido].nome} assumiu`, detalhe: AGENTES[valido].quando });
      return valido;
    } catch (e) {
      this.log.warn(`roteador falhou (${(e as Error).message}) — usando o agente de conversas`);
      passos.push({ tipo: 'roteou', rotulo: 'Atendente assumiu' });
      return 'conversas';
    }
  }

  private async rodarAgente(
    ctx: ContextoNyro,
    agente: Agente,
    historico: MensagemLLM[],
    memoria: string,
    conversationId: string,
    passos: PassoNyro[],
  ) {
    const def = AGENTES[agente];
    const tools = paraAnthropic(toolsDoAgente(agente));
    const system = [def.prompt, memoria, instrucaoDoNicho(ctx.nicho)].filter(Boolean).join('\n\n');

    const mensagens: MensagemLLM[] = [...historico];
    const toolsUsadas: { nome: string; args: unknown }[] = [];
    const fontes: { chunkId: string; titulo: string; escopo: string }[] = [];
    const aprovacoes: { id: string; tool: string; resumo: string }[] = [];
    let texto = '';

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const t0 = Date.now();
      const r = await this.llm.conversar({ modelo: modeloNico(), provedor: provedorNico(), system, mensagens, tools, effort: 'medium', maxTokens: 16000, fallbackRecusa: true, timeoutMs: 120_000 });
      await this.registrarUso(ctx.tenantId, conversationId, agente, r, Date.now() - t0);
      if (r.texto) texto = r.texto;

      if (!r.toolCalls.length) break;

      // o turno do assistente com as tool_use precisa entrar no histórico
      mensagens.push({
        role: 'assistant',
        content: [
          ...(r.texto ? [{ type: 'text', text: r.texto }] : []),
          ...r.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.nome, input: c.args })),
        ],
      });

      const resultados: unknown[] = [];
      for (const chamada of r.toolCalls) {
        const meta = TOOLS_POR_NOME.get(chamada.nome);
        toolsUsadas.push({ nome: chamada.nome, args: chamada.args });

        // Human-in-the-loop: sensível NÃO executa — vira pedido de aprovação.
        if (meta?.sensibilidade === 'sensivel') {
          const pedido = await this.pedirAprovacao(ctx, conversationId, chamada.nome, chamada.args, meta);
          aprovacoes.push(pedido);
          passos.push({ tipo: 'aprovacao', rotulo: 'Precisa da sua confirmação', detalhe: pedido.resumo });
          resultados.push({
            type: 'tool_result',
            tool_use_id: chamada.id,
            content: JSON.stringify({ pendente: true, aviso: 'Ação enviada para aprovação do usuário. NÃO diga que foi feita: diga que está aguardando confirmação.' }),
          });
          continue;
        }

        passos.push({ tipo: 'tool', rotulo: meta?.resumir(chamada.args as never) ?? chamada.nome });
        const res = await this.tools.executar(chamada.nome, chamada.args, ctx);
        if (res.fontes?.length) fontes.push(...res.fontes);
        resultados.push({
          type: 'tool_result',
          tool_use_id: chamada.id,
          is_error: !res.ok,
          content: JSON.stringify(res.ok ? res.dados ?? { ok: true } : { erro: res.erro }),
        });
      }
      mensagens.push({ role: 'user', content: resultados });
    }

    return { texto: texto || 'Não consegui formular uma resposta agora.', toolsUsadas, fontes, aprovacoes };
  }

  // ------------------------------------------------------------ aprovações

  private async pedirAprovacao(ctx: ContextoNyro, conversationId: string, tool: string, args: Record<string, unknown>, meta: { resumir: (a: never) => string }) {
    const resumo = meta.resumir(args as never);
    const a = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.nyroAction.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId,
          tool,
          argumentos: args as Prisma.InputJsonValue,
          resumo,
          expiraEm: new Date(Date.now() + 24 * 3600_000),
        },
        select: { id: true },
      }),
    );
    return { id: a.id, tool, resumo };
  }

  /** Aprovação humana: só aqui a ação sensível acontece de fato. */
  async decidirAcao(ctxBase: { tenantId: string; identityId: string }, actionId: string, aprovar: boolean) {
    const ctx = await this.montarContexto(ctxBase);
    const acao = await this.prisma.withTenant(ctx.tenantId, (tx) => tx.nyroAction.findUnique({ where: { id: actionId } }));
    if (!acao) throw new NotFoundException('ação inexistente');
    if (acao.status !== 'pendente') throw new BadRequestException(`ação já ${acao.status}`);
    if (acao.expiraEm < new Date()) throw new BadRequestException('ação expirada — peça de novo para a Nyro');

    if (!aprovar) {
      await this.atualizarAcao(ctx.tenantId, actionId, { status: 'recusada', decididoPor: ctx.identityId, decididoEm: new Date() });
      return { ok: true, status: 'recusada' };
    }

    const r = await this.tools.executar(acao.tool, acao.argumentos as Record<string, unknown>, ctx);
    await this.atualizarAcao(ctx.tenantId, actionId, {
      status: r.ok ? 'executada' : 'falhou',
      resultado: (r.dados ?? {}) as Prisma.InputJsonValue,
      erro: r.erro ?? null,
      decididoPor: ctx.identityId,
      decididoEm: new Date(),
    });
    return { ok: r.ok, status: r.ok ? 'executada' : 'falhou', erro: r.erro };
  }

  private atualizarAcao(tenantId: string, id: string, data: Prisma.NyroActionUpdateInput) {
    return this.prisma.withTenant(tenantId, (tx) => tx.nyroAction.update({ where: { id }, data }));
  }

  async pendentes(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroAction.findMany({ where: { status: 'pendente' }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, tool: true, resumo: true, createdAt: true } }),
    );
  }

  // ------------------------------------------------------------ conversas

  async listarConversas(tenantId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroConversation.findMany({ where: { identityId }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, titulo: true, updatedAt: true } }),
    );
  }

  async verConversa(tenantId: string, id: string) {
    const c = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroConversation.findUnique({ where: { id }, include: { mensagens: { orderBy: { createdAt: 'asc' } }, acoes: { where: { status: 'pendente' } } } }),
    );
    if (!c) throw new NotFoundException('conversa inexistente');
    return {
      id: c.id,
      titulo: c.titulo,
      mensagens: c.mensagens.map((m) => ({ id: m.id, papel: m.papel, conteudo: m.conteudo, agente: m.agente, fontes: m.fontes, guardrail: m.guardrail, createdAt: m.createdAt })),
      aprovacoes: c.acoes.map((a) => ({ id: a.id, tool: a.tool, resumo: a.resumo })),
    };
  }

  /** Consumo de IA do tenant (o Sprint C liga isso a crédito por plano). */
  async uso(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const linhas = await tx.aiUsageEvent.groupBy({
        by: ['agente'],
        _sum: { tokensEntrada: true, tokensSaida: true, custoUsd: true },
        _count: { _all: true },
      });
      return linhas.map((l) => ({
        agente: l.agente,
        chamadas: l._count._all,
        tokensEntrada: l._sum.tokensEntrada ?? 0,
        tokensSaida: l._sum.tokensSaida ?? 0,
        custoUsd: Number(l._sum.custoUsd ?? 0),
      }));
    });
  }

  // ------------------------------------------------------------ internos

  private async montarContexto(base: { tenantId: string; identityId: string }): Promise<ContextoNyro> {
    const t = await this.prisma.withTenant(base.tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: base.tenantId }, select: { nicho: true, subespecialidade: true } }),
    );
    return { ...base, nicho: t?.nicho ?? null, subespecialidade: t?.subespecialidade ?? null };
  }

  private async criarConversa(ctx: ContextoNyro, primeiraMensagem: string) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.nyroConversation.create({
        data: { tenantId: ctx.tenantId, identityId: ctx.identityId, titulo: primeiraMensagem.slice(0, 80) },
        select: { id: true },
      }),
    );
  }

  private async carregarConversa(tenantId: string, id: string) {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.nyroConversation.findUnique({ where: { id }, select: { id: true } }));
    if (!c) throw new NotFoundException('conversa inexistente');
    return c;
  }

  /** Memória nível 1: as últimas mensagens da conversa. */
  private async historico(tenantId: string, conversationId: string): Promise<MensagemLLM[]> {
    const msgs = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroMessage.findMany({
        where: { conversationId, papel: { in: ['user', 'assistant'] } },
        orderBy: { createdAt: 'desc' },
        take: 20, // janela: conversa longa vira custo, e o essencial vira memória
        select: { papel: true, conteudo: true },
      }),
    );
    return msgs.reverse().map((m) => ({ role: m.papel as 'user' | 'assistant', content: m.conteudo }));
  }

  /** Memória nível 2: fatos da conta. (Nível 3 é o RAG, via tool.) */
  private async memoria(tenantId: string): Promise<string> {
    const fatos = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroMemory.findMany({ orderBy: { updatedAt: 'desc' }, take: 30, select: { chave: true, valor: true } }),
    );
    if (!fatos.length) return '';
    return `O QUE VOCÊ JÁ SABE DESTA CONTA (memória):\n${fatos.map((f) => `- ${f.chave}: ${f.valor}`).join('\n')}`;
  }

  private async gravarMensagem(
    tenantId: string,
    conversationId: string,
    papel: 'user' | 'assistant' | 'tool',
    conteudo: string,
    extra: { agente?: string; tools?: unknown[]; fontes?: unknown[]; guardrail?: string | null } = {},
  ) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.nyroMessage.create({
        data: {
          tenantId, conversationId, papel, conteudo,
          agente: extra.agente ?? null,
          tools: (extra.tools ?? []) as Prisma.InputJsonValue,
          fontes: (extra.fontes ?? []) as Prisma.InputJsonValue,
          guardrail: extra.guardrail ?? null,
        },
      });
      await tx.nyroConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    }, { timeout: 20_000 }); // máquina carregada: 5 s padrão estourava numa simples inserção
  }

  private async registrarGuardrail(ctx: ContextoNyro, regra: string, trecho: string) {
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.nyroGuardrailHit.create({ data: { tenantId: ctx.tenantId, nicho: ctx.nicho, regra, trecho: trecho.slice(0, 2000), acao: 'reescrito' } }),
    ).catch((e: Error) => this.log.warn(`falha ao registrar guardrail: ${e.message}`));
  }

  /** Custo por tenant. Falhar aqui não pode derrubar a resposta ao usuário. */
  private async registrarUso(tenantId: string, conversationId: string | null, agente: string, r: { modelo: string; uso: { entrada: number; saida: number; cache: number; custoUsd: number } }, ms: number) {
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.aiUsageEvent.create({
          data: {
            tenantId, conversationId, agente, modelo: r.modelo,
            tokensEntrada: r.uso.entrada, tokensSaida: r.uso.saida, tokensCache: r.uso.cache,
            custoUsd: new Prisma.Decimal(r.uso.custoUsd.toFixed(6)),
            latenciaMs: ms,
          },
        }),
      );
    } catch (e) {
      this.log.warn(`falha ao registrar uso de IA: ${(e as Error).message}`);
    }
  }
}
