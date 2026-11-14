import { z } from 'zod';

/**
 * Catálogo congelado dos nós do workflow (ADR-0012 — fecha a LACUNA do PRD §7.1;
 * ampliado em E.2 e na trilha W de paridade de motor). Nó fora daqui não existe:
 * a validação da publicação recusa o grafo. Conta atual: 16 gatilhos + 9 controle
 * + 19 ações = 44 (Q3.1/Q3.2 somaram esperar até, meta, 4 ações e 4 gatilhos).
 */
export const TIPOS_NO = [
  // Gatilhos (6) — entram o run
  'gatilho.contato_criado',
  'gatilho.etapa_mudou',
  'gatilho.mensagem_recebida',
  'gatilho.tag_adicionada',
  'gatilho.negocio_criado',
  'gatilho.negocio_status',
  'gatilho.webhook',
  // Agenda (Q2.4 / RV-05.2) — eventos do outbox da migration 054
  'gatilho.agendamento_criado',
  'gatilho.agendamento_confirmado',
  'gatilho.faltou',
  'gatilho.agendamento_cancelado',
  'gatilho.lembrete_agendamento',
  // Tempo, formulário e pagamento (Q3.2 / W3)
  'gatilho.agendado',
  'gatilho.data_contato',
  'gatilho.formulario_enviado',
  'gatilho.pagamento_recebido',
  // Controle (7)
  'controle.esperar',
  'controle.esperar_resposta',
  'controle.condicao',
  'controle.split',
  'controle.drip',
  'controle.ir_para',
  'controle.encerrar',
  // Q3.1: esperar até data/campo/evento e meta (goal)
  'controle.esperar_ate',
  'controle.meta',
  // Ações (10)
  'acao.enviar_sms',
  'acao.enviar_email',
  'acao.notificar_equipe',
  'acao.adicionar_tag',
  'acao.remover_tag',
  'acao.atualizar_contato',
  'acao.criar_oportunidade',
  'acao.mover_etapa',
  'acao.criar_tarefa',
  'acao.criar_nota',
  'acao.definir_variavel',
  'acao.formatar_texto',
  'acao.ia',
  'acao.chamar_workflow',
  'acao.webhook',
  // Q4.4
  'acao.pedir_avaliacao',
  // Q3.1 (+ W4)
  'acao.remover_de_fluxo',
  'acao.atribuir_usuario',
  'acao.ativar_ia',
  'acao.passar_humano',
  'acao.nao_perturbe',
  'acao.atualizar_negocio',
] as const;

export type TipoNo = (typeof TIPOS_NO)[number];

export const GATILHOS = TIPOS_NO.filter((t) => t.startsWith('gatilho.')) as readonly TipoNo[];
export const ehGatilho = (t: string): boolean => t.startsWith('gatilho.');

// ---------------------------------------------------------------------------
// Config por tipo de nó
// ---------------------------------------------------------------------------

/** Comparadores do If/Else. Espelham o que a UI oferece. */
export const OPERADORES = ['igual', 'diferente', 'contem', 'nao_contem', 'existe', 'nao_existe', 'maior', 'menor'] as const;
export type Operador = (typeof OPERADORES)[number];

export const regraSchema = z.object({
  campo: z.string().min(1),        // ex.: contato.tag, contato.email, mensagem.texto, negocio.valor
  operador: z.enum(OPERADORES),
  valor: z.string().optional(),
});

/** Ramo do If/Else. `juncao` = AND | OR | NONE. */
export const ramoSchema = z.object({
  id: z.string().min(1),
  rotulo: z.string().default('Ramo'),
  juncao: z.enum(['AND', 'OR', 'NONE']).default('AND'),
  regras: z.array(regraSchema).default([]),
});

/** Tipos de compromisso da agenda (espelha TIPOS_AGENDA, migration 054). */
export const TIPOS_COMPROMISSO = ['reuniao', 'call', 'demo', 'visita', 'followup', 'outro'] as const;

/** Filtro dos gatilhos de agenda. Vazio = qualquer compromisso. */
const filtroAgendaSchema = z.object({
  tipo: z.enum(TIPOS_COMPROMISSO).optional(),
  responsavelId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Q3.1 / Q3.2: blocos compartilhados (tempo, evento, campos personalizados)
// ---------------------------------------------------------------------------

/** "HH:MM" 24h. */
export const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "AAAA-MM-DD" (mesmo formato do campo personalizado tipo data, db/053). */
export const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Chave de campo personalizado (espelha CHAVE_RE de crm/custom-fields.ts). */
export const CHAVE_CAMPO_RE = /^[a-z][a-z0-9_]{0,49}$/;

/** Fuso IANA válido para o Intl (ex.: America/Sao_Paulo). */
export function fusoEhValido(f: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: f });
    return true;
  } catch {
    return false;
  }
}
const fusoSchema = z.string().max(60).refine(fusoEhValido, 'fuso horário inválido');

/**
 * Eventos que uma espera ("Esperar até" no modo evento) ou uma meta podem
 * aguardar. Cada um vem de um evento de domínio do outbox — ver
 * `eventos-espera.ts` (EVENTO_DOMINIO_PARA_ESPERA).
 */
export const EVENTOS_ESPERA = [
  'mensagem_recebida',
  'tag_adicionada',
  'etapa_mudou',
  'agendamento_criado',
  'agendamento_confirmado',
  'negocio_status',
  'formulario_enviado',
  'pagamento_recebido',
] as const;
export type EventoEspera = (typeof EVENTOS_ESPERA)[number];

