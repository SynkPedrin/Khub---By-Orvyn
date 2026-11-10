/**
 * FOLLOW-UP INTELLIGENCE — políticas puras (docs/AI_AGENT_ARCHITECTURE.md §11)
 * ============================================================================
 * Escolha de estratégia pelo contexto real do contato, janela de horário no
 * fuso da regra e condições de parada. Sem I/O: o serviço só aplica.
 */

export const ESTRATEGIAS = [
  'sem_resposta',
  'pos_orcamento',
  'objecao_preco',
  'pos_interesse',
  'agendamento_pendente',
  'reativacao',
  'oportunidade_perdida',
  'pos_atendimento',
] as const;
export type Estrategia = (typeof ESTRATEGIAS)[number];

export const CONDICOES_PARADA = ['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'] as const;
export type CondicaoParada = (typeof CONDICOES_PARADA)[number];

/** Catálogo exibido no Follow-up Builder e usado para semear as regras de um agente novo. */
export const CATALOGO_ESTRATEGIAS: Record<Estrategia, { nome: string; objetivo: string; instrucoes: string; intervalos: number[]; tentativas: number }> = {
  sem_resposta: {
    nome: 'Lead sem resposta',
    objetivo: 'Retomar a conversa de onde parou e obter a resposta pendente.',
    instrucoes: 'Retome exatamente o último assunto. Faça UMA pergunta simples que facilite responder. Nada de "só passando para lembrar".',
    intervalos: [4, 24, 72],
    tentativas: 3,
  },
  pos_orcamento: {
    nome: 'Recuperação após orçamento',
    objetivo: 'Entender se o orçamento atende e destravar a decisão.',
    instrucoes: 'Cite o que foi orçado. Pergunte se ficou alguma dúvida ou se há algo a ajustar. Não ofereça desconto que não esteja na base.',
    intervalos: [24, 72, 168],
    tentativas: 3,
  },
  objecao_preco: {
    nome: 'Objeção de preço',
    objetivo: 'Reapresentar valor e as condições comerciais AUTORIZADAS.',
    instrucoes: 'Reconheça a preocupação com o investimento. Mostre o valor ligado ao problema que o contato relatou. Só mencione condições de pagamento presentes na base de conhecimento.',
    intervalos: [24, 96],
    tentativas: 2,
  },
  pos_interesse: {
    nome: 'Após demonstração de interesse',
    objetivo: 'Converter interesse em próximo passo concreto.',
    instrucoes: 'Relembre o interesse demonstrado e proponha um próximo passo claro (agendar, receber proposta, tirar dúvida).',
    intervalos: [6, 48, 120],
    tentativas: 3,
  },
  agendamento_pendente: {
    nome: 'Agendamento não concluído',
    objetivo: 'Concluir o agendamento iniciado.',
    instrucoes: 'Retome o agendamento: pergunte qual dia e período ficam melhores. Não confirme horário sem consultar a agenda.',
    intervalos: [3, 24, 72],
    tentativas: 3,
  },
  reativacao: {
    nome: 'Reativação de cliente antigo',
    objetivo: 'Reabrir relacionamento com quem já foi cliente.',
    instrucoes: 'Seja breve e pessoal. Mencione a experiência anterior e pergunte se há algo em que possa ajudar agora.',
    intervalos: [720, 1440],
    tentativas: 2,
  },
  oportunidade_perdida: {
    nome: 'Oportunidade perdida',
    objetivo: 'Entender o motivo da perda e reabrir a porta.',
    instrucoes: 'Sem insistência. Pergunte, com respeito, se a decisão mudou ou se algo pode ser diferente agora.',
    intervalos: [336, 1440],
    tentativas: 2,
  },
  pos_atendimento: {
    nome: 'Pós-atendimento',
    objetivo: 'Verificar satisfação e abrir espaço para novas necessidades.',
    instrucoes: 'Pergunte como foi a experiência e se ficou alguma dúvida. Uma mensagem curta.',
    intervalos: [48],
    tentativas: 1,
  },
};

export interface ContextoEstrategia {
  intencao: string | null;
  objecoes: readonly string[];
  temperatura: string | null;
  etapaPerdida: boolean;
  orcamentoEnviado: boolean;
  agendamentoPendente: boolean;
}

