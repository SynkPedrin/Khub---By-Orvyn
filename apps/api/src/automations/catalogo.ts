import { z } from 'zod';

/**
 * Catálogo congelado dos nós do workflow (ADR-0012 — fecha a LACUNA do PRD §7.1;
 * ampliado em E.2 e na trilha W de paridade de motor). Nó fora daqui não existe:
 * a validação da publicação recusa o grafo. Conta atual: 7 gatilhos + 7 controle
 * + 14 ações = 28.
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
  // Controle (7)
  'controle.esperar',
  'controle.esperar_resposta',
  'controle.condicao',
  'controle.split',
  'controle.drip',
  'controle.ir_para',
  'controle.encerrar',
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
  'acao.atualizar_contato': z.object({
    campo: z.enum(['nome', 'email', 'telefone', 'empresa', 'tag', 'valorEstimado']),
    valor: z.string(),
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
};

/** Ramos fixos do "Esperar resposta" — a UI desenha estas duas saídas. */
export const RAMOS_ESPERAR_RESPOSTA = [
  { id: 'resposta', rotulo: 'Respondeu' },
  { id: 'timeout', rotulo: 'Não respondeu' },
] as const;

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

export const grafoSchema = z.object({
  nos: z.array(noSchema).default([]),
  arestas: z.array(arestaSchema).default([]),
});

export type Grafo = z.infer<typeof grafoSchema>;
export type No = z.infer<typeof noSchema>;
export type Aresta = z.infer<typeof arestaSchema>;
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

  // ---------------- Ações ----------------
  { tipo: 'acao.enviar_sms', categoria: 'acao', grupo: 'Comunicação', nome: 'Enviar SMS', descricao: 'Texto simples entregue no WhatsApp via STEVO (API não oficial): sem mídia nem template.', provider: 'stevo', busca: ['whatsapp', 'mensagem', 'texto', 'enviar'] },
  { tipo: 'acao.enviar_email', categoria: 'acao', grupo: 'Comunicação', nome: 'Enviar e-mail', descricao: 'E-mail para o contato pelo canal oficial (SMTP). Aceita {{contato.nome}} no assunto e no corpo.', provider: 'email', busca: ['email', 'e-mail', 'mail', 'mensagem', 'enviar'] },
  { tipo: 'acao.notificar_equipe', categoria: 'acao', grupo: 'Comunicação', nome: 'Notificar equipe no WhatsApp', descricao: 'Manda um aviso para o número da equipe (não para o contato). Aceita {{contato.nome}} e {{contato.telefone}}.', provider: 'stevo', busca: ['notificação', 'notificacao', 'interna', 'equipe', 'aviso', 'alerta', 'whatsapp'] },
  { tipo: 'acao.adicionar_tag', categoria: 'acao', grupo: 'Contato', nome: 'Adicionar tag', descricao: 'Aplica uma tag ao contato.', busca: ['etiqueta', 'marcar'] },
  { tipo: 'acao.remover_tag', categoria: 'acao', grupo: 'Contato', nome: 'Remover tag', descricao: 'Tira a tag do contato.', busca: ['etiqueta', 'desmarcar'] },
  { tipo: 'acao.atualizar_contato', categoria: 'acao', grupo: 'Contato', nome: 'Atualizar contato', descricao: 'Grava um valor num campo do contato.', busca: ['campo', 'editar', 'campo customizado'] },
  { tipo: 'acao.criar_oportunidade', categoria: 'acao', grupo: 'Negócios', nome: 'Criar oportunidade', descricao: 'Cria um negócio na etapa escolhida do funil.', busca: ['deal', 'venda', 'pipeline'] },
  { tipo: 'acao.mover_etapa', categoria: 'acao', grupo: 'Negócios', nome: 'Mover etapa', descricao: 'Move o negócio do contexto para outra etapa.', busca: ['stage', 'pipeline', 'estágio'] },
  { tipo: 'acao.criar_tarefa', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Criar tarefa', descricao: 'Abre uma tarefa ligada ao contato, para alguém da equipe fazer.', busca: ['task', 'to-do', 'lembrete'] },
  { tipo: 'acao.criar_nota', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Adicionar nota', descricao: 'Registra uma nota no contato — fica no histórico dele.', busca: ['note', 'anotação', 'comentário'] },
  { tipo: 'acao.definir_variavel', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Definir variável', descricao: 'Guarda um valor (aceita {{...}}) numa variável para reusar depois em mensagens e condições.', busca: ['variável', 'variavel', 'variable', 'valor', 'set', 'guardar', 'memória'] },
  { tipo: 'acao.formatar_texto', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Formatar texto', descricao: 'Transforma um valor — telefone, moeda, maiúsculas — e guarda numa variável.', busca: ['formatar', 'formato', 'texto', 'telefone', 'moeda', 'maiúscula', 'transformar', 'format'] },
  { tipo: 'acao.ia', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'IA (analisar)', descricao: 'A Nyro classifica, pontua, resume, responde ou extrai a partir do contexto — e guarda o resultado numa variável.', provider: 'anthropic', busca: ['ia', 'ai', 'nyro', 'score', 'pontuar', 'sentimento', 'resumo', 'classificar', 'inteligência', 'gpt'] },
  { tipo: 'acao.chamar_workflow', categoria: 'acao', grupo: 'Ferramentas internas', nome: 'Acionar outro fluxo', descricao: 'Manda o contato para outra automação. Serve para reaproveitar fluxos.', busca: ['workflow', 'encadear', 'chaining', 'sub-fluxo'] },
  { tipo: 'acao.webhook', categoria: 'acao', grupo: 'Dados', nome: 'Enviar webhook', descricao: 'Chama uma URL externa com o contexto da execução.', busca: ['api', 'integração', 'http', 'send data'] },
];