/** Evento + filtro opcional (vazio = qualquer). Só o filtro do evento escolhido vale. */
const filtroEvento = {
  evento: z.enum(EVENTOS_ESPERA),
  tag: z.string().max(40).optional(),
  stageId: z.string().uuid().optional(),
  status: z.enum(['ganho', 'perdido']).optional(),
  formId: z.string().uuid().optional(),
  valorMinimo: z.number().min(0).optional(),
  contem: z.string().max(200).optional(),
};
export interface FiltroEvento {
  evento: EventoEspera;
  tag?: string;
  stageId?: string;
  status?: 'ganho' | 'perdido';
  formId?: string;
  valorMinimo?: number;
  contem?: string;
}

/**
 * Campo de data usado em "Esperar até" (modo campo): agendamento do gatilho,
 * próxima ação do contato ou campo personalizado do contato/negócio.
 * `agendamento.data` é aceito como apelido de `agendamento.inicio`.
 */
export const CAMPO_DATA_ESPERA_RE = /^(agendamento\.(inicio|fim|data)|contato\.proximaAcaoAt|(contato|negocio)\.campos\.[a-z][a-z0-9_]{0,49})$/;
/** Campo de data do gatilho "Data do contato": criação ou campo personalizado do contato. */
export const CAMPO_DATA_GATILHO_RE = /^(contato\.criadoEm|contato\.campos\.[a-z][a-z0-9_]{0,49})$/;

const campoValorSchema = z.object({
  chave: z.string().regex(CHAVE_CAMPO_RE, 'chave de campo personalizado inválida'),
  /** Aceita {{...}}. Vazio limpa o campo. Lista (várias opções): separe por vírgula. */
  valor: z.string().max(2000),
});

const esperarAteSchema = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('data'),
    data: z.string().regex(DATA_RE, 'data no formato AAAA-MM-DD'),
    hora: z.string().regex(HORA_RE, 'hora no formato HH:MM').default('09:00'),
    seJaPassou: z.enum(['seguir', 'encerrar']).default('seguir'),
  }),
  z.object({
    modo: z.literal('campo'),
    campo: z.string().regex(CAMPO_DATA_ESPERA_RE, 'campo de data não suportado'),
    deslocamento: z.number().int().min(0).max(100_000).default(0),
    unidade: z.enum(['minutos', 'horas', 'dias']).default('dias'),
    direcao: z.enum(['antes', 'depois']).default('antes'),
    /** Hora do dia (só com unidade "dias"). Vazio = mantém a hora do campo. */
    hora: z.string().regex(HORA_RE, 'hora no formato HH:MM').optional(),
    seJaPassou: z.enum(['seguir', 'encerrar']).default('seguir'),
  }),
  z.object({
    modo: z.literal('evento'),
    ...filtroEvento,
    duracao: z.number().int().positive(),
    unidade: z.enum(['minutos', 'horas', 'dias']),
  }),
]);

const gatilhoAgendadoSchema = z.object({
  /** `uma_vez`: dispara uma única vez em `data` + `hora` (ex.: lançamento, evento, Black Friday). */
  frequencia: z.enum(['uma_vez', 'diario', 'semanal', 'mensal']).default('diario'),
  hora: z.string().regex(HORA_RE, 'hora no formato HH:MM').default('09:00'),
  /** Só na `uma_vez`: dia do disparo (AAAA-MM-DD) no fuso do fluxo. */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD').optional(),
  /** 0 = domingo ... 6 = sábado (só no semanal). */
  diasSemana: z.array(z.number().int().min(0).max(6)).max(7).default([1]),
  /** Dia do mês (só no mensal). 31 em mês curto = último dia. */
  diaMes: z.number().int().min(1).max(31).default(1),
  /** Vazio = fuso do fluxo. */
  fuso: fusoSchema.optional(),
  /** `sem_contato`: um run por janela. `segmento`: um run por contato do segmento. */
  alvo: z.enum(['sem_contato', 'segmento']).default('sem_contato'),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  stageId: z.string().uuid().optional(),
}).superRefine((c, ctx) => {
  if (c.frequencia === 'semanal' && !c.diasSemana.length) ctx.addIssue({ code: 'custom', path: ['diasSemana'], message: 'escolha ao menos um dia da semana' });
  if (c.frequencia === 'uma_vez' && !c.data) ctx.addIssue({ code: 'custom', path: ['data'], message: 'escolha o dia do disparo' });
  if (c.alvo === 'segmento' && !c.tags.length && !c.stageId) ctx.addIssue({ code: 'custom', path: ['alvo'], message: 'segmento precisa de tag ou etapa (sem filtro dispararia para a base inteira)' });
});

const gatilhoDataContatoSchema = z.object({
  campo: z.string().regex(CAMPO_DATA_GATILHO_RE, 'campo de data não suportado'),
  quando: z.enum(['antes', 'no_dia', 'depois']).default('no_dia'),
  dias: z.number().int().min(0).max(365).default(0),
  hora: z.string().regex(HORA_RE, 'hora no formato HH:MM').default('09:00'),
  /** Repete todo ano (aniversário): compara só dia e mês. */
  anual: z.boolean().default(true),
  fuso: fusoSchema.optional(),
}).superRefine((c, ctx) => {
  if (c.quando !== 'no_dia' && c.dias < 1) ctx.addIssue({ code: 'custom', path: ['dias'], message: 'informe quantos dias antes ou depois' });
});

