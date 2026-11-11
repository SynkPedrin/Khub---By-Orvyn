import { UnrecoverableError } from 'bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { CrmService } from '../crm/crm.service';
import { MessagesService, type AutorEnvio } from '../crm/messaging/messages.service';
import { TasksService } from '../crm/tasks.service';
import { NotesService } from '../crm/notes.service';
import { MailerService } from '../common/mailer.service';
import { AiService, type TarefaIA } from '../ai/ai.service';
import { soDigitos } from '../crm/telefone';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { AvaliacoesService } from '../avaliacoes/avaliacoes.service';
import { validarConfig, type Grafo, type No, type Ramo, type Regra, type TipoNo } from './catalogo';
import { NosMotor } from './nos-motor';
import { agoraNoFuso, fusoOuPadrao, lerData } from './tempo';

/** Contexto que viaja com a execução (é o `estado` persistido do run). */
export interface Contexto {
  executionKey?: string;
  runStartedAt?: string;
  /** Workflow que está rodando — persiste a origem da mensagem (migration 036). */
  workflowId?: string;
  contato?: {
    id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null; tag: string; tags: string[]; valor: number;
    /** Q3.1: campos personalizados (`contato.campos.<chave>`), dono, não perturbe, origem. */
    campos?: Record<string, unknown>;
    ownerId?: string | null;
    naoPerturbe?: boolean;
    origem?: string | null;
    proximaAcaoAt?: string | null;
    criadoEm?: string;
  };
  /** Run em execução (Q3.1: "Remover de fluxo" não cancela a si mesmo). */
  runId?: string;
  /** Fuso do fluxo (workflows.timezone): "Esperar até" e condição por dia/hora. */
  fuso?: string;
  /** Respostas do formulário do gatilho (Q3.2): `{{formulario.<campo>}}`. */
  formulario?: Record<string, unknown>;
  /** Pagamento do gatilho (Q3.2): `{{pagamento.valor}}`, `.descricao`. */
  pagamento?: { id: string; valor: number; valorFormatado: string; valorCentavos: number; moeda: string; descricao: string; pagoEm: string };
  /** Id do "Esperar até" (modo evento) segurando o run. */
  aguardandoEvento?: string | null;
  /** Marcado pelo RunsService quando o evento esperado chega. */
  eventoOcorreu?: boolean;
  /** Dados do último evento que acordou uma espera ou disparou uma meta. */
  evento?: Record<string, unknown>;
  /** Metas (goal) já atingidas neste run. */
  metasAtingidas?: string[];
  /** Id da meta segurando o run (`seNaoAtingida: esperar`). */
  aguardandoMeta?: string | null;
  negocio?: { id: string; titulo: string; valor: number; stageId: string; origem: string | null; status?: string; ownerId?: string | null; campos?: Record<string, unknown> };
  /** `canal`: canal da conversa (WhatsApp, Instagram…) — filtro do gatilho (Q1.2). */
  /** Compromisso do gatilho de agenda (migration 054): `{{agendamento.data}}`, `.hora`, `.titulo`, `.local`. */
  agendamento?: import('./agendamento-contexto').ContextoAgendamento;
  mensagem?: { id: string; texto: string; de: string; canal?: string };
  gatilho?: Record<string, unknown>;
  /** Saídas de nós já executados, para o webhook/mensagem referenciarem. */
  passos?: Record<string, unknown>;
  /** Variáveis definidas pelo fluxo (nó "Definir variável"). Usáveis em
   *  `{{variaveis.nome}}` em mensagens e como campo em condições. */
  variaveis?: Record<string, unknown>;
  /** Id do nó "esperar resposta" que está segurando a execução (null = nenhum). */
  aguardandoResposta?: string | null;
  /** Marcado quando o contato responde enquanto o run espera. */
  respondeu?: boolean;
  /** ISO de quando o fluxo consumiu a última resposta (ver RunsService.avisarResposta). */
  baseResposta?: string;
  /**
   * Execução de TESTE (botão Testar ou a NICO no modo simples). Nunca toca a
   * operação do cliente: mensagens vão só para o número de teste
   * (`AUTOMATION_TEST_PHONE`), ações de CRM/webhook/e-mail são simuladas com o
   * que SERIAM, esperas são puladas e nada encadeia outro fluxo.
   */
  teste?: boolean;
}

export interface ResultadoNo {
  /** Próximo ramo a seguir (If/Else). Ausente = saída única. */
  ramo?: string;
  /** Pula direto para este nó (Go to). */
  irPara?: string;
  /** Suspende a execução por N ms (Wait). */
  esperarMs?: number;
  /** Reagenda o PRÓPRIO nó (usado por "esperar resposta": o mesmo nó acorda no
   *  timeout e decide o ramo). */
  mesmoNo?: boolean;
  /** Encerra a execução aqui (nó "Encerrar" ou fim de ramo). */
  encerrar?: boolean;
  /** O que registrar no log do passo. */
  saida?: Record<string, unknown>;
  /** Mudanças a mesclar no contexto. */
  contexto?: Partial<Contexto>;
}

/**
 * Executa **um** nó. Não sabe de fila, retry nem próximo passo — quem orquestra
 * é o processor. Assim a lógica de cada nó é testável sem Redis.
 *
 * Toda ação passa pelos serviços do CRM (mesmas regras, mesma auditoria) — a
 * automação é um usuário como outro qualquer, nunca escreve direto no banco.
 */
