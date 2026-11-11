import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RagEscopo } from '@khub/types';
import { PrismaService } from '../../prisma/prisma.service';
import { type MensagemLLM, type RespostaLLM } from '../../ai/anthropic.provider';
import { AGENT_LLM, type AgentLlm } from '../../ai/provider.contract';
import { ErroProvedorIA } from '../../ai/provider.contract';
import { validarResposta } from '../../nyro/guardrails';
import { AgentToolsService, type ContextoAgente, type FonteUsada } from '../agent-tools.service';
import { cortarNoLimite, ferramentasDoAgente, toolsParaModelo } from '../catalogo';
import type { AgentConfig } from '../config/agent-config';
import { analiseJsonSchema, analiseSchema, analisarHeuristica, intencoesValidas, sanearAnalise, type Analise } from '../engines/analysis';
import { fragmentarMensagem, type ResultadoFragmentacao } from '../engines/message-chunker';
import { contextoAgenda, detectarPedidoAgenda } from '../engines/agenda-intent';
import { avaliarRegras, separarAcoes } from '../engines/rules-engine';
import { validarNaturalidade } from '../engines/response-validator';
import { KnowledgeService, type ConfiancaBusca } from '../knowledge/knowledge.service';
import { fatosComoTexto, ProfileService, type DecisaoExtracao, type PerfilContexto } from './profile.service';
import type { ContextoMemoria } from './memory.service';
import { contextoDinamico, promptAnalise, promptEstavel } from './prompt';

/** Teto de idas ao modelo por mensagem: ferramenta em loop não vira conta infinita. */
export const MAX_VOLTAS = 5;

/** Agente efetivo do turno: versão publicada (snapshot) ou rascunho/legado. */
export interface AgenteEfetivo {
  id: string | null;
  nome: string;
  modelo: string;
  instrucoes: string;
  tom: string;
  personalidade: string;
  ferramentas: string[];
  conhecimentoAtivo: boolean;
  conhecimentoEscopos: string[];
  maxCaracteres: number;
  maxRespostasConversa: number;
  config: AgentConfig;
  versionId: string | null;
}

export interface EntradaCore {
  tenantId: string;
  agente: AgenteEfetivo;
  empresa: string;
  nicho: string | null;
  subespecialidade: string | null;
  conversationId: string | null;
  contactId: string | null;
  contatoNome: string | null;
  messageId: string | null;
  runId: string | null;
  /** Cronológico; a última mensagem é do contato. */
  historico: { autorTipo: string; corpo: string }[];
  perfil: PerfilContexto;
  memoria: ContextoMemoria;
  intencoesExtras: { chave: string; nome: string; descricao: string; exemplos: string[] }[];
  regrasJaDisparadas: ReadonlySet<string>;
  documentIds: string[] | null;
  /** Simulador/avaliação: nada é gravado nem enviado. */
  simulacao: boolean;
  /** Avaliação: sem juiz de naturalidade/regra por histórico, decisões determinísticas. */
  origem: 'atendimento' | 'simulador' | 'avaliacao' | 'followup';
}

export interface ResultadoCore {
  decisao: 'responder' | 'transferir' | 'silenciar' | 'recusa' | 'sem_resposta';
  motivo: string | null;
  analise: Analise;
  regras: { disparadas: { regraId: string; nome: string }[]; instrucoes: string[]; acoes: { acao: string; ok: boolean; pendente?: boolean; erro?: string }[]; iniciarFollowup: string | null };
  conhecimento: { consulta: string | null; fontes: FonteUsada[]; confianca: ConfiancaBusca | null; conflitos: string[]; latenciaMs: number };
  memoria: { resumo: boolean; longoPrazo: number; operacional: number };
  extracoes: DecisaoExtracao[];
  ferramentas: { nome: string; ok: boolean; pendente?: boolean; erro?: string }[];
  textoBruto: string;
  texto: string;
  validacao: string[];
  guardrail: { regra: string; motivo: string } | null;
  fragmentacao: ResultadoFragmentacao;
  modelo: string;
  modelos: string[];
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  tempos: { analiseMs: number; conhecimentoMs: number; geracaoMs: number; totalMs: number };
}

/**
 * A resposta anuncia que a conversa vai para uma pessoa ("vou te passar para
 * a equipe", "já encaminhei para nossa atendente")? Exige verbo de
 * transferência E destino humano na mesma frase, para não pegar "vou passar o
 * valor" ou "a equipe confirma o horário".
 */