const configs: Record<TipoNo, z.ZodTypeAny> = {
  // ---- Gatilhos ----
  'gatilho.contato_criado': z.object({
    origem: z.string().optional(), // filtra por origem do lead (ex.: "Meta Lead Ads")
  }),
  'gatilho.etapa_mudou': z.object({
    stageId: z.string().uuid().optional(), // vazio = qualquer etapa
  }),
  'gatilho.mensagem_recebida': z.object({
    canal: z.string().default('WhatsApp'),
    contem: z.string().optional(),
  }),
  'gatilho.tag_adicionada': z.object({
    tag: z.string().min(1),
  }),
  'gatilho.negocio_criado': z.object({
    stageId: z.string().uuid().optional(),
  }),
  /** Dispara quando o negócio muda de status. Vazio = qualquer (ganho ou perdido). */
  'gatilho.negocio_status': z.object({
    status: z.enum(['ganho', 'perdido']).optional(),
  }),
  /** Entrada genérica: qualquer sistema externo chama a URL do workflow. */
  'gatilho.webhook': z.object({
    /** Como achar o contato no payload recebido. */
    identificarPor: z.enum(['email', 'telefone']).default('email'),
    campo: z.string().min(1).default('email'),
    /** Sem contato correspondente: cria um novo ou ignora o evento. */
    seNaoAchar: z.enum(['criar', 'ignorar']).default('criar'),
  }),

  // ---- Gatilhos de agenda (filtro opcional por tipo e responsável) ----
  'gatilho.agendamento_criado': filtroAgendaSchema,
  'gatilho.agendamento_confirmado': filtroAgendaSchema,
  'gatilho.faltou': filtroAgendaSchema,
  'gatilho.agendamento_cancelado': filtroAgendaSchema,
  /** Varredura D-1: dispara quando faltam até 24h para um compromisso `agendado`. */
  'gatilho.lembrete_agendamento': filtroAgendaSchema,

  // ---- Gatilhos por tempo, formulário e pagamento (Q3.2) ----
  'gatilho.agendado': gatilhoAgendadoSchema,
  'gatilho.data_contato': gatilhoDataContatoSchema,
  /** Vazio = qualquer formulário. */
  'gatilho.formulario_enviado': z.object({ formId: z.string().uuid().optional() }),
  /** Valor mínimo em reais. Vazio = qualquer pagamento. */
  'gatilho.pagamento_recebido': z.object({ valorMinimo: z.number().min(0).optional() }),

  // ---- Controle ----
  'controle.esperar': z.object({
    duracao: z.number().int().positive(),
    unidade: z.enum(['segundos', 'minutos', 'horas', 'dias']),
  }),
  /**
   * Espera o contato responder no WhatsApp. Dois ramos fixos: `resposta` e
   * `timeout` — é o que evita o clássico "mandei follow-up para quem já tinha
   * respondido".
   */
  'controle.esperar_resposta': z.object({
    duracao: z.number().int().positive(),
    unidade: z.enum(['minutos', 'horas', 'dias']),
  }),
  'controle.encerrar': z.object({
    motivo: z.string().max(120).optional(),
  }),
  'controle.condicao': z.object({
    ramos: z.array(ramoSchema).min(1),
  }),
  /**
   * Teste A/B: distribui contatos entre caminhos por PESO. Determinístico por
   * hash(contato+nó) — o mesmo contato cai sempre no mesmo ramo (idempotente em
   * re-run; nada de Math.random, que quebraria a reentrada).
   */
  'controle.split': z.object({
    ramos: z.array(z.object({
      id: z.string().min(1),
      rotulo: z.string().default('Variante'),
      peso: z.number().int().min(1).max(100).default(1),
    })).min(2),
  }),
  /**
   * Drip: libera no máximo `porJanela` contatos por `janela` de tempo — o resto
   * espera a próxima janela e re-entra no nó. Evita queimar o canal num disparo
   * grande. O throttle sobrevive entre runs (tabela `workflow_drip_counters`).
   */
  'controle.drip': z.object({
    porJanela: z.number().int().min(1).max(100000),
    janela: z.enum(['minuto', 'hora', 'dia']),
  }),
  'controle.ir_para': z.object({
    alvoNoId: z.string().min(1),
  }),

  // ---- Ações ----
  /**
   * "SMS" de propósito: a entrega sai pelo WhatsApp via STEVO, que é API **não
   * oficial** — sem template aprovado, sem mídia, sem garantia de sessão. Chamar
   * de "WhatsApp" prometeria o que o canal oficial dá e este não dá.
   */
  'acao.enviar_sms': z.object({
    texto: z.string().min(1).max(1000),
  }),
  /**
   * E-mail transacional pelo canal oficial (SMTP). Diferente do "SMS", aqui há
   * assunto e corpo — e a entrega é gated em `SMTP_URL` (degrada, não quebra).
   */
  'acao.enviar_email': z.object({
    assunto: z.string().min(1).max(200),
    corpo: z.string().min(1).max(10000),
  }),
  /**
   * Avisa a EQUIPE no WhatsApp (não o contato): ex. "+1 lead que pagou o sinal".
   * Equivale à "Notificação interna" do GHL, que mandava SMS para o número da
   * equipe. Mesmas travas do envio ao contato (instância do tenant, dev lock,
   * idempotência) — ver MessagesService.notificarNumero.
   */
  'acao.notificar_equipe': z.object({
    telefone: z.string().regex(/^\+?\d{10,15}$/, 'telefone com DDI e DDD, só dígitos'),
    texto: z.string().min(1).max(1000),
  }),
  'acao.adicionar_tag': z.object({ tag: z.string().min(1).max(40) }),
  'acao.remover_tag': z.object({ tag: z.string().min(1).max(40) }),
  /**
   * Um campo fixo (`campo` + `valor`), campos personalizados (validados pelo
   * tipo da definição, db/053) e tags a adicionar/remover. Ao menos um.
   */
  'acao.atualizar_contato': z.object({
    campo: z.enum(['nome', 'email', 'telefone', 'empresa', 'tag', 'valorEstimado']).optional(),
    valor: z.string().optional(),
    campos: z.array(campoValorSchema).max(50).default([]),
    tagsAdicionar: z.array(z.string().min(1).max(40)).max(20).default([]),
    tagsRemover: z.array(z.string().min(1).max(40)).max(20).default([]),
  }).superRefine((c, ctx) => {
    if (c.campo && c.valor === undefined) ctx.addIssue({ code: 'custom', path: ['valor'], message: 'informe o novo valor' });
    if (!c.campo && !c.campos.length && !c.tagsAdicionar.length && !c.tagsRemover.length) {
      ctx.addIssue({ code: 'custom', path: ['campo'], message: 'escolha ao menos um campo ou tag para atualizar' });
    }
  }),
  'acao.criar_oportunidade': z.object({
    titulo: z.string().min(1).max(200),
    stageId: z.string().uuid(),
    valor: z.number().min(0).optional(),
    origem: z.string().max(80).optional(),
  }),
  'acao.mover_etapa': z.object({ stageId: z.string().uuid() }),
  'acao.criar_tarefa': z.object({
    titulo: z.string().min(1).max(200),
    prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
    emDias: z.number().int().min(0).max(365).default(0),
  }),
  'acao.criar_nota': z.object({
    corpo: z.string().min(1).max(2000),
  }),
  /** Guarda um valor (com `{{...}}`) numa variável reutilizável no fluxo. */
  'acao.definir_variavel': z.object({
    nome: z.string().min(1).max(60),
    valor: z.string().max(1000),
  }),
  /**
   * Nó de IA (gated `ANTHROPIC_API_KEY`): a Nyro classifica/pontua/resume/
   * responde/extrai a partir do contexto e guarda o resultado numa variável,
   * usável depois em `{{variaveis.x}}` (mensagens, condições).
   */
  'acao.ia': z.object({
    tarefa: z.enum(['classificar', 'pontuar', 'resumir', 'responder', 'extrair']),
    instrucao: z.string().min(3).max(2000),
    salvarEm: z.string().min(1).max(60).default('ia'),
  }),
  /** Transforma um valor (telefone/moeda/caixa) e guarda numa variável. */
  'acao.formatar_texto': z.object({
    valor: z.string().min(1).max(500),
    formato: z.enum(['maiuscula', 'minuscula', 'capitalizar', 'telefone', 'moeda', 'digitos']),
    salvarEm: z.string().min(1).max(60).default('texto'),
  }),
  /** Encadeia workflows: o contato do contexto entra em outro fluxo. */
  'acao.chamar_workflow': z.object({
    workflowId: z.string().uuid(),
  }),
  'acao.webhook': z.object({
    url: z.string().url(),
    metodo: z.enum(['GET', 'POST']).default('POST'),
    corpo: z.string().max(4000).optional(),
  }),
  /**
   * Pedido de avaliação (Q4.4): manda o link curto rastreável (`/r/:token`) da
   * avaliação configurada em Configurações > Avaliações. `mensagem` vazia usa a padrão.
   */
  'acao.pedir_avaliacao': z.object({
    canal: z.enum(['whatsapp', 'email']).default('whatsapp'),
    mensagem: z.string().max(1000).optional(),
  }),

  // ---- Q3.1 ----
  /** Espera até data fixa, até um campo de data (± deslocamento) ou até um evento (com prazo). */
  'controle.esperar_ate': esperarAteSchema,
  /**
   * Meta (goal): quando o evento acontece para o contato em QUALQUER ponto
   * anterior do fluxo, o run pula para cá (esperas pendentes são canceladas).
   * `seNaoAtingida`: o que fazer quando o contato chega aqui sem a meta.
   */
  'controle.meta': z.object({
    ...filtroEvento,
    seNaoAtingida: z.enum(['seguir', 'esperar', 'encerrar']).default('seguir'),
  }),
  /** `este`: encerra aqui; `outros`: tira dos fluxos escolhidos; `todos`: de todos os outros. */
  'acao.remover_de_fluxo': z.object({
    alvo: z.enum(['este', 'outros', 'todos']).default('este'),
    workflowIds: z.array(z.string().uuid()).max(50).default([]),
  }).superRefine((c, ctx) => {
    if (c.alvo === 'outros' && !c.workflowIds.length) ctx.addIssue({ code: 'custom', path: ['workflowIds'], message: 'escolha ao menos um fluxo' });
  }),
  /** Dono fixo ou rodízio (round-robin) entre membros. Grava `contacts.owner_id` (+ negócio aberto, opcional). */
  'acao.atribuir_usuario': z.object({
    modo: z.enum(['fixo', 'rodizio']).default('fixo'),
    usuarioId: z.string().uuid().optional(),
    usuarios: z.array(z.string().uuid()).max(50).default([]),
    soSemDono: z.boolean().default(false),
    /** Também grava o dono do negócio aberto do contato. */
    negocio: z.boolean().default(false),
  }).superRefine((c, ctx) => {
    if (c.modo === 'fixo' && !c.usuarioId) ctx.addIssue({ code: 'custom', path: ['usuarioId'], message: 'escolha o usuário' });
    if (c.modo === 'rodizio' && !c.usuarios.length) ctx.addIssue({ code: 'custom', path: ['usuarios'], message: 'escolha ao menos um usuário para o rodízio' });
    if (new Set(c.usuarios).size !== c.usuarios.length) ctx.addIssue({ code: 'custom', path: ['usuarios'], message: 'usuário repetido no rodízio' });
  }),
  /** Liga um agente de IA na conversa do contato (vazio = o agente padrão do canal). */
  'acao.ativar_ia': z.object({ agentId: z.string().uuid().optional() }),
  /** Tira a conversa da IA e entrega para a equipe (distribui para quem tem menos conversas). */
  'acao.passar_humano': z.object({ motivo: z.string().max(300).optional() }),
  /** Liga/desliga o "não perturbe" (`contacts.opted_out_at`): bloqueia SMS/WhatsApp e e-mail ao contato. */
  'acao.nao_perturbe': z.object({ ativar: z.boolean().default(true) }),
  /** Atualiza o negócio do contexto. Ao menos uma mudança. */
  'acao.atualizar_negocio': z.object({
    /** Número ou {{...}} que resolva para número (ex.: {{variaveis.total}}). */
    valor: z.string().max(60).optional(),
    status: z.enum(['aberto', 'ganho', 'perdido']).optional(),
    /** Só com status perdido (db/051). */
    motivoPerdaId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    dono: z.enum(['manter', 'usuario', 'contato', 'nenhum']).default('manter'),
    ownerId: z.string().uuid().optional(),
    campos: z.array(campoValorSchema).max(50).default([]),
  }).superRefine((c, ctx) => {
    if (c.dono === 'usuario' && !c.ownerId) ctx.addIssue({ code: 'custom', path: ['ownerId'], message: 'escolha o novo dono' });
    if (c.motivoPerdaId && c.status !== 'perdido') ctx.addIssue({ code: 'custom', path: ['motivoPerdaId'], message: 'motivo de perda só com status perdido' });
    const muda = (c.valor !== undefined && c.valor.trim() !== '') || c.status || c.stageId || c.dono !== 'manter' || c.campos.length;
    if (!muda) ctx.addIssue({ code: 'custom', path: ['status'], message: 'escolha ao menos uma mudança no negócio' });
  }),
};