@Injectable()
export class ExecutorService {
  private readonly log = new Logger('Automations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crm: CrmService,
    private readonly mensagens: MessagesService,
    private readonly tarefas: TasksService,
    private readonly notas: NotesService,
    private readonly mailer: MailerService,
    private readonly ai: AiService,
    private readonly camposCustom: CustomFieldsService,
    // Opcional: specs antigos constroem o executor sem ele (Q4.4).
    @Optional() private readonly avaliacoes?: AvaliacoesService,
  ) {
    this.motor = new NosMotor(prisma, crm, camposCustom, (t, c) => this.interpolar(t, c), (campo, c) => this.valorDoCampo(campo, c));
  }

  private readonly motor: NosMotor;

  async executar(tenantId: string, no: No, ctx: Contexto, grafo: Grafo): Promise<ResultadoNo> {
    // Config fora do schema do catálogo (ex.: grafo gravado por fora da API, como o
    // seed de demo com `condicoes` legado) não é falha transitória: retentar só
    // repetia `TypeError: ramos is not iterable` 4x por evento. Vai direto à DLQ
    // com a causa legível.
    const valida = validarConfig(no.tipo as TipoNo, no.config);
    if (!valida.ok) throw new UnrecoverableError(`config inválida no nó "${no.id}" (${no.tipo}): ${valida.erro}`);
    // Nós da Q3.1 recebem a config JÁ com os defaults do catálogo aplicados.
    const noValido: No = { ...no, config: valida.dados as Record<string, unknown> };
    if (ctx.teste) {
      const simulado = await this.emTeste(tenantId, noValido, ctx);
      if (simulado) return simulado;
    }
    switch (no.tipo as TipoNo) {
      case 'controle.esperar_ate':
        return this.motor.esperarAte(noValido, ctx);
      case 'controle.meta':
        return this.motor.meta(noValido, ctx);
      case 'acao.remover_de_fluxo':
        return this.motor.removerDeFluxo(tenantId, noValido, ctx);
      case 'acao.atribuir_usuario':
        return this.motor.atribuirUsuario(tenantId, noValido, ctx);
      case 'acao.nao_perturbe':
        return this.motor.naoPerturbe(tenantId, noValido, ctx);
      case 'acao.atualizar_negocio':
        return this.motor.atualizarNegocio(tenantId, noValido, ctx);
      case 'controle.esperar':
        return this.esperar(no);
      case 'controle.esperar_resposta':
        return this.esperarResposta(tenantId, no, ctx);
      case 'controle.encerrar':
        return { encerrar: true, saida: { motivo: (no.config as { motivo?: string }).motivo ?? 'fim do fluxo' } };
      case 'controle.condicao':
        return this.condicao(no, ctx.teste ? ctx : await this.motor.contextoAtual(tenantId, ctx));
      case 'controle.split':
        return this.split(no, ctx);
      case 'controle.drip':
        return this.drip(tenantId, no);
      case 'controle.ir_para':
        return this.irPara(no, grafo);
      case 'acao.enviar_sms':
        return this.enviarSms(tenantId, no, ctx);
      case 'acao.enviar_email':
        return this.enviarEmail(tenantId, no, ctx);
      case 'acao.notificar_equipe':
        return this.notificarEquipe(tenantId, no, ctx);
      case 'acao.definir_variavel':
        return this.definirVariavel(no, ctx);
      case 'acao.formatar_texto':
        return this.formatarTexto(no, ctx);
      case 'acao.ia':
        return this.ia(no, ctx);
      case 'acao.adicionar_tag':
        return this.mexerTag(tenantId, no, ctx, 'add');
      case 'acao.remover_tag':
        return this.mexerTag(tenantId, no, ctx, 'remove');
      case 'acao.atualizar_contato':
        return this.motor.atualizarContato(tenantId, noValido, ctx);
      case 'acao.criar_oportunidade':
        return this.criarOportunidade(tenantId, no, ctx);
      case 'acao.mover_etapa':
        return this.moverEtapa(tenantId, no, ctx);
      case 'acao.criar_tarefa':
        return this.criarTarefa(tenantId, no, ctx);
      case 'acao.criar_nota':
        return this.criarNota(tenantId, no, ctx);
      case 'acao.chamar_workflow':
        // resolvido pelo orquestrador (precisa abrir outro run) — ver RunsService
        return { saida: { encadear: (no.config as { workflowId: string }).workflowId } };
      case 'acao.webhook':
        return this.webhook(no, ctx);
      case 'acao.pedir_avaliacao':
        return this.pedirAvaliacao(tenantId, no, ctx);
      default:
        // Gatilho não "executa": ele abre o run. Cair aqui é grafo inválido.
        throw new Error(`nó não executável: ${no.tipo}`);
    }
  }

  // ------------------------------------------------------------------ teste