export function prometeuTransferencia(texto: string): boolean {
  const t = texto.toLowerCase();
  return t.split(/(?<=[.!?\n])\s+/).some(
    (frase) =>
      /\b(vou|irei|vamos|já|ja|estou|to|tô)\s+(te\s+|lhe\s+|seu caso\s+|sua conversa\s+|seu atendimento\s+)?(transferir|transferindo|passar|passando|encaminhar|encaminhando|encaminhei|transferi|passei)\b/.test(frase) &&
      /\b(equipe|atendente|humano|humana|pessoa|colega|respons[áa]vel|gerente|recep[çc][ãa]o)\b/.test(frase) &&
      // "passo para a equipe confirmar o horário" é pedido de aprovação de
      // agenda, não troca de atendente. ("...para verificarem o ocorrido" É troca.)
      !/\b(confirm|aprov|valid|verific|chec)\w*\s+(o\s+|seu\s+|sua\s+|esse\s+|este\s+)?(hor[áa]rio|agendamento|reserva|vaga|pedido|disponibilidade)/.test(frase),
  );
}

/**
 * Converte o histórico do Inbox em mensagens da API: contato = `user`; IA e
 * humano = `assistant` (o humano marcado). Junta autores consecutivos e
 * garante que começa e termina no contato.
 */