/** Saídas do "Esperar até" no modo evento. */
export const RAMOS_ESPERAR_EVENTO = [
  { id: 'aconteceu', rotulo: 'Aconteceu' },
  { id: 'expirou', rotulo: 'Prazo expirou' },
] as const;

/** Ramos fixos do "Esperar resposta" — a UI desenha estas duas saídas. */
export const RAMOS_ESPERAR_RESPOSTA = [
  { id: 'resposta', rotulo: 'Respondeu' },
  { id: 'timeout', rotulo: 'Não respondeu' },
] as const;

/**
 * Saídas nomeadas FIXAS do nó (não definidas pelo usuário). "Esperar até" só
 * tem duas saídas no modo evento; nos modos data/campo segue por uma só.
 */
export function ramosFixosDoNo(no: { tipo: string; config?: Record<string, unknown> }): readonly { id: string; rotulo: string }[] | null {
  if (no.tipo === 'controle.esperar_resposta') return RAMOS_ESPERAR_RESPOSTA;
  if (no.tipo === 'controle.esperar_ate' && (no.config as { modo?: unknown } | undefined)?.modo === 'evento') return RAMOS_ESPERAR_EVENTO;
  return null;
}

/** Nó com saídas nomeadas: sem ramo escolhido, não pode cair na saída de outro ramo. */
export function noRamificado(no: { tipo: string; config?: Record<string, unknown> }): boolean {
  return no.tipo === 'controle.condicao' || no.tipo === 'controle.split' || ramosFixosDoNo(no) !== null;
}

