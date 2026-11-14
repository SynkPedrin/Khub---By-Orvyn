import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicProvider, MODELO_AGENTE, MODELO_ROTEADOR, type MensagemLLM } from '../ai/anthropic.provider';
import { AGENTES, PROMPT_ROTEADOR, toolsDoAgente, type Agente } from './agentes';
import { TOOLS_POR_NOME, paraAnthropic } from './tools';
import { ToolExecutorService, type ContextoNyro } from './tool-executor.service';
import { NicoAnalisesService } from './analises.service';
import { chaveDoNicho, instrucaoDoNicho, validarResposta } from './guardrails';
import { comporMensagemComAnexos, lerAnexos, type AnexoEntrada } from './anexos';

/** Passo da resposta, como a UI mostra ("Analisando histórico…"). */
export interface PassoNyro {
  tipo: 'roteou' | 'tool' | 'aprovacao' | 'texto' | 'erro';
  rotulo: string;
  detalhe?: string;
}
export interface PlanoNyro {
  objetivo: string;
  passos: { texto: string; status: 'pendente' | 'fazendo' | 'feito' }[];
}
/** Eventos do streaming (SSE): o que a UI vê acontecer em tempo real. */
export type EventoNyro =
  | { tipo: 'conversa'; conversationId: string }
  | { tipo: 'passo'; passo: PassoNyro }
  | { tipo: 'plano'; plano: PlanoNyro }
  | { tipo: 'texto'; delta: string }
  | { tipo: 'limpar' }
  | { tipo: 'final'; resposta: RespostaNyro };
export interface OpcoesConversa {
  emitir?: (e: EventoNyro) => void;
  /** Execução por rotina agendada (sem humano na conversa). */
  origem?: 'chat' | 'agendamento';
  agendamentoId?: string | null;
  titulo?: string;
}
export interface RespostaNyro {
  conversationId: string;
  plano?: PlanoNyro;
  /** Relatório salvo durante esta resposta (rotinas usam para notificar). */
  relatorioId?: string;
  /** Nomes das tools chamadas neste turno (o eval da NICO confere isto). */
  ferramentas: string[];
  agente: Agente;
  passos: PassoNyro[];
  texto: string;
  fontes: { chunkId: string; titulo: string; escopo: string }[];
  aprovacoes: { id: string; tool: string; resumo: string }[];
  guardrail?: string;
}

/** Teto de idas ao modelo por turno: sem isto, tool em loop vira conta infinita. */
const MAX_VOLTAS = 8;
const MAX_VOLTAS_UNICO = 16;
/** Resultado de tool grande demais (página da web, lista) estoura o contexto: corta com aviso. */
const MAX_CHARS_RESULTADO_TOOL = 24_000;
const JANELA_HISTORICO = 16;
const JANELA_APOS_RESUMO = 12;
const TETO_FATOS_AUTO = 100;

/**
 * Provedor/modelos da NICO (ADR-0044). Com NICO_PROVEDOR=anthropic ela usa o
 * Claude mesmo que os agentes de WhatsApp estejam no Ollama (AI_PROVIDER):
 * analista interna precisa de raciocínio forte e rapidez. Padrão: segue o
 * provedor geral (decisão de custo do dono da conta).
 */
const provedorNico = (): 'anthropic' | 'padrao' => (process.env.NICO_PROVEDOR === 'anthropic' ? 'anthropic' : 'padrao');
const modeloNico = () => (provedorNico() === 'anthropic' ? process.env.NICO_MODELO || 'claude-opus-5-5' : MODELO_AGENTE);
/**
 * Agente único (todas as tools, sem roteador): o certo para modelos fortes (Claude).
 * Modelo local pequeno (Ollama) se perde com ~40 tools, então segue roteado por padrão.
 * NICO_AGENTE_UNICO=1|0 força.
 */
export const agenteUnico = (): boolean => {
  if (process.env.NICO_AGENTE_UNICO) return process.env.NICO_AGENTE_UNICO !== '0';
  const local = ['ollama', 'openai'].includes((process.env.AI_PROVIDER || '').toLowerCase().trim()) && provedorNico() === 'padrao';
  return !local;
};
const autoaprendizado = () => process.env.NICO_AUTOAPRENDIZADO !== '0';
const modeloRoteador = () => (provedorNico() === 'anthropic' ? process.env.NICO_MODELO_ROTEADOR || 'claude-haiku-5-5' : MODELO_ROTEADOR);