  /**
   * Sandbox do teste. Devolve o resultado SIMULADO do nó, ou `null` quando o
   * nó roda de verdade (condição, A/B, IA, variável, formatar, ir para,
   * encerrar: nenhum deles toca a operação). Regra do product owner: teste
   * nunca afeta o cliente — nem mensagem a contato, nem dado do CRM, nem
   * disparo de outra automação.
   */
  private async emTeste(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo | null> {
    const cfg = no.config as Record<string, unknown>;
    const simulado = (descricao: string, extra: Record<string, unknown> = {}, contexto?: Partial<Contexto>): ResultadoNo => ({
      saida: { simulado: true, descricao, ...extra },
      ...(contexto ? { contexto } : {}),
    });

    switch (no.tipo as TipoNo) {
      case 'acao.enviar_sms':
        return this.enviarParaNumeroDeTeste(tenantId, no, ctx, this.interpolar(String(cfg.texto ?? ''), ctx), 'contato');
      case 'acao.notificar_equipe':
        return this.enviarParaNumeroDeTeste(tenantId, no, ctx, this.interpolar(String(cfg.texto ?? ''), ctx), 'equipe');
      case 'acao.enviar_email': {
        const assunto = this.interpolar(String(cfg.assunto ?? ''), ctx);
        const texto = this.interpolar(String(cfg.corpo ?? ''), ctx);
        return simulado(`E-mail para ${ctx.contato?.email ?? 'o contato'} (não enviado no teste)`, { assunto, texto, para: ctx.contato?.email ?? null });
      }
      case 'acao.webhook':
        return simulado(`Chamaria ${String(cfg.metodo ?? 'POST')} ${String(cfg.url ?? '')} (não chamado no teste)`, { url: cfg.url, metodo: cfg.metodo ?? 'POST' });
      case 'acao.adicionar_tag':
      case 'acao.remover_tag': {
        if (!ctx.contato) throw new Error('nó de tag sem contato no contexto');
        const tag = String(cfg.tag ?? '');
        const atuais = ctx.contato.tags ?? [];
        const tags = no.tipo === 'acao.adicionar_tag'
          ? Array.from(new Set([...atuais, tag]))
          : atuais.filter((t) => t.toLowerCase() !== tag.toLowerCase());
        const verbo = no.tipo === 'acao.adicionar_tag' ? 'Adicionaria' : 'Removeria';
        return simulado(`${verbo} a tag "${tag}"`, { tags }, { contato: { ...ctx.contato, tags } });
      }
      case 'acao.criar_oportunidade': {
        const titulo = this.interpolar(String(cfg.titulo ?? ''), ctx);
        const valor = Number(cfg.valor ?? 0);
        return simulado(`Criaria a oportunidade "${titulo}"`, { titulo, valor, stageId: cfg.stageId }, {
          negocio: { id: 'teste', titulo, valor, stageId: String(cfg.stageId ?? ''), origem: String(cfg.origem ?? 'Automação') },
        });
      }
      case 'acao.mover_etapa':
        return simulado('Moveria a oportunidade de etapa', { stageId: cfg.stageId }, ctx.negocio ? { negocio: { ...ctx.negocio, stageId: String(cfg.stageId ?? '') } } : undefined);
      case 'acao.criar_tarefa':
        return simulado(`Criaria a tarefa "${this.interpolar(String(cfg.titulo ?? ''), ctx)}"`, { prioridade: cfg.prioridade ?? 'media' });
      case 'acao.criar_nota':
        return simulado('Criaria uma nota no contato', { texto: this.interpolar(String(cfg.corpo ?? ''), ctx) });
      case 'acao.atualizar_contato':
        return simulado('Atualizaria os dados do contato', { campos: cfg.campos ?? null });
      case 'acao.atualizar_negocio':
        return simulado('Atualizaria a oportunidade', { campos: cfg.campos ?? null });
      case 'acao.atribuir_usuario':
        return simulado('Atribuiria um responsável ao contato');
      case 'acao.nao_perturbe':
        return simulado('Mudaria o "não perturbe" do contato');
      case 'acao.remover_de_fluxo':
        return simulado('Tiraria o contato de outros fluxos');
      case 'acao.chamar_workflow':
        // Sem `encadear`: o RunsService também não encadeia run de teste.
        return simulado('Colocaria o contato em outra automação (não disparada no teste)', { workflowId: cfg.workflowId });
      case 'controle.esperar':
        return simulado(`Esperaria ${String(cfg.duracao)} ${String(cfg.unidade)} (pulado no teste)`);
      case 'controle.drip':
        return simulado('Liberaria em lotes (pulado no teste, sem consumir a cota real)');
      case 'controle.esperar_resposta':
        return { ramo: 'timeout', saida: { simulado: true, descricao: 'No teste não há resposta real: segue pelo caminho "sem resposta"' }, contexto: { aguardandoResposta: null } };
      case 'controle.esperar_ate':
        return cfg.modo === 'evento'
          ? { ramo: 'expirou', saida: { simulado: true, descricao: 'No teste o evento não acontece: segue pelo prazo expirado' }, contexto: { aguardandoEvento: null } }
          : simulado('Esperaria até a data (pulado no teste)');
      case 'controle.meta':
        return simulado('Meta: no teste o fluxo segue em frente');
      case 'acao.pedir_avaliacao':
        return simulado(`Pediria avaliação por ${String(cfg.canal ?? 'whatsapp') === 'email' ? 'e-mail' : 'WhatsApp'} (não enviado no teste)`);
      default:
        // À prova de futuro: ação nova sem tratamento de teste NÃO roda — só as
        // que não tocam a operação (IA, variável, formatar) passam direto.
        if (no.tipo.startsWith('acao.') && !ACOES_SEGURAS_NO_TESTE.has(no.tipo)) {
          return simulado('Ação simulada no teste (não executada)');
        }
        return null;
    }
  }

  /**
   * Teste com mensagem REAL, mas só para o número de teste: texto já
   * personalizado com os dados reais do contato. Não abre conversa nem grava
   * mensagem no Inbox do cliente.
   */
  private async enviarParaNumeroDeTeste(tenantId: string, no: No, ctx: Contexto, corpo: string, destinoOriginal: 'contato' | 'equipe'): Promise<ResultadoNo> {
    const numero = soDigitos(this.config.get('AUTOMATION_TEST_PHONE') ?? '');
    const paraQuem = destinoOriginal === 'contato' ? (ctx.contato?.telefone ?? 'o contato') : 'a equipe';
    if (!numero) {
      return { saida: { simulado: true, status: 'config_required', missing: ['AUTOMATION_TEST_PHONE'], texto: corpo, descricao: `Mensagem para ${paraQuem} (sem número de teste configurado, não enviada)` } };
    }
    if (!ctx.executionKey) throw new UnrecoverableError('teste_sem_chave_de_execucao');
    const r = await this.mensagens.notificarNumero(tenantId, numero, corpo, `${ctx.executionKey}:teste`);
    if (r.status === 'pending') throw new Error('messaging_provider_rate_limited');
    return {
      saida: { teste: true, status: r.status, texto: corpo, para: mascararNumero(numero), descricao: `Mensagem que iria para ${paraQuem}, entregue no número de teste` },
      contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status: r.status } } },
    };
  }

  // ---------------------------------------------------------------- controle

  private esperar(no: No): ResultadoNo {
    const { duracao, unidade } = no.config as { duracao: number; unidade: string };
    const fator: Record<string, number> = { segundos: 1000, minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };
    const ms = duracao * (fator[unidade] ?? 1000);
    return { esperarMs: ms, saida: { esperando: `${duracao} ${unidade}` } };
  }

  /**
   * Espera o contato responder. Roda **duas vezes**:
   *  1ª — marca `aguardandoResposta` no estado e reagenda o PRÓPRIO nó para o
   *       prazo (o run fica `esperando`);
   *  2ª — se acordou porque o contato respondeu (a marca some), vai pelo ramo
   *       `resposta`; se acordou pelo prazo, vai por `timeout`.
   */
  private async esperarResposta(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    if (!ctx.contato) throw new Error('nó "esperar resposta" sem contato no contexto');

    if (ctx.respondeu) {
      return { ramo: 'resposta', saida: { respondeu: true }, contexto: { respondeu: false, aguardandoResposta: null } };
    }
    if (ctx.aguardandoResposta === no.id) {
      // acordou pelo timeout e a marca ainda está lá: ninguém respondeu
      return { ramo: 'timeout', saida: { respondeu: false }, contexto: { aguardandoResposta: null } };
    }

    // Corrida real: o contato pode responder NO INTERVALO entre a mensagem do
    // passo anterior e esta marca de espera (ms, mas acontece com resposta
    // imediata). Sem esta checagem, a resposta se perdia e o fluxo mandava o
    // follow-up para quem JÁ tinha respondido. Baseline = início do run ou o
    // momento em que a resposta anterior foi consumida (baseResposta).
    const base = ctx.runStartedAt ? new Date(ctx.runStartedAt) : null;
    if (base) {
      const antecipada = await this.prisma.withTenant(tenantId, async (tx) => {
        const c = await tx.contact.findUnique({ where: { id: ctx.contato!.id, tenantId }, select: { lastInboundAt: true } });
        if (!c?.lastInboundAt || c.lastInboundAt < base) return null;
        const conv = await tx.conversation.findFirst({ where: { contactId: ctx.contato!.id, canal: 'WhatsApp' }, select: { id: true } });
        const msg = conv
          ? await tx.message.findFirst({ where: { conversationId: conv.id, tenantId, autorTipo: 'contato', createdAt: { gte: base } }, orderBy: { createdAt: 'desc' }, select: { id: true, corpo: true } })
          : null;
        return { mensagem: msg ? { id: msg.id, texto: msg.corpo, de: 'contato' } : undefined };
      });
      if (antecipada) {
        return {
          ramo: 'resposta',
          saida: { respondeu: true, antecipada: true },
          contexto: { aguardandoResposta: null, baseResposta: new Date().toISOString(), ...(antecipada.mensagem ? { mensagem: antecipada.mensagem } : {}) },
        };
      }
    }

    const { duracao, unidade } = no.config as { duracao: number; unidade: string };
    const fator: Record<string, number> = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };
    return {
      esperarMs: duracao * (fator[unidade] ?? 60_000),
      mesmoNo: true,
      saida: { aguardando: `${duracao} ${unidade}` },
      contexto: { aguardandoResposta: no.id },
    };
  }

  /**
   * If/Else com ramos: cada ramo tem regras e uma junção
   * AND/OR/NONE. Ganha o **primeiro** ramo que casar (ordem do array), e o ramo
   * `NONE` sem regras é o "quando nada bate" — o else explícito.
   */
  private condicao(no: No, ctx: Contexto): ResultadoNo {
    const { ramos } = no.config as { ramos: Ramo[] };
    for (const ramo of ramos) {
      if (this.ramoBate(ramo, ctx)) return { ramo: ramo.id, saida: { ramo: ramo.rotulo ?? ramo.id } };
    }
    return { ramo: undefined, saida: { ramo: 'nenhum' } };
  }

  /**
   * Teste A/B por peso, **determinístico**: o mesmo contato cai sempre no mesmo
   * ramo (hash do contato + nó). Sem Math.random — isso preserva a idempotência
   * da reentrada (re-executar o run não troca o contato de variante).
   */
  private split(no: No, ctx: Contexto): ResultadoNo {
    const { ramos } = no.config as { ramos: { id: string; rotulo?: string; peso: number }[] };
    const pesos = ramos.map((r) => Math.max(1, r.peso));
    const total = pesos.reduce((s, p) => s + p, 0);
    const bucket = this.hash(`${ctx.contato?.id ?? 'sem-contato'}:${no.id}`) % total;
    let acc = 0;
    for (let i = 0; i < ramos.length; i++) {
      acc += pesos[i];
      if (bucket < acc) return { ramo: ramos[i].id, saida: { ramo: ramos[i].rotulo ?? ramos[i].id } };
    }
    return { ramo: ramos[0].id, saida: { ramo: ramos[0].rotulo ?? ramos[0].id } };
  }

  /**
   * Drip: libera no máximo `porJanela` contatos por janela. Incrementa o contador
   * (atômico, sobrevive entre runs) e, se estourou o lote, espera a próxima janela
   * e re-entra no MESMO nó — sem perder o contato. Throttle real, não simulado.
   */
  private async drip(tenantId: string, no: No): Promise<ResultadoNo> {
    const { porJanela, janela } = no.config as { porJanela: number; janela: 'minuto' | 'hora' | 'dia' };
    const janelaMs = { minuto: 60_000, hora: 3_600_000, dia: 86_400_000 }[janela];
    const agora = Date.now();
    const inicio = Math.floor(agora / janelaMs) * janelaMs;
    const count = await this.incrementaDrip(tenantId, no.id, new Date(inicio));
    if (count <= porJanela) {
      return { saida: { liberado: true, posicaoNaJanela: count, limite: porJanela } };
    }
    // lote cheio: aguarda a virada da janela e reprocessa este nó
    return {
      esperarMs: inicio + janelaMs - agora,
      mesmoNo: true,
      saida: { liberado: false, posicaoNaJanela: count, aguardandoProximaJanela: true },
    };
  }

  /** UPSERT atômico do contador da janela → devolve a nova contagem. */
  private async incrementaDrip(tenantId: string, noId: string, inicio: Date): Promise<number> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ count: number }[]>`
        INSERT INTO workflow_drip_counters (tenant_id, node_id, window_start, count)
        VALUES (${tenantId}::uuid, ${noId}, ${inicio}, 1)
        ON CONFLICT (tenant_id, node_id, window_start)
        DO UPDATE SET count = workflow_drip_counters.count + 1
        RETURNING count`;
      return Number(rows[0]?.count ?? 1);
    });
  }

  /** FNV-1a: hash estável e determinístico (não depende de plataforma nem de seed). */
  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  private ramoBate(ramo: Ramo, ctx: Contexto): boolean {
    if (!ramo.regras.length) return ramo.juncao === 'NONE'; // ramo "else"
    const resultados = ramo.regras.map((r) => this.regraBate(r, ctx));
    if (ramo.juncao === 'AND') return resultados.every(Boolean);
    if (ramo.juncao === 'OR') return resultados.some(Boolean);
    return !resultados.some(Boolean); // NONE = nenhuma regra bate
  }

  private regraBate(regra: Regra, ctx: Contexto): boolean {
    const bruto = this.valorDoCampo(regra.campo, ctx);
    const alvo = (regra.valor ?? '').toLowerCase();
    const existe = bruto !== undefined && bruto !== null && String(bruto) !== '';

    switch (regra.operador) {
      case 'existe': return existe;
      case 'nao_existe': return !existe;
      case 'maior': return this.comparar(bruto, regra.valor, ctx) > 0;
      case 'menor': return this.comparar(bruto, regra.valor, ctx) < 0;
      default: break;
    }

    // Listas (tags, multiselect): "contém" = tem o ITEM, não um pedaço de texto
    // ("vip" não casa com a tag "vipgold"). Igual/diferente já eram por item.
    if (Array.isArray(bruto) && (regra.operador === 'contem' || regra.operador === 'nao_contem')) {
      const tem = bruto.some((v) => String(v).trim().toLowerCase() === alvo.trim());
      return regra.operador === 'contem' ? tem : !tem;
    }

    // texto e listas comparam sem diferenciar maiúscula/acento de digitação
    const txt = Array.isArray(bruto) ? bruto.join(' ').toLowerCase() : String(bruto ?? '').toLowerCase();
    switch (regra.operador) {
      case 'igual': return Array.isArray(bruto) ? bruto.some((v) => String(v).toLowerCase() === alvo) : txt === alvo;
      case 'diferente': return Array.isArray(bruto) ? !bruto.some((v) => String(v).toLowerCase() === alvo) : txt !== alvo;
      case 'contem': return txt.includes(alvo);
      case 'nao_contem': return !txt.includes(alvo);
      default: return false;
    }
  }

  /**
   * Maior/menor: número com número; senão, data com data (campo personalizado
   * de data, `agora.data`). Sem comparação possível = NaN (nenhum dos dois casa).
   */
  private comparar(bruto: unknown, valor: string | undefined, ctx: Contexto): number {
    const a = Number(bruto);
    const b = Number(valor);
    if (bruto !== null && bruto !== '' && valor !== undefined && valor !== '' && Number.isFinite(a) && Number.isFinite(b)) return a - b;
    const fuso = fusoOuPadrao(ctx.fuso);
    const da = lerData(bruto, fuso);
    const db = lerData(valor, fuso);
    if (da && db) return da.instante.getTime() - db.instante.getTime();
    return Number.NaN;
  }

  /** `contato.tags` / `negocio.valor` / `mensagem.texto` → valor do contexto. */
  private valorDoCampo(campo: string, ctx: Contexto): unknown {
    // Dia da semana / hora / data AGORA no fuso do fluxo (Q3.1).
    if (campo.startsWith('agora.')) return agoraNoFuso(campo, fusoOuPadrao(ctx.fuso));
    // Primeiro nome para saudação ("Oii, Ana!"). Nome que é só telefone (contato
    // criado pelo WhatsApp sem nome) vira vazio — melhor que "Olá, 5541999…!".
    if (campo === 'contato.primeiroNome') {
      const primeiro = (ctx.contato?.nome ?? '').trim().split(/\s+/)[0] ?? '';
      if (!primeiro || /^[+\d()\s-]+$/.test(primeiro)) return '';
      return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
    }
    return campo.split('.').reduce<unknown>((acc, parte) => {
      if (acc && typeof acc === 'object' && parte in (acc as object)) return (acc as Record<string, unknown>)[parte];
      return undefined;
    }, ctx as unknown);
  }

  private irPara(no: No, grafo: Grafo): ResultadoNo {
    const { alvoNoId } = no.config as { alvoNoId: string };
    if (!grafo.nos.some((n) => n.id === alvoNoId)) throw new Error(`"Ir para" aponta para nó inexistente: ${alvoNoId}`);
    return { irPara: alvoNoId, saida: { pulouPara: alvoNoId } };
  }

  // ------------------------------------------------------------------- ações

  private async enviarSms(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { texto } = no.config as { texto: string };
    const contato = ctx.contato;
    if (!contato) throw new Error('nó de SMS sem contato no contexto');

    const corpo = this.interpolar(texto, ctx);
    const conversationId = await this.acharOuCriarConversa(tenantId, contato.id, contato.nome);
    // Marca a mensagem como vinda DESTA automação (migration 036) — sem isto
    // o Inbox mostrava um envio de workflow idêntico a um atendente digitando.
    const autor: AutorEnvio = ctx.workflowId ? { tipo: 'automacao', workflowId: ctx.workflowId } : { tipo: 'humano' };
    const r = await this.mensagens.send(tenantId, conversationId, corpo, ctx.executionKey, ctx.runStartedAt, autor);

    if (r.status === 'pending') throw new Error('messaging_provider_rate_limited');
    if (r.status === 'cancelled') return { encerrar: true, saida: { status: r.status } };
    if (r.status !== 'sent') throw new UnrecoverableError(`message_delivery_${r.status}`);

    // Gating (ADR-0008): sem credencial, a mensagem FICA GRAVADA e o passo é
    // registrado como pendente — não é erro do workflow, é credencial faltando.
    return {
      saida: { messageId: r.id, status: r.status, missing: r.missing, texto: corpo },
      contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status: r.status } } },
    };
  }

  /**
   * Aviso no WhatsApp da EQUIPE (não do contato). Idempotente pela chave do
   * passo: retry do BullMQ não repete o aviso. Sem canal/credencial, o passo
   * falha de forma explícita — aviso interno perdido em silêncio é pior.
   */
  private async notificarEquipe(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { telefone, texto } = no.config as { telefone: string; texto: string };
    if (!ctx.executionKey) throw new UnrecoverableError('notificacao_equipe_sem_chave_de_execucao');
    const corpo = this.interpolar(texto, ctx);
    const r = await this.mensagens.notificarNumero(tenantId, soDigitos(telefone), corpo, `${ctx.executionKey}:equipe`);
    if (r.status === 'pending') throw new Error('messaging_provider_rate_limited');
    if (r.status !== 'sent') throw new UnrecoverableError(`notificacao_equipe_${r.status}`);
    return { saida: { status: r.status, texto: corpo } };
  }

  private async acharOuCriarConversa(tenantId: string, contactId: string, nome: string): Promise<string> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existente = await tx.conversation.findFirst({ where: { contactId, canal: 'WhatsApp' }, select: { id: true } });
      if (existente) return existente.id;
      const nova = await tx.conversation.create({
        data: { tenantId, contactId, nome, canal: 'WhatsApp' },
        select: { id: true },
      });
      return nova.id;
    });
  }

  /**
   * Pedido de avaliação (Q4.4). Idempotente pela chave do passo: retry não
   * manda dois pedidos. Sem canal configurado o passo fica `config_required`
   * (mesma regra do e-mail); sem configuração de avaliação é erro definitivo.
   */
  private async pedirAvaliacao(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { canal, mensagem } = no.config as { canal: 'whatsapp' | 'email'; mensagem?: string };
    if (!ctx.contato) throw new UnrecoverableError('nó "pedir avaliação" sem contato no contexto');
    if (!ctx.executionKey) throw new UnrecoverableError('pedido_avaliacao_sem_chave_de_execucao');
    if (!this.avaliacoes) throw new UnrecoverableError('módulo de avaliações indisponível');
    let r;
    try {
      r = await this.avaliacoes.pedir(tenantId, { contactId: ctx.contato.id, canal, ...(mensagem?.trim() ? { mensagem: mensagem.trim() } : {}) }, { tipo: 'automacao', workflowId: ctx.workflowId, idempotencyKey: `${ctx.executionKey}:avaliacao` });
    } catch (e) {
      // 400/404 (sem configuração, opt-out, sem telefone): repetir não resolve.
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500) throw new UnrecoverableError(`pedir_avaliacao: ${(e as Error).message}`);
      throw e;
    }
    if (r.status === 'adiar') throw new Error('messaging_provider_rate_limited');
    if (r.status === 'falhou') throw new UnrecoverableError(`pedir_avaliacao_${r.erro ?? 'falhou'}`);
    return {
      saida: { status: r.status === 'enviado' ? 'sent' : 'config_required', pedidoId: r.pedido.id, canal, missing: r.missing ?? [] },
      contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status: r.status, pedidoId: r.pedido.id } } },
    };
  }

  private async enviarEmail(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { assunto, corpo } = no.config as { assunto: string; corpo: string };
    const contato = ctx.contato;
    if (!contato) throw new Error('nó de e-mail sem contato no contexto');
    if (!contato.email) throw new Error('contato sem e-mail: não há destinatário');
    // "Não perturbe" (opted_out_at) vale para e-mail também, não só WhatsApp:
    // lido do banco agora, não do contexto do gatilho (pode ter mudado na espera).
    const optOut = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id: contato.id }, select: { optedOutAt: true } }));
    if (optOut?.optedOutAt) {
      return { saida: { status: 'cancelled', motivo: 'nao_perturbe', para: contato.email }, contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status: 'cancelled' } } } };
    }

    const subject = this.interpolar(assunto, ctx);
    const text = this.interpolar(corpo, ctx);
    const r = await this.mailer.send({ to: contato.email, subject, text, html: this.emailHtml(text) });

    // Gating (ADR-0008): sem SMTP_URL o e-mail fica PENDENTE — não é erro do
    // fluxo, é credencial faltando. Já uma falha REAL de SMTP (erro, não missing)
    // levanta exceção de propósito: deixa o retry/DLQ do BullMQ reagir.
    if (!r.sent && !r.missing?.length) throw new Error(`falha ao enviar e-mail: ${r.erro ?? 'desconhecido'}`);
    const status = r.sent ? 'sent' : 'config_required';
    return {
      saida: { status, missing: r.missing, assunto: subject, para: contato.email },
      contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status } } },
    };
  }

  /** Corpo do e-mail: escapa HTML e vira <br> nas quebras. Texto puro no fallback. */
  private emailHtml(texto: string): string {
    const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">${escapado.replace(/\n/g, '<br>')}</div>`;
  }

  /**
   * Nó de IA: a Nyro analisa o contexto e o resultado vira variável (usável em
   * `{{variaveis.x}}`). **Gated:** sem chave, o passo fica `config_required` e o
   * fluxo segue — nunca inventa resposta.
   */
  private async ia(no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { tarefa, instrucao, salvarEm } = no.config as { tarefa: TarefaIA; instrucao: string; salvarEm?: string };
    const chave = salvarEm || 'ia';
    if (!this.ai.configurado()) {
      return {
        saida: { status: 'config_required', missing: this.ai.missing() },
        contexto: { passos: { ...(ctx.passos ?? {}), [no.id]: { status: 'config_required' } } },
      };
    }
    const r = await this.ai.executar({ tarefa, instrucao, contexto: this.resumoContexto(ctx) });
    return {
      saida: { resultado: r.texto, tarefa },
      contexto: { variaveis: { ...(ctx.variaveis ?? {}), [chave]: r.texto } },
    };
  }

  /** Contexto do run em texto plano, para a IA analisar (só o que existe). */
  private resumoContexto(ctx: Contexto): string {
    const l: string[] = [];
    if (ctx.contato) l.push(`Contato: ${ctx.contato.nome} · tags: ${ctx.contato.tags?.join(', ') || '—'} · valor estimado: ${ctx.contato.valor}`);
    if (ctx.negocio) l.push(`Negócio: ${ctx.negocio.titulo} · valor: ${ctx.negocio.valor}`);
    if (ctx.mensagem) l.push(`Última mensagem do contato: "${ctx.mensagem.texto}"`);
    if (ctx.variaveis && Object.keys(ctx.variaveis).length) l.push(`Variáveis: ${JSON.stringify(ctx.variaveis)}`);
    return l.join('\n') || 'Sem dados de contexto.';
  }

  /** Formata um valor (telefone/moeda/caixa) e guarda numa variável. */
  private formatarTexto(no: No, ctx: Contexto): ResultadoNo {
    const { valor, formato, salvarEm } = no.config as { valor: string; formato: string; salvarEm?: string };
    const out = this.aplicaFormato(this.interpolar(valor, ctx), formato);
    const chave = salvarEm || 'texto';
    return { saida: { [chave]: out }, contexto: { variaveis: { ...(ctx.variaveis ?? {}), [chave]: out } } };
  }

  private aplicaFormato(v: string, formato: string): string {
    switch (formato) {
      case 'maiuscula': return v.toUpperCase();
      case 'minuscula': return v.toLowerCase();
      case 'capitalizar': return v.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      case 'digitos': return soDigitos(v);
      case 'telefone': return this.formataTelefone(soDigitos(v));
      case 'moeda': {
        const n = Number(String(v).replace(/[^\d.-]/g, ''));
        return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n) : v;
      }
      default: return v;
    }
  }

  /** Telefone BR legível a partir dos dígitos (tira DDI 55 quando presente). */
  private formataTelefone(d: string): string {
    const s = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
    if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
    if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
    return d;
  }

  /** Guarda um valor (interpolado) numa variável do run, para nós seguintes. */
  private definirVariavel(no: No, ctx: Contexto): ResultadoNo {
    const { nome, valor } = no.config as { nome: string; valor: string };
    const interpolado = this.interpolar(valor, ctx);
    return {
      saida: { [nome]: interpolado },
      contexto: { variaveis: { ...(ctx.variaveis ?? {}), [nome]: interpolado } },
    };
  }

  private async mexerTag(tenantId: string, no: No, ctx: Contexto, acao: 'add' | 'remove'): Promise<ResultadoNo> {
    const { tag } = no.config as { tag: string };
    const contato = ctx.contato;
    if (!contato) throw new Error('nó de tag sem contato no contexto');

    const atuais = contato.tags ?? [];
    const tags = acao === 'add'
      ? Array.from(new Set([...atuais, tag]))
      : atuais.filter((t) => t.toLowerCase() !== tag.toLowerCase());

    await this.crm.updateContact(tenantId, contato.id, { tags });
    return { saida: { tags }, contexto: { contato: { ...contato, tags } } };
  }

  private async criarOportunidade(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { titulo, stageId, valor, origem } = no.config as { titulo: string; stageId: string; valor?: number; origem?: string };
    const r = await this.crm.createDeal(tenantId, {
      titulo: this.interpolar(titulo, ctx),
      stageId,
      contactId: ctx.contato?.id,
      valor: valor ?? 0,
      origem: origem ?? 'Automação',
    });
    return { saida: { dealId: r.id }, contexto: { negocio: { id: r.id, titulo, valor: valor ?? 0, stageId, origem: origem ?? 'Automação' } } };
  }

  private async moverEtapa(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { stageId } = no.config as { stageId: string };
    if (!ctx.negocio) throw new Error('nó "mover etapa" sem negócio no contexto');
    await this.crm.moveDeal(tenantId, ctx.negocio.id, stageId);
    return { saida: { dealId: ctx.negocio.id, stageId }, contexto: { negocio: { ...ctx.negocio, stageId } } };
  }

  private async criarTarefa(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { titulo, prioridade, emDias } = no.config as { titulo: string; prioridade?: string; emDias?: number };
    const dueAt = emDias && emDias > 0 ? new Date(Date.now() + emDias * 86_400_000).toISOString() : undefined;
    // a automação age como sistema: sem identidade humana, o assignee fica vazio
    const r = await this.tarefas.create(tenantId, '', {
      titulo: this.interpolar(titulo, ctx),
      prioridade: prioridade ?? 'media',
      dueAt,
      contactId: ctx.contato?.id,
      dealId: ctx.negocio?.id,
    });
    return { saida: { taskId: r.id } };
  }

  private async criarNota(tenantId: string, no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { corpo } = no.config as { corpo: string };
    if (!ctx.contato) throw new Error('nó de nota sem contato no contexto');
    // identityId vazio: a nota é do sistema, e o serviço grava o autor como tal
    const r = await this.notas.create(tenantId, '', { corpo: this.interpolar(corpo, ctx), contactId: ctx.contato.id });
    return { saida: { noteId: r.id } };
  }

  private async webhook(no: No, ctx: Contexto): Promise<ResultadoNo> {
    const { url, metodo, corpo } = no.config as { url: string; metodo?: string; corpo?: string };
    const alvo = new URL(url);
    // SSRF: automação do tenant não pode alcançar rede interna nem metadata cloud
    if (this.enderecoInterno(alvo.hostname)) throw new Error(`webhook bloqueado: ${alvo.hostname} é endereço interno`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(alvo, {
        method: metodo ?? 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'KHUB-Automations/1.0' },
        body: (metodo ?? 'POST') === 'GET' ? undefined : (corpo ? this.interpolar(corpo, ctx) : JSON.stringify({ contato: ctx.contato, negocio: ctx.negocio })),
        signal: controller.signal,
      });
      const texto = (await res.text().catch(() => '')).slice(0, 500);
      if (!res.ok) throw new Error(`webhook ${res.status}: ${texto}`);
      return { saida: { status: res.status, resposta: texto } };
    } finally {
      clearTimeout(timeout);
    }
  }

  private enderecoInterno(host: string): boolean {
    const h = host.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h === '169.254.169.254') return true;
    return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$)/.test(h);
  }

  // ----------------------------------------------------------------- helpers

  /** `Olá {{contato.nome}}` → valor do contexto. Placeholder sem valor vira ''. */
  private interpolar(texto: string, ctx: Contexto): string {
    const r = texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, campo: string) => {
      const v = this.valorDoCampo(campo, ctx);
      return v === undefined || v === null ? '' : String(v);
    });
    // Variável vazia não deixa pontuação órfã: "Oii, !" → "Oii!".
    return r.replace(/,\s*([!?.])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  }
}

/** Ações sem efeito fora do run: rodam de verdade também no teste. */
const ACOES_SEGURAS_NO_TESTE = new Set<string>(['acao.ia', 'acao.definir_variavel', 'acao.formatar_texto']);

/** `5518991234567` → `+55 18 •••••-2039`: o log mostra o destino sem expor o número. */
function mascararNumero(d: string): string {
  return d.length >= 8 ? `+${d.slice(0, 2)} ${d.slice(2, 4)} •••••-${d.slice(-4)}` : '••••';
}