/** O que fazer quando o nó falha (PRD §7.2 — fallback por nó). */
export const aoFalharSchema = z.enum(['parar', 'seguir']).default('parar');

export const noSchema = z.object({
  id: z.string().min(1),
  tipo: z.enum(TIPOS_NO),
  rotulo: z.string().optional(),
  posicao: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.unknown()).default({}),
  aoFalhar: aoFalharSchema.optional(),
});

export const arestaSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  para: z.string().min(1),
  /** Ramo de origem no If/Else (id do ramo). Ausente = saída única. */
  ramo: z.string().optional(),
});

/**
 * Nota de texto no canvas (Q3.3). Mora FORA de `nos` de propósito: o executor,
 * o validador e o publicar só percorrem `nos`/`arestas`, então uma nota nunca
 * vira passo, nunca recebe conexão e nunca bloqueia a publicação. É anotação
 * da equipe, versionada junto com o grafo.
 */
export const notaSchema = z.object({
  id: z.string().min(1).max(40),
  texto: z.string().max(2000).default(''),
  posicao: z.object({ x: z.number(), y: z.number() }),
  tom: z.enum(['neutro', 'marca', 'aviso']).optional(),
});

export const grafoSchema = z.object({
  nos: z.array(noSchema).default([]),
  arestas: z.array(arestaSchema).default([]),
  notas: z.array(notaSchema).max(200).optional(),
});

export type Grafo = z.infer<typeof grafoSchema>;
export type No = z.infer<typeof noSchema>;
export type Aresta = z.infer<typeof arestaSchema>;
export type Nota = z.infer<typeof notaSchema>;
export type Ramo = z.infer<typeof ramoSchema>;
export type Regra = z.infer<typeof regraSchema>;