/**
 * Melhor estratégia para o contato AGORA, entre as regras ativas do agente.
 * Ordem de prioridade = da mais específica para a mais genérica.
 */
export function escolherEstrategia(ctx: ContextoEstrategia, ativas: ReadonlySet<Estrategia>): Estrategia | null {
  const candidatas: Estrategia[] = [];
  if (ctx.etapaPerdida) candidatas.push('oportunidade_perdida');
  if (ctx.objecoes.includes('preco')) candidatas.push('objecao_preco');
  if (ctx.agendamentoPendente || ctx.intencao === 'agendamento') candidatas.push('agendamento_pendente');
  if (ctx.orcamentoEnviado || ctx.intencao === 'orcamento' || ctx.intencao === 'negociacao') candidatas.push('pos_orcamento');
  if (['interesse', 'compra', 'comparacao'].includes(ctx.intencao ?? '') || ctx.temperatura === 'quente' || ctx.temperatura === 'morna') candidatas.push('pos_interesse');
  candidatas.push('sem_resposta');
  return candidatas.find((c) => ativas.has(c)) ?? null;
}

export interface EstadoParada {
  respondeuDepois: boolean;
  convertido: boolean;
  optout: boolean;
  humanoAssumiu: boolean;
  agendou: boolean;
  desinteresse: boolean;
}

/** Retorna o motivo da parada (ou null para seguir). Opt-out SEMPRE para, configurado ou não. */
export function motivoParada(pararSe: readonly string[], e: EstadoParada): string | null {
  if (e.optout) return 'contato optou por não receber mensagens';
  const ativa = (c: CondicaoParada) => pararSe.includes(c);
  if (e.respondeuDepois && ativa('respondeu')) return 'contato respondeu';
  if (e.convertido && ativa('converteu')) return 'contato converteu';
  if (e.humanoAssumiu && ativa('humano_assumiu')) return 'humano assumiu a conversa';
  if (e.agendou && ativa('agendou')) return 'contato agendou';
  if (e.desinteresse) return 'contato demonstrou desinteresse';
  return null;
}

/** Partes de data/hora locais no fuso informado. */
export function partesLocais(d: Date, fuso: string): { diaSemana: number; hora: number; minuto: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const partes = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { diaSemana: dias[partes.weekday] ?? 0, hora: Number(partes.hour) % 24, minuto: Number(partes.minute) };
}

/**
 * Primeiro instante ≥ `base` dentro da janela [horarioInicio, horarioFim) num
 * dia permitido, no fuso da regra. Procura até 8 dias; sem dia permitido →
 * null (regra mal configurada não dispara nunca).
 */
export function proximoHorarioPermitido(
  base: Date,
  janela: { horarioInicio: number; horarioFim: number; diasSemana: readonly number[]; fuso: string },
): Date | null {
  if (!janela.diasSemana.length) return null;
  let t = new Date(base.getTime());
  for (let i = 0; i < 9 * 24 * 4; i++) {
    const { diaSemana, hora, minuto } = partesLocais(t, janela.fuso);
    const diaOk = janela.diasSemana.includes(diaSemana);
    if (diaOk && hora >= janela.horarioInicio && hora < janela.horarioFim) return t;
    let minutosAte: number;
    if (diaOk && hora < janela.horarioInicio) minutosAte = (janela.horarioInicio - hora) * 60 - minuto;
    else minutosAte = (24 - hora + janela.horarioInicio) * 60 - minuto; // próximo dia, no início da janela
    t = new Date(t.getTime() + Math.max(1, minutosAte) * 60_000);
    // Alinha ao minuto cheio para não acumular segundos.
    t.setUTCSeconds(0, 0);
  }
  return null;
}

/** Quando agendar a tentativa N (1-based) contando a partir da última interação. */
export function horarioDaTentativa(
  ultimaInteracao: Date,
  tentativa: number,
  regra: { intervalosHoras: readonly number[]; horarioInicio: number; horarioFim: number; diasSemana: readonly number[]; fuso: string },
): Date | null {
  const intervalos = regra.intervalosHoras.length ? regra.intervalosHoras : [24];
  const horas = intervalos[Math.min(tentativa - 1, intervalos.length - 1)];
  return proximoHorarioPermitido(new Date(ultimaInteracao.getTime() + horas * 3_600_000), regra);
}