/** Valor que nunca vai para a memória, mesmo que o modelo ache que é "fato". */
const SENSIVEL = /(senha|password|token|api[_\s-]?key|secret|cpf|cnpj|cart[ãa]o|\b\d{11,}\b|bearer|sk-[a-z0-9])/i;

/** Encolhe blocos <anexo> para o início: o resto do arquivo some do contexto (o usuário pode reanexar). */
export function encolherAnexos(texto: string, max: number): string {
  return texto.replace(/<anexo nome="([^"]*)"[^>]*>([\s\S]*?)<\/anexo>/g, (m, nome: string, corpo: string) =>
    corpo.length <= max ? m : `<anexo nome="${nome}" resumido="só o início; reanexe para reler o arquivo todo">\n${corpo.slice(0, max)}\n…\n</anexo>`,
  );
}

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
    private readonly analises: NicoAnalisesService,
  ) {}

  configurada(): boolean {
    return this.llm.configured();
  }
  missing(): string[] {
    return this.llm.missing();
  }
  /** 501 config_required ANTES de abrir um stream (depois dos headers não dá mais para mudar o status). */
  exigirPronta(): void {
    this.llm.exigirCredencial();
  }

  async conversar(
    ctxBase: { tenantId: string; identityId: string },
    texto: string,
    conversationId?: string,
    anexosBrutos?: AnexoEntrada[],
    opcoes: OpcoesConversa = {},
  ): Promise<RespostaNyro> {
    this.llm.exigirCredencial(); // 501 config_required se faltar a chave
    const emitir = opcoes.emitir ?? (() => undefined);
    // lê os arquivos ANTES de criar conversa: anexo inválido não deixa conversa órfã
    const anexos = await lerAnexos(anexosBrutos);
    const mensagemUsuario = comporMensagemComAnexos(texto, anexos);

    const ctx: ContextoNyro = { ...(await this.montarContexto(ctxBase)), origem: opcoes.origem ?? 'chat', agendamentoId: opcoes.agendamentoId ?? null };
    const conv = conversationId
      ? await this.carregarConversa(ctx.tenantId, conversationId)
      : await this.criarConversa(ctx, opcoes.titulo ?? texto);
    emitir({ tipo: 'conversa', conversationId: conv.id });

    await this.gravarMensagem(ctx.tenantId, conv.id, 'user', mensagemUsuario);

    const passos: PassoNyro[] = [];
    const registrar = (p: PassoNyro) => {
      passos.push(p);
      emitir({ tipo: 'passo', passo: p });
    };
    const agente = await this.rotear(ctx, texto, registrar);
    const [historico, memoria] = await Promise.all([this.historico(ctx.tenantId, conv.id), this.memoria(ctx.tenantId, ctx.identityId, conv.id)]);

    // Guardrail camada 2 valida o texto ANTES de chegar ao usuário. Em nicho regulado
    // não dá para mostrar token a token (sairia sem validar): nele o texto vem inteiro no fim.
    const streamTexto = !!opcoes.emitir && !chaveDoNicho(ctx.nicho);
    const resultado = await this.rodarAgente(ctx, agente, historico, memoria, conv.id, registrar, emitir, streamTexto);

    const veredito = validarResposta(resultado.texto, ctx.nicho);
    let textoFinal = resultado.texto;
    let guardrail: string | undefined;
    if (!veredito.ok) {
      // preferimos manter a resposta e trocar só o trecho problemático
      textoFinal = veredito.saneado ?? veredito.substituto!;
      guardrail = veredito.motivo;
      registrar({ tipo: 'erro', rotulo: 'Resposta ajustada por compliance', detalhe: veredito.motivo });
      await this.registrarGuardrail(ctx, veredito.regra!, resultado.texto);
      this.log.warn(`guardrail ${veredito.regra} barrou uma resposta (tenant ${ctx.tenantId})`);
    }

    await this.gravarMensagem(ctx.tenantId, conv.id, 'assistant', textoFinal, {
      agente,
      tools: resultado.toolsUsadas,
      fontes: resultado.fontes,
      guardrail: veredito.ok ? null : veredito.regra,
    });
    registrar({ tipo: 'texto', rotulo: 'Pronto' });

    const resposta: RespostaNyro = {
      conversationId: conv.id,
      agente,
      passos,
      texto: textoFinal,
      fontes: resultado.fontes,
      aprovacoes: resultado.aprovacoes,
      guardrail,
      plano: resultado.plano,
      relatorioId: resultado.relatorioId,
      ferramentas: resultado.toolsUsadas.map((x) => x.nome),
    };
    emitir({ tipo: 'final', resposta });

    // memória e resumo rodam DEPOIS da resposta: nunca seguram o usuário
    if (ctx.origem !== 'agendamento') void this.posTurno(ctx, conv.id, texto, textoFinal);
    return resposta;
  }

  /** Roteador: só no modo roteado (modelo local). No agente único não há roteamento: nada de ida extra ao modelo. */
  private async rotear(ctx: ContextoNyro, texto: string, registrar: (p: PassoNyro) => void): Promise<Agente> {
    if (agenteUnico()) return 'nico';
    const direto = rotaPorPalavras(texto);
    if (direto) {
      registrar({ tipo: 'roteou', rotulo: `${AGENTES[direto].nome} assumiu`, detalhe: AGENTES[direto].quando });
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
      registrar({ tipo: 'roteou', rotulo: `${AGENTES[valido].nome} assumiu`, detalhe: AGENTES[valido].quando });
      return valido;
    } catch (e) {
      this.log.warn(`roteador falhou (${(e as Error).message}) — usando o agente de conversas`);
      registrar({ tipo: 'roteou', rotulo: 'Atendente assumiu' });
      return 'conversas';
    }
  }

  private async rodarAgente(
    ctx: ContextoNyro,
    agente: Agente,
    historico: MensagemLLM[],
    memoria: { fatos: string; resumo: string },
    conversationId: string,
    registrar: (p: PassoNyro) => void,
    emitir: (e: EventoNyro) => void,
    streamTexto: boolean,
  ) {
    const def = AGENTES[agente];
    const tools = paraAnthropic(toolsDoAgente(agente));
    // bloco ESTÁVEL (vai para o cache de prompt) e bloco que muda a cada turno
    const system = [def.prompt, instrucaoDoNicho(ctx.nicho)].filter(Boolean).join('\n\n');
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });
    const systemDinamico = [`AGORA: ${agora} (horário de Brasília). Use isto para "hoje", "esta semana", períodos e prazos.`, memoria.fatos, memoria.resumo].filter(Boolean).join('\n\n');

    const mensagens: MensagemLLM[] = [...historico];
    const toolsUsadas: { nome: string; args: unknown }[] = [];
    const fontes: { chunkId: string; titulo: string; escopo: string }[] = [];
    const aprovacoes: { id: string; tool: string; resumo: string }[] = [];
    let texto = '';
    let plano: PlanoNyro | undefined;
    let relatorioId: string | undefined;
    const maxVoltas = agente === 'nico' ? MAX_VOLTAS_UNICO : MAX_VOLTAS;

    const executar = async (chamada: { id: string; nome: string; args: Record<string, unknown> }, meta: (typeof TOOLS_POR_NOME) extends Map<string, infer T> ? T | undefined : never): Promise<unknown> => {
      // Human-in-the-loop: sensível NÃO executa — vira pedido de aprovação.
      if (meta?.sensibilidade === 'sensivel') {
        const pedido = await this.pedirAprovacao(ctx, conversationId, chamada.nome, chamada.args, meta);
        aprovacoes.push(pedido);
        registrar({ tipo: 'aprovacao', rotulo: 'Precisa da sua confirmação', detalhe: pedido.resumo });
        return {
          type: 'tool_result',
          tool_use_id: chamada.id,
          content: JSON.stringify({ pendente: true, aviso: 'Ação enviada para aprovação do usuário. NÃO diga que foi feita: diga que está aguardando confirmação.' }),
        };
      }
      if (chamada.nome !== 'atualizar_plano') registrar({ tipo: 'tool', rotulo: meta?.resumir(chamada.args as never) ?? chamada.nome });
      const res = await this.tools.executar(chamada.nome, chamada.args, ctx);
      if (res.fontes?.length) fontes.push(...res.fontes);
      if (res.ok && chamada.nome === 'atualizar_plano') {
        plano = { objetivo: String((res.dados as PlanoNyro).objetivo), passos: (res.dados as PlanoNyro).passos };
        emitir({ tipo: 'plano', plano });
      }
      if (res.ok && chamada.nome === 'gerar_relatorio') relatorioId = (res.dados as { id?: string } | undefined)?.id ?? relatorioId;
      let conteudo = JSON.stringify(res.ok ? res.dados ?? { ok: true } : { erro: res.erro });
      if (conteudo.length > MAX_CHARS_RESULTADO_TOOL) conteudo = `${conteudo.slice(0, MAX_CHARS_RESULTADO_TOOL)}…[resultado cortado: peça um recorte menor se precisar do resto]`;
      return { type: 'tool_result', tool_use_id: chamada.id, is_error: !res.ok, content: conteudo };
    };

    for (let volta = 0; volta < maxVoltas; volta++) {
      const t0 = Date.now();
      const r = await this.llm.conversar({
        modelo: modeloNico(), provedor: provedorNico(), system, systemDinamico, mensagens, tools,
        effort: 'medium', maxTokens: 16000, fallbackRecusa: true, timeoutMs: 180_000,
        onTexto: streamTexto ? (delta) => emitir({ tipo: 'texto', delta }) : undefined,
      });
      await this.registrarUso(ctx.tenantId, conversationId, agente, r, Date.now() - t0);
      if (r.texto) texto = r.texto;

      const ultima = volta === maxVoltas - 1;
      if (!r.toolCalls.length || ultima) {
        if (ultima && r.toolCalls.length) this.log.warn(`NICO atingiu ${maxVoltas} voltas com tools pendentes (tenant ${ctx.tenantId})`);
        break;
      }
      // a narração que veio antes das tools ("vou olhar...") sai da bolha; o texto final é o da última volta
      if (streamTexto && r.texto) emitir({ tipo: 'limpar' });

      // o turno do assistente volta INTACTO (inclusive thinking com assinatura)
      mensagens.push({ role: 'assistant', content: r.blocos });

      const execs = r.toolCalls.map((chamada) => ({ chamada, meta: TOOLS_POR_NOME.get(chamada.nome) }));
      for (const e of execs) toolsUsadas.push({ nome: e.chamada.nome, args: e.chamada.args });
      const resultados = new Map<string, unknown>();
      // leituras são independentes: em paralelo. Escritas e aprovações, em ordem.
      const leituras = execs.filter((e) => !e.meta || e.meta.sensibilidade === 'leitura');
      await Promise.all(leituras.map(async (e) => resultados.set(e.chamada.id, await executar(e.chamada, e.meta))));
      for (const e of execs.filter((x) => !leituras.includes(x))) resultados.set(e.chamada.id, await executar(e.chamada, e.meta));

      const conteudo: unknown[] = r.toolCalls.map((c) => resultados.get(c.id));
      // a próxima volta é a última: pede fechamento, para nunca terminar sem resposta
      if (volta === maxVoltas - 2) conteudo.push({ type: 'text', text: '[Sistema: limite de etapas atingido. Não chame mais ferramentas. Entregue agora o melhor resultado com o que já tem e diga o que ficou pendente.]' });
      mensagens.push({ role: 'user', content: conteudo });
    }

    return { texto: texto || 'Não consegui formular uma resposta agora.', toolsUsadas, fontes, aprovacoes, plano, relatorioId };
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
      void this.aprenderDecisao(ctx, acao.tool, acao.resumo, false);
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
    void this.aprenderDecisao(ctx, acao.tool, acao.resumo, true);
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

  /**
   * Memória nível 1: as últimas mensagens. Anexos de mensagens antigas são
   * encolhidos (só o início): senão um PDF de 30 mil caracteres voltaria ao
   * contexto em TODA volta da conversa.
   */
  private async historico(tenantId: string, conversationId: string): Promise<MensagemLLM[]> {
    const msgs = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nyroMessage.findMany({
        where: { conversationId, papel: { in: ['user', 'assistant'] } },
        orderBy: { createdAt: 'desc' },
        take: JANELA_HISTORICO, // janela: o que ficou para trás vira resumo (nível 1b) e fatos (nível 2)
        select: { papel: true, conteudo: true },
      }),
    );
    // a API exige que a conversa comece por mensagem do usuário: a janela pode cortar no meio de um par
    const ordenadas = msgs.reverse();
    while (ordenadas.length > 1 && ordenadas[0].papel !== 'user') ordenadas.shift();
    const ultimaDoUsuario = ordenadas.map((m) => m.papel).lastIndexOf('user');
    return ordenadas.map((m, i) => ({ role: m.papel as 'user' | 'assistant', content: m.papel === 'user' && i !== ultimaDoUsuario ? encolherAnexos(m.conteudo, 1200) : m.conteudo }));
  }

  /**
   * Memória nível 2: fatos da conta (+ preferências de QUEM está falando) e o
   * resumo do começo desta conversa. Ordenada por confiança, depois recência.
   */
  private async memoria(tenantId: string, identityId: string, conversationId: string): Promise<{ fatos: string; resumo: string }> {
    const meu = `pref.${identityId}.`;
    const [fatos, resumo] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.nyroMemory.findMany({
          where: { NOT: { OR: [{ chave: { startsWith: 'resumo.' } }, { AND: [{ chave: { startsWith: 'pref.' } }, { NOT: { chave: { startsWith: meu } } }] }] } },
          orderBy: [{ confianca: 'desc' }, { updatedAt: 'desc' }],
          take: 80,
          select: { chave: true, valor: true, origem: true, confianca: true },
        }),
        tx.nyroMemory.findFirst({ where: { chave: `resumo.${conversationId}` }, select: { valor: true } }),
      ]),
    );
    const daConta = fatos.filter((f) => !f.chave.startsWith('pref.'));
    const minhas = fatos.filter((f) => f.chave.startsWith(meu));
    const linha = (f: { chave: string; valor: string; origem: string; confianca: number }, prefixo = '') =>
      `- ${f.chave.slice(prefixo.length)}: ${f.valor}${f.origem === 'auto' && f.confianca < 0.8 ? ' (provável, não confirmado)' : ''}`;
    const partes: string[] = [];
    if (daConta.length) partes.push(`O QUE VOCÊ JÁ SABE DESTA CONTA (memória; o que está "provável" vale como hipótese, confirme antes de agir):\n${daConta.map((f) => linha(f)).join('\n')}`);
    if (minhas.length) partes.push(`PREFERÊNCIAS DE QUEM ESTÁ FALANDO COM VOCÊ:\n${minhas.map((f) => linha(f, meu)).join('\n')}`);
    return { fatos: partes.join('\n\n'), resumo: resumo ? `RESUMO DO COMEÇO DESTA CONVERSA (as mensagens antigas saíram do contexto):\n${resumo.valor}` : '' };
  }

  // ------------------------------------------------------------ aprendizado

  /** Depois de cada resposta: guarda o que vale lembrar e resume conversa longa. Nunca derruba nem atrasa o chat. */
  private async posTurno(ctx: ContextoNyro, conversationId: string, pergunta: string, resposta: string): Promise<void> {
    try {
      await this.resumirSeLonga(ctx, conversationId);
    } catch (e) {
      this.log.warn(`resumo da conversa falhou: ${(e as Error).message}`);
    }
    if (!autoaprendizado() || pergunta.trim().length < 25) return;
    try {
      await this.aprender(ctx, pergunta, resposta);
    } catch (e) {
      this.log.warn(`autoaprendizado falhou: ${(e as Error).message}`);
    }
  }

  /** Chamada curta e barata (modelo do roteador) para tarefas de bastidor. */
  private async chamarBarato(ctx: ContextoNyro, rotulo: string, system: string, pedido: string, maxTokens: number): Promise<string> {
    const t0 = Date.now();
    const r = await this.llm.conversar({ modelo: modeloRoteador(), provedor: provedorNico(), system, mensagens: [{ role: 'user', content: pedido }], maxTokens, temperatura: 0, effort: 'low', timeoutMs: 60_000 });
    await this.registrarUso(ctx.tenantId, null, rotulo, r, Date.now() - t0);
    return r.texto;
  }

  /** Conversa passou da janela: o que saiu dela vira resumo (preserva decisões, números, pendências). */
  private async resumirSeLonga(ctx: ContextoNyro, conversationId: string): Promise<void> {
    const chave = `resumo.${conversationId}`;
    const [total, atual] = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      Promise.all([
        tx.nyroMessage.count({ where: { conversationId, papel: { in: ['user', 'assistant'] } } }),
        tx.nyroMemory.findFirst({ where: { chave }, select: { valor: true, origem: true } }),
      ]),
    );
    if (total <= JANELA_HISTORICO) return;
    const alvo = total - JANELA_APOS_RESUMO; // tudo antes das últimas 12 já pode estar resumido
    const feitas = Number(atual?.origem.match(/^resumo:(\d+)$/)?.[1] ?? 0);
    if (alvo - feitas < 6) return; // resume em lotes, não a cada turno
    const novas = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.nyroMessage.findMany({ where: { conversationId, papel: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'asc' }, skip: feitas, take: alvo - feitas, select: { papel: true, conteudo: true } }),
    );
    const trecho = novas.map((m) => `${m.papel === 'user' ? 'USUÁRIO' : 'NICO'}: ${encolherAnexos(m.conteudo, 600).slice(0, 2500)}`).join('\n\n');
    const texto = await this.chamarBarato(
      ctx,
      'resumo',
      'Você resume conversas de trabalho entre um usuário e a NICO (IA de marketing) para a NICO continuar de onde parou. Em português, em até 1200 caracteres, em tópicos curtos: objetivo, decisões tomadas, números e fatos citados, o que já foi feito, pendências. Sem enrolação, sem saudação.',
      `${atual?.valor ? `RESUMO ATÉ AGORA:\n${atual.valor}\n\n` : ''}NOVAS MENSAGENS:\n${trecho}\n\nEscreva o resumo ATUALIZADO.`,
      700,
    );
    const valor = texto.trim().slice(0, 1800);
    if (!valor) return;
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.nyroMemory.upsert({
        where: { tenantId_chave: { tenantId: ctx.tenantId, chave } },
        create: { tenantId: ctx.tenantId, chave, valor, origem: `resumo:${alvo}` },
        update: { valor, origem: `resumo:${alvo}`, updatedAt: new Date() },
      }),
    );
  }

  /**
   * Autoaprendizado: extrai FATOS DURÁVEIS do diálogo (meta, preço, público, tom, o que
   * funcionou ou foi recusado). Entram com confiança < 1 e marcados como "provável":
   * o que o usuário confirma ou ensina via `lembrar` (origem 'nyro') nunca é sobrescrito.
   */
  private async aprender(ctx: ContextoNyro, pergunta: string, resposta: string): Promise<void> {
    const saida = await this.chamarBarato(
      ctx,
      'memoria',
      `Você extrai FATOS DURÁVEIS de uma conversa de trabalho para a memória de longo prazo de uma IA de marketing.
Responda SOMENTE um JSON array (pode ser []). Cada item: {"chave": "snake_case_curta", "valor": "frase curta", "escopo": "conta" | "usuario", "confianca": 0 a 1}.
- "conta": fato do negócio (nicho, ticket médio, público, metas, ofertas, tom de voz da marca, canais, concorrentes, o que funcionou/falhou em campanhas).
- "usuario": preferência de COMO a pessoa quer ser atendida (curto/detalhado, formato, tom, o que odeia).
- Só o que o USUÁRIO afirmou ou claramente demonstrou; nunca o que a NICO supôs. Confiança alta só se for explícito.
- NÃO extraia: perguntas pontuais, dados pessoais de leads/clientes, senhas, tokens, chaves, CPF, cartão, números de telefone, tarefas passageiras.
- No máximo 3 itens. Na dúvida, [].`,
      `USUÁRIO: ${pergunta.slice(0, 1500)}\n\nNICO: ${resposta.slice(0, 1500)}`,
      500,
    );
    const ini = saida.indexOf('[');
    const fim = saida.lastIndexOf(']');
    if (ini < 0 || fim < ini) return;
    let bruto: unknown;
    try {
      bruto = JSON.parse(saida.slice(ini, fim + 1));
    } catch {
      return;
    }
    const lista = z.array(z.object({ chave: z.string().min(2).max(60), valor: z.string().min(2).max(300), escopo: z.enum(['conta', 'usuario']), confianca: z.number().min(0).max(1) })).safeParse(bruto);
    if (!lista.success) return;

    for (const f of lista.data.slice(0, 3)) {
      if (f.confianca < 0.55 || SENSIVEL.test(f.valor) || SENSIVEL.test(f.chave)) continue;
      const base = f.chave.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
      if (base.length < 2) continue;
      const chave = f.escopo === 'usuario' ? `pref.${ctx.identityId}.${base}` : base;
      await this.prisma.withTenant(ctx.tenantId, async (tx) => {
        const existente = await tx.nyroMemory.findUnique({ where: { tenantId_chave: { tenantId: ctx.tenantId, chave } }, select: { origem: true } });
        if (existente && existente.origem !== 'auto') return; // o que a pessoa ensinou/confirmou não é sobrescrito
        await tx.nyroMemory.upsert({
          where: { tenantId_chave: { tenantId: ctx.tenantId, chave } },
          create: { tenantId: ctx.tenantId, chave, valor: f.valor, origem: 'auto', confianca: f.confianca },
          update: { valor: f.valor, confianca: f.confianca, updatedAt: new Date() },
        });
        // teto: memória sem limite vira ruído (e custo). Sai o de menor confiança e mais antigo.
        const autos = await tx.nyroMemory.count({ where: { origem: 'auto' } });
        if (autos > TETO_FATOS_AUTO) {
          const sobra = await tx.nyroMemory.findMany({ where: { origem: 'auto' }, orderBy: [{ confianca: 'asc' }, { updatedAt: 'asc' }], take: autos - TETO_FATOS_AUTO, select: { id: true } });
          await tx.nyroMemory.deleteMany({ where: { id: { in: sobra.map((x) => x.id) } } });
        }
      });
    }
  }

  /** Aprovar ou recusar também ensina: a NICO passa a saber o que o usuário costuma aceitar. */
  private async aprenderDecisao(ctx: ContextoNyro, tool: string, resumo: string, aprovou: boolean): Promise<void> {
    const chave = `decisao.${tool}`;
    try {
      await this.prisma.withTenant(ctx.tenantId, async (tx) => {
        const atual = await tx.nyroMemory.findUnique({ where: { tenantId_chave: { tenantId: ctx.tenantId, chave } }, select: { valor: true } });
        const n = (campo: string) => Number(atual?.valor.match(new RegExp(`${campo}=(\\d+)`))?.[1] ?? 0);
        const aprov = n('aprovadas') + (aprovou ? 1 : 0);
        const recus = n('recusadas') + (aprovou ? 0 : 1);
        const valor = `aprovadas=${aprov}; recusadas=${recus}; última=${aprovou ? 'aprovou' : 'recusou'} (${resumo.slice(0, 120)})`;
        await tx.nyroMemory.upsert({
          where: { tenantId_chave: { tenantId: ctx.tenantId, chave } },
          create: { tenantId: ctx.tenantId, chave, valor, origem: 'auto', confianca: 0.9 },
          update: { valor, updatedAt: new Date() },
        });
      });
    } catch (e) {
      this.log.warn(`falha ao registrar decisão: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------ rotinas (proatividade)

  /**
   * Executa uma rotina agendada: a NICO roda a instrução sozinha, salva o
   * relatório e avisa quem agendou no sino. Ação sensível NÃO executa: vira
   * pedido de aprovação, que espera no painel (nunca age sozinha no mundo).
   */
  async executarRotina(a: { id: string; tenantId: string; titulo: string; instrucao: string; destinatarioId: string | null; criadoPor: string | null }): Promise<{ relatorioId?: string }> {
    const identityId = a.destinatarioId ?? a.criadoPor;
    if (!identityId) throw new Error('rotina sem destinatário');
    const pedido = `[Rotina agendada "${a.titulo}"; ninguém está na conversa agora]\n${a.instrucao}\n\nExecute agora, do começo ao fim, sem fazer perguntas. Leia os números com as tools, escreva o relatório completo e salve com gerar_relatorio. Se não houver nada relevante, diga isso em uma linha (não invente). Ações que mudam algo no mundo ficam como pedido de aprovação.`;
    const r = await this.conversar({ tenantId: a.tenantId, identityId }, pedido, undefined, undefined, { origem: 'agendamento', agendamentoId: a.id, titulo: `Rotina: ${a.titulo}` });
    let relatorioId = r.relatorioId;
    if (!relatorioId) {
      const salvo = await this.analises.gerarRelatorio(a.tenantId, identityId, { titulo: a.titulo, tipo: 'livre', conteudoMd: r.texto, origem: 'agendamento', agendamentoId: a.id, conversationId: r.conversationId });
      relatorioId = salvo.id;
    }
    const detalhe = r.aprovacoes.length ? `${r.aprovacoes.length} ação(ões) esperando sua aprovação.` : r.texto.replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    await this.prisma.withTenant(a.tenantId, (tx) =>
      tx.notification.create({ data: { tenantId: a.tenantId, identityId, tipo: 'nico', titulo: `NICO: ${a.titulo}`, detalhe, url: `/nyro?relatorio=${relatorioId}`, entidade: 'nico_relatorio', entidadeId: relatorioId } }),
    );
    return { relatorioId };
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