/** Valida a config do nó contra o schema do tipo. Erro explícito, nunca silencioso. */
export function validarConfig(tipo: TipoNo, config: unknown): { ok: true; dados: unknown } | { ok: false; erro: string } {
  const schema = configs[tipo];
  const r = schema.safeParse(config ?? {});
  if (r.success) return { ok: true, dados: r.data };
  return { ok: false, erro: r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ') };
}

/**
 * Metadados para a UI (paleta de nós). Fonte única: este arquivo.
 * `grupo` é o que organiza os painéis "Adicionar gatilho"/"Adicionar ação" —
 * com 21 nós, lista corrida vira caça ao tesouro.
 */
export interface MetaNo {
  tipo: TipoNo;
  categoria: 'gatilho' | 'controle' | 'acao';
  grupo: string;
  nome: string;
  descricao: string;
  /** Saídas nomeadas fixas (o canvas desenha um handle por ramo). */
  ramosFixos?: { id: string; rotulo: string }[];
  /** Ramos definidos pelo usuário (If/Else). */
  ramificado?: boolean;
  /** Depende de credencial externa (gating — Brief §2). */
  provider?: string;
  /** Termos que o usuário pode digitar na busca e não estão no nome. */
  busca?: string[];
}

export const CATALOGO: MetaNo[] = [
  // ---------------- Gatilhos ----------------
  { tipo: 'gatilho.contato_criado', categoria: 'gatilho', grupo: 'Contato', nome: 'Contato criado', descricao: 'Um contato entrou no CRM — cadastro manual, importação ou lead de anúncio.', busca: ['lead', 'novo', 'cadastro'] },
  { tipo: 'gatilho.tag_adicionada', categoria: 'gatilho', grupo: 'Contato', nome: 'Tag adicionada', descricao: 'Uma tag foi aplicada ao contato.', busca: ['etiqueta', 'marcador'] },
  { tipo: 'gatilho.negocio_criado', categoria: 'gatilho', grupo: 'Negócios', nome: 'Oportunidade criada', descricao: 'Um negócio entrou no funil.', busca: ['deal', 'oportunidade', 'venda'] },
  { tipo: 'gatilho.etapa_mudou', categoria: 'gatilho', grupo: 'Negócios', nome: 'Mudou de etapa', descricao: 'Um negócio mudou de etapa no funil.', busca: ['deal', 'stage', 'pipeline', 'estágio'] },
  { tipo: 'gatilho.negocio_status', categoria: 'gatilho', grupo: 'Negócios', nome: 'Ganho ou perdido', descricao: 'Um negócio foi marcado como ganho ou perdido — para pós-venda ou reativação.', busca: ['deal', 'ganho', 'perdido', 'won', 'lost', 'fechado', 'pós-venda', 'reativação'] },
  { tipo: 'gatilho.mensagem_recebida', categoria: 'gatilho', grupo: 'Comunicação', nome: 'Mensagem recebida', descricao: 'O contato mandou mensagem no WhatsApp.', busca: ['whatsapp', 'sms', 'resposta', 'inbox'] },
  { tipo: 'gatilho.agendamento_criado', categoria: 'gatilho', grupo: 'Agenda', nome: 'Agendamento criado', descricao: 'Um compromisso foi marcado para o contato, pela equipe ou por um agente de IA. Use {{agendamento.data}}, {{agendamento.hora}}, {{agendamento.titulo}} e {{agendamento.local}}.', busca: ['agenda', 'agendamento', 'reunião', 'consulta', 'marcou', 'appointment', 'booking'] },
  { tipo: 'gatilho.agendamento_confirmado', categoria: 'gatilho', grupo: 'Agenda', nome: 'Agendamento confirmado', descricao: 'O compromisso foi confirmado, pela equipe ou pela resposta do contato ao lembrete.', busca: ['agenda', 'confirmou', 'confirmação', 'appointment'] },
  { tipo: 'gatilho.faltou', categoria: 'gatilho', grupo: 'Agenda', nome: 'Contato faltou', descricao: 'O compromisso foi marcado como falta. Ideal para recuperar e reagendar.', busca: ['agenda', 'falta', 'faltou', 'no-show', 'não compareceu', 'reagendar', 'recuperação'] },
  { tipo: 'gatilho.agendamento_cancelado', categoria: 'gatilho', grupo: 'Agenda', nome: 'Agendamento cancelado', descricao: 'O compromisso foi cancelado.', busca: ['agenda', 'cancelou', 'cancelamento', 'desmarcou'] },
  { tipo: 'gatilho.lembrete_agendamento', categoria: 'gatilho', grupo: 'Agenda', nome: 'Lembrete do agendamento (D-1)', descricao: 'Faltam até 24 horas para um compromisso ainda não confirmado. Se o contato responder "sim", a agenda confirma sozinha.', busca: ['agenda', 'lembrete', 'd-1', 'véspera', 'confirmar', 'reminder'] },
  { tipo: 'gatilho.agendado', categoria: 'gatilho', grupo: 'Tempo', nome: 'Data e hora (agendado)', descricao: 'Roda uma vez numa data e hora, ou todo dia, toda semana ou todo mês num horário. Sem contato ou para cada contato de um segmento (tag ou etapa).', busca: ['cron', 'scheduler', 'agendar', 'recorrente', 'diário', 'semanal', 'mensal', 'horário', 'rotina', 'data', 'momento', 'uma vez', 'específico', 'lançamento'] },
  { tipo: 'gatilho.data_contato', categoria: 'gatilho', grupo: 'Tempo', nome: 'Data do contato (aniversário)', descricao: 'Dias antes, no dia ou depois de uma data do contato: aniversário, renovação, data de cadastro. Varredura diária, uma vez por data. Para repetir todo ano, deixe a reentrada em "sempre".', busca: ['aniversário', 'aniversario', 'birthday', 'data', 'lembrete', 'renovação', 'vencimento', 'custom date'] },
  { tipo: 'gatilho.formulario_enviado', categoria: 'gatilho', grupo: 'Captação', nome: 'Formulário enviado', descricao: 'O contato enviou um formulário. Use {{formulario.<campo>}} com as respostas.', busca: ['form', 'formulário', 'cadastro', 'inscrição', 'landing'] },
  { tipo: 'gatilho.pagamento_recebido', categoria: 'gatilho', grupo: 'Financeiro', nome: 'Pagamento recebido', descricao: 'Uma cobrança foi paga. Filtro opcional por valor mínimo. Use {{pagamento.valor}} e {{pagamento.descricao}}.', busca: ['pagamento', 'pago', 'cobrança', 'stripe', 'pix', 'boleto', 'payment', 'recebido', 'venda'] },
  { tipo: 'gatilho.webhook', categoria: 'gatilho', grupo: 'Dados', nome: 'Webhook recebido', descricao: 'Um sistema externo chama a URL deste fluxo (formulário, site, ERP).', busca: ['api', 'integração', 'externo', 'formulário', 'inbound'] },

  // ---------------- Controle ----------------
  { tipo: 'controle.esperar', categoria: 'controle', grupo: 'Fluxo', nome: 'Esperar', descricao: 'Pausa por um tempo. De segundos a dias — a espera sobrevive a restart.', busca: ['wait', 'delay', 'pausa', 'tempo'] },
  {
    tipo: 'controle.esperar_resposta', categoria: 'controle', grupo: 'Fluxo', nome: 'Esperar resposta',
    descricao: 'Espera o contato responder no WhatsApp. Um caminho se responder, outro se o prazo estourar.',
    ramosFixos: [...RAMOS_ESPERAR_RESPOSTA], busca: ['reply', 'resposta', 'timeout', 'aguardar'],
  },
  { tipo: 'controle.condicao', categoria: 'controle', grupo: 'Fluxo', nome: 'Condição (If/Else)', descricao: 'Ramifica por regras com AND / OR / NONE.', ramificado: true, busca: ['if', 'else', 'condição', 'filtro', 'ramo'] },
  { tipo: 'controle.split', categoria: 'controle', grupo: 'Fluxo', nome: 'Dividir (A/B)', descricao: 'Distribui os contatos entre caminhos por peso. Determinístico: o mesmo contato cai sempre no mesmo caminho.', ramificado: true, busca: ['split', 'ab', 'a/b', 'teste', 'dividir', 'variante', 'distribuir', 'experimento'] },
  { tipo: 'controle.drip', categoria: 'controle', grupo: 'Fluxo', nome: 'Liberar em lotes (drip)', descricao: 'Segura os contatos e libera N por janela de tempo — não queima o canal num disparo grande.', busca: ['drip', 'lote', 'batch', 'throttle', 'ritmo', 'gotejar', 'limite', 'fila'] },
  { tipo: 'controle.ir_para', categoria: 'controle', grupo: 'Fluxo', nome: 'Ir para', descricao: 'Pula para outro nó do fluxo. Tem limite de passos contra loop infinito.', busca: ['goto', 'pular', 'saltar'] },
  { tipo: 'controle.encerrar', categoria: 'controle', grupo: 'Fluxo', nome: 'Encerrar', descricao: 'Termina a execução aqui. Útil no fim de um ramo do If/Else.', busca: ['stop', 'parar', 'fim', 'sair'] },

  { tipo: 'controle.esperar_ate', categoria: 'controle', grupo: 'Fluxo', nome: 'Esperar até', descricao: 'Espera até uma data e hora, até um campo de data (ex.: 1 dia antes do agendamento) ou até um evento acontecer, com prazo e duas saídas.', busca: ['wait until', 'até', 'data', 'agendamento', 'evento', 'aguardar', 'timeout', 'véspera'] },
  { tipo: 'controle.meta', categoria: 'controle', grupo: 'Fluxo', nome: 'Meta', descricao: 'Quando o evento acontece (agendou, pagou, respondeu), o contato pula direto para cá, de qualquer ponto anterior do fluxo.', busca: ['goal', 'objetivo', 'meta', 'conversão', 'pular'] },

  // ---------------- Ações ----------------
  { tipo: 'acao.enviar_sms', categoria: 'acao', grupo: 'Comunicação', nome: 'Enviar SMS', descricao: 'Texto simples entregue no WhatsApp via STEVO (API não oficial): sem mídia nem template.', provider: 'stevo', busca: ['whatsapp', 'mensagem', 'texto', 'enviar'] },
  { tipo: 'acao.enviar_email', categoria: 'acao', grupo: 'Comunicação', nome: 'Enviar e-mail', descricao: 'E-mail para o contato pelo canal oficial (SMTP). Aceita {{contato.nome}} no assunto e no corpo.', provider: 'email', busca: ['email', 'e-mail', 'mail', 'mensagem', 'enviar'] },
  { tipo: 'acao.notificar_equipe', categoria: 'acao', grupo: 'Comunicação', nome: 'Notificar equipe no WhatsApp', descricao: 'Manda um aviso para o número da equipe (não para o contato). Aceita {{contato.nome}} e {{contato.telefone}}.', provider: 'stevo', busca: ['notificação', 'notificacao', 'interna', 'equipe', 'aviso', 'alerta', 'whatsapp'] },
  { tipo: 'acao.adicionar_tag', categoria: 'acao', grupo: 'Contato', nome: 'Adicionar tag', descricao: 'Aplica uma tag ao contato.', busca: ['etiqueta', 'marcar'] },
  { tipo: 'acao.remover_tag', categoria: 'acao', grupo: 'Contato', nome: 'Remover tag', descricao: 'Tira a tag do contato.', busca: ['etiqueta', 'desmarcar'] },
  { tipo: 'acao.atualizar_contato', categoria: 'acao', grupo: 'Contato', nome: 'Atualizar contato', descricao: 'Grava um valor num campo do contato.', busca: ['campo', 'editar', 'campo customizado'] },
  { tipo: 'acao.atribuir_usuario', categoria: 'acao', grupo: 'Contato', nome: 'Atribuir responsável', descricao: 'Define o dono do contato: um usuário fixo ou rodízio entre membros da equipe. Opcional: só se ainda não tiver dono.', busca: ['dono', 'owner', 'responsável', 'round robin', 'rodízio', 'distribuir', 'atribuir', 'vendedor'] },
  { tipo: 'acao.ativar_ia', categoria: 'acao', grupo: 'Contato', nome: 'Ativar IA na conversa', descricao: 'Liga um agente de IA na conversa do contato (vazio = o agente padrão do canal). A partir daí a IA responde as mensagens dele.', busca: ['ia', 'agente', 'ativar', 'ligar', 'robô', 'robo', 'assistente', 'inteligência'] },
  { tipo: 'acao.passar_humano', categoria: 'acao', grupo: 'Contato', nome: 'Passar para humano', descricao: 'Tira a conversa da IA e entrega para a equipe, distribuindo para quem tem menos conversas abertas.', busca: ['humano', 'pessoa', 'equipe', 'transferir', 'desligar ia', 'atendente'] },
  { tipo: 'acao.nao_perturbe', categoria: 'acao', grupo: 'Contato', nome: 'Não perturbe', descricao: 'Liga ou desliga o "não perturbe": com ele ligado, nenhum SMS, WhatsApp ou e-mail sai para o contato.', busca: ['dnd', 'opt-out', 'descadastrar', 'bloquear', 'silenciar', 'lgpd'] },
  { tipo: 'acao.remover_de_fluxo', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Remover de fluxo', descricao: 'Tira o contato deste fluxo ou de outros: cancela as execuções ativas dele.', busca: ['remove', 'sair', 'cancelar', 'parar', 'workflow', 'tirar'] },
  { tipo: 'acao.atualizar_negocio', categoria: 'acao', grupo: 'Negócios', nome: 'Atualizar negócio', descricao: 'Muda valor, status (ganho, perdido), etapa, dono ou campos personalizados do negócio do contexto.', busca: ['deal', 'oportunidade', 'valor', 'ganho', 'perdido', 'status', 'dono'] },
  { tipo: 'acao.criar_oportunidade', categoria: 'acao', grupo: 'Negócios', nome: 'Criar oportunidade', descricao: 'Cria um negócio na etapa escolhida do funil.', busca: ['deal', 'venda', 'pipeline'] },
  { tipo: 'acao.mover_etapa', categoria: 'acao', grupo: 'Negócios', nome: 'Mover etapa', descricao: 'Move o negócio do contexto para outra etapa.', busca: ['stage', 'pipeline', 'estágio'] },
  { tipo: 'acao.criar_tarefa', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Criar tarefa', descricao: 'Abre uma tarefa ligada ao contato, para alguém da equipe fazer.', busca: ['task', 'to-do', 'lembrete'] },
  { tipo: 'acao.criar_nota', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Adicionar nota', descricao: 'Registra uma nota no contato — fica no histórico dele.', busca: ['note', 'anotação', 'comentário'] },
  { tipo: 'acao.definir_variavel', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Definir variável', descricao: 'Guarda um valor (aceita {{...}}) numa variável para reusar depois em mensagens e condições.', busca: ['variável', 'variavel', 'variable', 'valor', 'set', 'guardar', 'memória'] },
  { tipo: 'acao.formatar_texto', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Formatar texto', descricao: 'Transforma um valor — telefone, moeda, maiúsculas — e guarda numa variável.', busca: ['formatar', 'formato', 'texto', 'telefone', 'moeda', 'maiúscula', 'transformar', 'format'] },
  { tipo: 'acao.ia', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'IA (analisar)', descricao: 'A Nyro classifica, pontua, resume, responde ou extrai a partir do contexto — e guarda o resultado numa variável.', provider: 'anthropic', busca: ['ia', 'ai', 'nyro', 'score', 'pontuar', 'sentimento', 'resumo', 'classificar', 'inteligência', 'gpt'] },
  { tipo: 'acao.chamar_workflow', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Acionar outro fluxo', descricao: 'Manda o contato para outra automação. Serve para reaproveitar fluxos.', busca: ['workflow', 'encadear', 'chaining', 'sub-fluxo'] },
  { tipo: 'acao.webhook', categoria: 'acao', grupo: 'Dados', nome: 'Enviar webhook', descricao: 'Chama uma URL externa com o contexto da execução.', busca: ['api', 'integração', 'http', 'send data'] },
  { tipo: 'acao.pedir_avaliacao', categoria: 'acao', grupo: 'Comunicação', nome: 'Pedir avaliação', descricao: 'Envia ao contato o link de avaliação (Google ou outro) configurado em Configurações > Avaliações. O clique e a nota ficam registrados.', provider: 'stevo', busca: ['avaliação', 'avaliacao', 'review', 'google', 'nps', 'satisfação', 'estrelas', 'depoimento'] },
];