export function historicoParaModelo(msgs: { autorTipo: string; corpo: string }[]): MensagemLLM[] {
  const saida: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of msgs) {
    const corpo = (m.corpo ?? '').trim();
    if (!corpo) continue;
    const role = m.autorTipo === 'contato' ? 'user' : 'assistant';
    const texto = m.autorTipo === 'humano' ? `(atendente da equipe) ${corpo}` : corpo;
    const ultimo = saida[saida.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n${texto}`;
    else saida.push({ role, content: texto });
  }
  while (saida.length && saida[0].role !== 'user') saida.shift();
  while (saida.length && saida[saida.length - 1].role !== 'user') saida.pop();
  return saida;
}

/**
 * INTELLIGENCE CORE (docs/AI_AGENT_ARCHITECTURE.md §9)
 * ====================================================
 *
 * Ciclo de decisão por mensagem (passos 5–15 do §9.1; identificação,
 * estado, memória e CRM chegam prontos na entrada; envio e registro são do
 * runtime):
 *   análise estruturada → perfil (extração com política) → regras SE/ENTÃO
 *   (instruções + ações pelo Action Engine) → conhecimento (busca do agente,
 *   confiança, conflito) → geração com ferramentas → guardrail de compliance
 *   → validação de naturalidade → fragmentação.
 *
 * Independente de canal e de modo: o MESMO código serve atendimento real,
 * simulador e avaliação de regressão (`simulacao` = nenhuma escrita).
 * Nada de raciocínio privado vai para o trace — só decisões, fontes,
 * ferramentas e resultados estruturados.
 */
@Injectable()
export class IntelligenceCoreService {
  private readonly log = new Logger('IntelligenceCore');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGENT_LLM) private readonly llm: AgentLlm,
    private readonly tools: AgentToolsService,
    private readonly perfis: ProfileService,
    private readonly conhecimento: KnowledgeService,
  ) {}

  iaDisponivel(): boolean {
    return this.llm.configured();
  }

  async processar(e: EntradaCore): Promise<ResultadoCore> {
    const t0 = Date.now();
    const cfg = e.agente.config;
    const custo = { entrada: 0, saida: 0, usd: 0, modelos: new Set<string>() };
    const somar = (r: RespostaLLM) => {
      custo.entrada += r.uso.entrada;
      custo.saida += r.uso.saida;
      custo.usd += r.uso.custoUsd;
      custo.modelos.add(r.modelo);
    };
    const ultima = [...e.historico].reverse().find((m) => m.autorTipo === 'contato')?.corpo ?? '';

    // 1) análise estruturada
    const tA = Date.now();
    const analise = await this.analisar(e, ultima, somar);
    const analiseMs = Date.now() - tA;

    // 2) perfil
    const extracoes = await this.perfis.aplicarAnalise(
      { tenantId: e.tenantId, contactId: e.contactId, agentId: e.agente.id, conversationId: e.conversationId, messageId: e.messageId, runId: e.runId, simulacao: e.simulacao },
      analise,
      e.perfil,
      cfg.crm,
    );

    // 3) regras
    const ferramentasDef = ferramentasDoAgente(e.agente.ferramentas, e.agente.conhecimentoAtivo);
    const permitidas = new Set(ferramentasDef.map((f) => f.nome));
    const ctxTools: ContextoAgente = {
      tenantId: e.tenantId,
      agentId: e.agente.id,
      agentNome: e.agente.nome,
      conversationId: e.conversationId,
      contactId: e.contactId,
      nicho: e.nicho,
      subespecialidade: e.subespecialidade,
      escopos: e.agente.conhecimentoEscopos as RagEscopo[],
      simulacao: e.simulacao,
      runId: e.runId,
      documentIds: e.documentIds,
      maxTrechos: cfg.conhecimento.maxTrechos,
      exigirConfirmacao: cfg.permissoes.exigirConfirmacao,
      workflowsPermitidos: cfg.permissoes.workflowsPermitidos,
      etapasPermitidas: cfg.permissoes.etapasPermitidas,
    };
    const disparadas = avaliarRegras(cfg.regras, { analise, mensagem: ultima, etapa: e.perfil.etapa, perfil: fatosComoTexto(e.perfil), jaDisparadas: e.regrasJaDisparadas });
    const sep = separarAcoes(disparadas);
    const acoes: ResultadoCore['regras']['acoes'] = [];
    let iniciarFollowup: string | null = null;
    for (const a of sep.executaveis) {
      if (a.tipo === 'iniciar_followup') {
        iniciarFollowup = a.valor || 'sem_resposta';
        continue;
      }
      if (!cfg.permissoes.acoesPorRegra) {
        acoes.push({ acao: a.tipo, ok: false, erro: 'ações por regra desligadas nas permissões' });
        continue;
      }
      const r = await this.tools.executarAcaoRegra(a, ctxTools, permitidas);
      if (r) acoes.push({ acao: r.acao, ok: r.resultado.ok, pendente: r.resultado.aguardandoAprovacao, erro: r.resultado.erro });
    }
    const regras = { disparadas: disparadas.map((d) => ({ regraId: d.regraId, nome: d.nome })), instrucoes: sep.instrucoes, acoes, iniciarFollowup };

    const base = {
      analise,
      regras,
      memoria: { resumo: !!e.memoria.resumoConversa, longoPrazo: e.memoria.longoPrazo.length, operacional: e.memoria.operacional.length },
      extracoes,
      ferramentas: [] as ResultadoCore['ferramentas'],
      modelo: e.agente.modelo,
      validacao: [] as string[],
      guardrail: null,
      fragmentacao: { blocos: [], estrategia: 'unica' as const, ajustes: [] },
      textoBruto: '',
      texto: '',
    };
    const fim = (parcial: Partial<ResultadoCore> & Pick<ResultadoCore, 'decisao' | 'motivo'>, conhecimento?: ResultadoCore['conhecimento'], tempos?: Partial<ResultadoCore['tempos']>): ResultadoCore => ({
      ...base,
      conhecimento: conhecimento ?? { consulta: null, fontes: [], confianca: null, conflitos: [], latenciaMs: 0 },
      ...parcial,
      modelos: [...custo.modelos],
      tokensEntrada: custo.entrada,
      tokensSaida: custo.saida,
      custoUsd: custo.usd,
      tempos: { analiseMs, conhecimentoMs: 0, geracaoMs: 0, ...tempos, totalMs: Date.now() - t0 },
    });

    if (sep.silenciar) return fim({ decisao: 'silenciar', motivo: `regra: ${disparadas.filter((d) => d.acoes.some((x) => x.tipo === 'silenciar')).map((d) => d.nome).join(', ')}` });
    if (sep.transferir) return fim({ decisao: 'transferir', motivo: sep.transferir });

    // Pedido explícito não depende de o modelo executar a ferramenta corretamente.
    if (analise.pedeHumano) {
      const texto = 'Vou encaminhar sua conversa para uma pessoa da equipe.';
      return fim({ decisao: 'transferir', motivo: 'atendimento humano solicitado pelo contato', texto, textoBruto: texto, fragmentacao: fragmentarMensagem(texto, cfg.comunicacao.fragmentacao) });
    }

    // 4) conhecimento (pré-busca dirigida pela análise)
    const tK = Date.now();
    let conhecimento: ResultadoCore['conhecimento'] = { consulta: null, fontes: [], confianca: null, conflitos: [], latenciaMs: 0 };
    let trechos: { chunkId: string; titulo: string; conteudo: string }[] = [];
    const deveConsultar = e.agente.conhecimentoAtivo && (sep.consultarBase.length > 0 || (analise.precisaConhecimento && cfg.conhecimento.consultarEm.includes(analise.intencao)));
    if (deveConsultar) {
      const consulta = (sep.consultarBase[0] || analise.consultaBase || ultima).slice(0, 500);
      try {
        const r = await this.conhecimento.buscar(e.tenantId, { agentId: e.agente.id ?? '', nicho: e.nicho, subespecialidade: e.subespecialidade, escopos: e.agente.conhecimentoEscopos as RagEscopo[], documentIds: e.documentIds, k: cfg.conhecimento.maxTrechos }, consulta);
        trechos = r.hits.map((h) => ({ chunkId: h.chunkId, titulo: h.titulo, conteudo: h.conteudo.slice(0, 1500) }));
        conhecimento = { consulta, fontes: r.hits.map((h) => ({ chunkId: h.chunkId, documentId: h.documentId, titulo: h.titulo, escopo: h.escopo, score: h.score })), confianca: r.confianca, conflitos: r.conflitos, latenciaMs: r.latenciaMs };
      } catch (err) {
        this.log.warn(`busca de conhecimento falhou (tenant ${e.tenantId}): ${(err as Error).message}`);
        conhecimento = { consulta, fontes: [], confianca: { nivel: 'nenhuma', motivo: 'busca indisponível' }, conflitos: [], latenciaMs: Date.now() - tK };
      }
    }
    const conhecimentoMs = Date.now() - tK;

    if (!this.llm.configured()) {
      return fim({ decisao: 'transferir', motivo: `IA não configurada (falta ${this.llm.missing().join(', ')})` }, conhecimento, { conhecimentoMs });
    }

    // 4b) pré-consulta de agenda: pedido de horário com dia identificável já
    // chega ao modelo com os horários livres (ver engines/agenda-intent.ts).
    const preFerramentas: ResultadoCore['ferramentas'] = [];
    let blocoAgenda = '';
    if (permitidas.has('ver_agendamentos') && e.contactId && this.llm.configured()) {
      const agora = new Date();
      const pedido = detectarPedidoAgenda(ultima, agora, cfg.horario.fuso, analise.intencao);
      if (pedido) {
        const res = await this.tools.executar('ver_agendamentos', { data: pedido.data, duracaoMin: 60 }, ctxTools, permitidas);
        preFerramentas.push({ nome: 'ver_agendamentos', ok: res.ok, erro: res.erro });
        const livres = res.ok ? ((res.dados as { horariosLivres?: { inicio: string; fim: string }[] } | undefined)?.horariosLivres ?? []) : null;
        if (livres) blocoAgenda = `\n${contextoAgenda(pedido, livres, cfg.horario.fuso, agora)}`;
      }
    }

    // 5) geração com ferramentas
    const tG = Date.now();
    const system = `${promptEstavel(e.agente, { empresa: e.empresa, nicho: e.nicho })}\n\n${contextoDinamico({
      contatoNome: e.contatoNome,
      perfil: e.perfil,
      memoria: e.memoria,
      analise,
      instrucoesRegras: sep.instrucoes,
      conhecimento: deveConsultar ? { trechos, consultado: true, confianca: conhecimento.confianca?.nivel ?? 'nenhuma', conflitos: conhecimento.conflitos } : null,
      intencoesExtras: e.intencoesExtras,
      agora: new Date(),
      fuso: cfg.horario.fuso,
    })}${blocoAgenda}`;
    const historico = historicoParaModelo(e.historico.slice(-cfg.inteligencia.janelaHistorico));
    if (!historico.length) return fim({ decisao: 'sem_resposta', motivo: 'mensagem sem texto' }, conhecimento, { conhecimentoMs });

    const conversa: MensagemLLM[] = [...historico];
    const ferramentas: ResultadoCore['ferramentas'] = [...preFerramentas];
    const fontes = [...conhecimento.fontes];
    let texto = '';
    let transferir: string | undefined;
    let modelo = e.agente.modelo;
    const toolsApi = toolsParaModelo(ferramentasDef);

    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const r = await this.chamarComFallback(e, { system, mensagens: conversa, tools: toolsApi });
      somar(r);
      modelo = r.modelo;
      if (r.pararPor === 'refusal') {
        return fim({ decisao: 'recusa', motivo: 'o modelo recusou responder esta mensagem', ferramentas, modelo, conhecimento: { ...conhecimento, fontes } }, conhecimento, { conhecimentoMs, geracaoMs: Date.now() - tG });
      }
      if (r.texto) texto = r.texto;
      if (!r.toolCalls.length) break;
      // Turno do assistente volta INTACTO (thinking incluso).
      conversa.push({ role: 'assistant', content: r.blocos });
      const resultados: unknown[] = [];
      for (const chamada of r.toolCalls) {
        const res = await this.tools.executar(chamada.nome, chamada.args, ctxTools, permitidas);
        ferramentas.push({ nome: chamada.nome, ok: res.ok, pendente: res.aguardandoAprovacao, erro: res.erro });
        if (res.fontes?.length) fontes.push(...res.fontes.filter((f) => !fontes.some((x) => x.chunkId === f.chunkId)));
        if (res.transferir) transferir = res.transferir.motivo;
        resultados.push({ type: 'tool_result', tool_use_id: chamada.id, is_error: !res.ok, content: JSON.stringify(res.ok ? res.dados ?? { ok: true } : { erro: res.erro }) });
      }
      conversa.push({ role: 'user', content: resultados });
      if (volta === MAX_VOLTAS - 1) this.log.warn(`agente ${e.agente.nome}: limite de ${MAX_VOLTAS} voltas de ferramenta atingido`);
    }
    const geracaoMs = Date.now() - tG;
    conhecimento = { ...conhecimento, fontes };
    const textoBruto = texto;

    // 6) guardrail de compliance (camada 2) — ANTES de sair para o lead
    let guardrail: ResultadoCore['guardrail'] = null;
    if (texto) {
      const v = validarResposta(texto, e.nicho);
      if (!v.ok) {
        guardrail = { regra: v.regra ?? 'desconhecida', motivo: v.motivo ?? '' };
        if (!e.simulacao) await this.registrarGuardrail(e.tenantId, e.nicho, guardrail.regra, texto);
        texto = v.substituto ?? '';
      }
    }

    // 7) naturalidade
    let validacao: string[] = [];
    if (texto) {
      const anteriores = e.historico.filter((m) => m.autorTipo === 'ia').slice(-4).map((m) => m.corpo);
      const v = validarNaturalidade(texto, {
        agenteNome: e.agente.nome,
        contatoNome: e.contatoNome,
        jaFalouAntes: anteriores.length > 0,
        reapresentar: cfg.comunicacao.reapresentar,
        usarNome: cfg.comunicacao.usarNome,
        emojis: cfg.comunicacao.emojis,
        evitarRepeticao: cfg.comunicacao.evitarRepeticao,
        anteriores,
        ultimaDoContato: ultima,
      });
      texto = v.texto;
      validacao = v.avisos;
    }

    // "Vou te passar para a equipe" sem chamar a ferramenta deixaria o contato
    // esperando um humano que nunca soube da conversa (modelo pequeno faz isso
    // com frequência). O que foi prometido passa a ser verdade.
    if (texto && !transferir && permitidas.has('transferir_para_humano') && !ferramentas.some((f) => f.pendente) && prometeuTransferencia(texto)) {
      transferir = 'o agente avisou a transferência para a equipe';
    }

    // Falha de geração não pode deixar um cliente sem encaminhamento.
    if (!texto.trim() && !transferir) {
      transferir = 'modelo retornou uma resposta vazia';
      texto = 'Não consegui concluir sua resposta agora. Vou encaminhar sua conversa para a equipe.';
    }

    // 8) fragmentação
    const frag = cfg.comunicacao.fragmentacao;
    if (!frag.ativo) texto = cortarNoLimite(texto, e.agente.maxCaracteres);
    else texto = cortarNoLimite(texto, frag.maxBlocos * frag.maxCaracteresBloco + 200);
    const fragmentacao = texto ? fragmentarMensagem(texto, frag) : { blocos: [], estrategia: 'unica' as const, ajustes: [] };

    const decisao: ResultadoCore['decisao'] = transferir ? 'transferir' : texto ? 'responder' : 'sem_resposta';
    return fim(
      {
        decisao,
        motivo: transferir ?? (texto ? (guardrail ? `guardrail: ${guardrail.motivo}` : null) : 'o agente não conseguiu formular uma resposta'),
        ferramentas,
        textoBruto,
        texto,
        validacao,
        guardrail,
        fragmentacao,
        modelo,
      },
      conhecimento,
      { conhecimentoMs, geracaoMs },
    );
  }

  /** Análise por structured outputs; fallback determinístico em qualquer falha. */
  private async analisar(e: EntradaCore, ultima: string, somar: (r: RespostaLLM) => void): Promise<Analise> {
    const extras = e.intencoesExtras;
    const heuristica = () => analisarHeuristica(ultima, extras);
    const cfg = e.agente.config.inteligencia;
    if (!cfg.analiseAtiva || !this.llm.configured() || !ultima.trim()) return heuristica();
    const intencoes = intencoesValidas(extras);
    const transcricao = e.historico
      .slice(-10)
      .map((m) => `${m.autorTipo === 'contato' ? 'CONTATO' : m.autorTipo === 'ia' ? 'AGENTE' : 'EQUIPE'}: ${m.corpo.slice(0, 600)}`)
      .join('\n');
    const conhecidos = Object.entries(fatosComoTexto(e.perfil)).map(([k, v]) => `${k}: ${v}`).join('; ');
    try {
      const r = await this.llm.conversar({
        modelo: cfg.modeloAnalise ?? e.agente.modelo,
        system: promptAnalise(extras),
        mensagens: [{ role: 'user', content: `<perfil_conhecido>${conhecidos || '(vazio)'}</perfil_conhecido>\n<conversa>\n${transcricao}\n</conversa>` }],
        maxTokens: 4096,
        effort: 'low',
        jsonSchema: analiseJsonSchema(intencoes),
        timeoutMs: Math.min(cfg.timeoutMs, 30_000),
      });
      somar(r);
      if (r.pararPor === 'refusal' || !r.texto) return heuristica();
      const p = analiseSchema.safeParse(JSON.parse(r.texto));
      if (!p.success) {
        this.log.warn(`análise fora do schema descartada: ${p.error.issues[0]?.message}`);
        return heuristica();
      }
      return sanearAnalise({ ...p.data, fonte: 'modelo' }, intencoes);
    } catch (err) {
      this.log.warn(`análise por IA falhou, usando heurística: ${(err as Error).message.slice(0, 160)}`);
      return heuristica();
    }
  }

  /** Chamada principal com tentativas e modelo de fallback (só para erro retentável). */
  private async chamarComFallback(e: EntradaCore, i: { system: string; mensagens: MensagemLLM[]; tools: ReturnType<typeof toolsParaModelo> }): Promise<RespostaLLM> {
    const cfg = e.agente.config.inteligencia;
    const modelos = [e.agente.modelo, ...(cfg.modeloFallback && cfg.modeloFallback !== e.agente.modelo ? [cfg.modeloFallback] : [])];
    let ultimoErro: unknown;
    for (const modelo of modelos) {
      for (let tentativa = 0; tentativa <= cfg.tentativas; tentativa++) {
        try {
          return await this.llm.conversar({ modelo, system: i.system, mensagens: i.mensagens, tools: i.tools, maxTokens: cfg.maxTokens, effort: cfg.effort, fallbackRecusa: true, timeoutMs: cfg.timeoutMs });
        } catch (err) {
          ultimoErro = err;
          const retentavel = err instanceof ErroProvedorIA ? err.retentavel : (err as Error).name === 'TimeoutError' || /fetch failed|ECONN|5\d\d/.test((err as Error).message);
          if (!retentavel) throw err;
          if (tentativa < cfg.tentativas) await new Promise((r) => setTimeout(r, 800 * 2 ** tentativa));
        }
      }
    }
    throw ultimoErro;
  }

  private async registrarGuardrail(tenantId: string, nicho: string | null, regra: string, trecho: string) {
    await this.prisma
      .withTenant(tenantId, (tx) => tx.nyroGuardrailHit.create({ data: { tenantId, nicho, regra, trecho: trecho.slice(0, 2000), acao: 'reescrito' } }))
      .catch((err: Error) => this.log.warn(`falha ao registrar guardrail: ${err.message}`));
  }

  /** Custo por tenant na mesma tabela da Nyro. Falhar aqui não derruba a resposta. */
  async registrarUso(tenantId: string, agenteNome: string, r: { modelo: string; entrada: number; saida: number; custoUsd: number; latenciaMs: number }) {
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.aiUsageEvent.create({
          data: {
            tenantId,
            conversationId: null,
            agente: `agente:${agenteNome}`.slice(0, 120),
            modelo: r.modelo,
            tokensEntrada: r.entrada,
            tokensSaida: r.saida,
            tokensCache: 0,
            custoUsd: new Prisma.Decimal(r.custoUsd.toFixed(6)),
            latenciaMs: r.latenciaMs,
          },
        }),
      );
    } catch (err) {
      this.log.warn(`falha ao registrar uso de IA: ${(err as Error).message}`);
    }
  }
}
