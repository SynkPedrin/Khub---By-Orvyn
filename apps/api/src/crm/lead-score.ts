/**
 * SCORE KHUB — v0 (regras determinísticas)
 * ==========================================
 *
 * Os mockups mostram um "Score KHUB" de 0 a 100 por lead. Esta é a V0 e ela
 * é **honesta sobre o que é**: um somatório de regras auditáveis, não um
 * modelo preditivo. Nenhuma tela deve chamar isso de "probabilidade de
 * conversão calculada por IA" — é um ranking operacional de prioridade.
 *
 * Por que regras e não modelo: sem histórico rotulado de ganhos/perdas, um
 * modelo aprenderia ruído. Regras dão um sinal útil hoje, são explicáveis ao
 * vendedor ("por que 92?") e viram baseline quando houver dados para treinar.
 *
 * `SCORE_VERSION` é gravado junto do score. Quando a v1 (modelo) chegar,
 * linhas antigas continuam interpretáveis e dá para comparar as duas.
 */

export const SCORE_VERSION = 'v0_rules' as const;

/** Sinais de entrada. Tudo opcional: lead novo pontua com o que houver. */
export interface SinaisLead {
  /** Mensagens trocadas nos últimos 30 dias (entrada + saída). */
  mensagens30d?: number;
  /** Mediana de minutos que o LEAD leva para responder. Menor = mais quente. */
  tempoRespostaLeadMin?: number | null;
  /** Índice da etapa atual no funil (0 = topo). */
  etapaIndice?: number | null;
  /** Total de etapas do funil, para normalizar a posição. */
  etapaTotal?: number | null;
  /** Minutos desde a última interação de qualquer natureza. */
  minutosDesdeUltimaInteracao?: number | null;
  /** Reunião marcada e ainda não realizada. */
  reuniaoAgendada?: boolean;
  /** Reunião realizada (compareceu). */
  reuniaoRealizada?: boolean;
  /** Sinais explícitos de intenção detectados (preço, prazo, proposta, contrato). */
  sinaisIntencao?: number;
  /** Negócio aberto vinculado, com valor. */
  valorOportunidade?: number | null;
  /** Lead respondeu pelo menos uma vez (diferencia de lista fria). */
  respondeuAlgumaVez?: boolean;
}

/** Contribuição de um critério — é o que explica o número ao usuário. */
export interface FatorScore {
  chave: string;
  rotulo: string;
  pontos: number;
  /** Máximo que este critério pode somar (para desenhar barra de contribuição). */
  maximo: number;
  detalhe: string;
}

export interface ResultadoScore {
  score: number;
  versao: typeof SCORE_VERSION;
  faixa: FaixaScore;
  fatores: FatorScore[];
  calculadoEm: string;
}

export type FaixaScore = 'quente' | 'morno' | 'frio' | 'sem_sinal';

/** Pesos por critério. Somam 100 — mudar um exige rebalancear os outros. */
export const PESOS = {
  engajamento: 24,
  velocidadeResposta: 18,
  posicaoFunil: 20,
  atividadeRecente: 16,
  intencao: 12,
  reuniao: 10,
} as const;

/**
 * Calcula o Score KHUB de um lead.
 *
 * Determinístico: os mesmos sinais produzem sempre o mesmo número. Sem
 * relógio interno além de `agora` (injetável) e sem aleatoriedade — é o que
 * torna o resultado testável e auditável.
 */
export function calcularScore(sinais: SinaisLead, agora: Date = new Date()): ResultadoScore {
  const fatores: FatorScore[] = [
    fatorEngajamento(sinais),
    fatorVelocidadeResposta(sinais),
    fatorPosicaoFunil(sinais),
    fatorAtividadeRecente(sinais),
    fatorIntencao(sinais),
    fatorReuniao(sinais),
  ];

  const bruto = fatores.reduce((soma, f) => soma + f.pontos, 0);
  const score = Math.max(0, Math.min(100, Math.round(bruto)));

  return {
    score,
    versao: SCORE_VERSION,
    faixa: faixaDoScore(score, sinais),
    fatores,
    calculadoEm: agora.toISOString(),
  };
}

/**
 * Faixa de leitura. `sem_sinal` existe para não pintar de "frio" um lead que
 * acabou de entrar: ausência de dado não é sinal negativo.
 */
export function faixaDoScore(score: number, sinais?: SinaisLead): FaixaScore {
  if (sinais && semNenhumSinal(sinais)) return 'sem_sinal';
  if (score >= 75) return 'quente';
  if (score >= 45) return 'morno';
  return 'frio';
}

function semNenhumSinal(s: SinaisLead): boolean {
  return (
    !s.mensagens30d &&
    s.tempoRespostaLeadMin == null &&
    s.minutosDesdeUltimaInteracao == null &&
    !s.reuniaoAgendada &&
    !s.reuniaoRealizada &&
    !s.sinaisIntencao &&
    !s.respondeuAlgumaVez
  );
}

/* ------------------------------------------------------------------ */
/* Critérios                                                           */
/* ------------------------------------------------------------------ */

/** Volume de conversa: satura em 12 mensagens/30d — acima disso não diz mais. */
function fatorEngajamento(s: SinaisLead): FatorScore {
  const n = Math.max(0, s.mensagens30d ?? 0);
  const proporcao = Math.min(1, n / 12);
  return {
    chave: 'engajamento',
    rotulo: 'Engajamento',
    maximo: PESOS.engajamento,
    pontos: round1(proporcao * PESOS.engajamento),
    detalhe: n ? `${n} mensagem(ns) nos últimos 30 dias` : 'Sem troca de mensagens recente',
  };
}

/**
 * Velocidade de resposta do LEAD (não da equipe).
 * Até 5 min = máximo; degrada até 48h; sem resposta = 0.
 */
function fatorVelocidadeResposta(s: SinaisLead): FatorScore {
  const min = s.tempoRespostaLeadMin;
  const max = PESOS.velocidadeResposta;

  if (min == null || min < 0) {
    return {
      chave: 'velocidade_resposta',
      rotulo: 'Velocidade de resposta',
      maximo: max,
      pontos: 0,
      detalhe: 'Lead ainda não respondeu',
    };
  }

  const TETO = 60 * 48;
  const PISO = 5;
  const proporcao = min <= PISO ? 1 : min >= TETO ? 0 : 1 - (min - PISO) / (TETO - PISO);

  return {
    chave: 'velocidade_resposta',
    rotulo: 'Velocidade de resposta',
    maximo: max,
    pontos: round1(proporcao * max),
    detalhe: `Responde em ~${formatarMinutos(min)}`,
  };
}

/** Quanto mais fundo no funil, mais próximo da receita. */
function fatorPosicaoFunil(s: SinaisLead): FatorScore {
  const { etapaIndice: i, etapaTotal: total } = s;
  const max = PESOS.posicaoFunil;

  if (i == null || total == null || total <= 1) {
    return {
      chave: 'posicao_funil',
      rotulo: 'Posição no funil',
      maximo: max,
      pontos: 0,
      detalhe: 'Ainda sem negócio no funil',
    };
  }

  const proporcao = Math.max(0, Math.min(1, i / (total - 1)));
  return {
    chave: 'posicao_funil',
    rotulo: 'Posição no funil',
    maximo: max,
    pontos: round1(proporcao * max),
    detalhe: `Etapa ${i + 1} de ${total}`,
  };
}

/**
 * Recência. Este é o único critério que **decai sozinho**: um lead parado
 * perde pontos com o tempo sem que nada aconteça — que é exatamente o
 * comportamento que faz o painel "Leads em risco" ter sentido.
 */
function fatorAtividadeRecente(s: SinaisLead): FatorScore {
  const min = s.minutosDesdeUltimaInteracao;
  const max = PESOS.atividadeRecente;

  if (min == null || min < 0) {
    return {
      chave: 'atividade_recente',
      rotulo: 'Atividade recente',
      maximo: max,
      pontos: 0,
      detalhe: 'Sem interação registrada',
    };
  }

  const DIA = 60 * 24;
  let proporcao: number;
  if (min <= DIA) proporcao = 1;
  else if (min <= 3 * DIA) proporcao = 0.75;
  else if (min <= 7 * DIA) proporcao = 0.5;
  else if (min <= 14 * DIA) proporcao = 0.25;
  else proporcao = 0;

  return {
    chave: 'atividade_recente',
    rotulo: 'Atividade recente',
    maximo: max,
    pontos: round1(proporcao * max),
    detalhe: `Última interação há ${formatarMinutos(min)}`,
  };
}

/** Sinais explícitos de compra (perguntou preço, prazo, pediu proposta). */
function fatorIntencao(s: SinaisLead): FatorScore {
  const n = Math.max(0, s.sinaisIntencao ?? 0);
  const proporcao = Math.min(1, n / 3);
  return {
    chave: 'intencao',
    rotulo: 'Sinais de intenção',
    maximo: PESOS.intencao,
    pontos: round1(proporcao * PESOS.intencao),
    detalhe: n ? `${n} sinal(is) de intenção de compra` : 'Nenhum sinal explícito de compra',
  };
}

/** Reunião é o compromisso mais forte antes da proposta. */
function fatorReuniao(s: SinaisLead): FatorScore {
  const max = PESOS.reuniao;
  if (s.reuniaoRealizada) {
    return { chave: 'reuniao', rotulo: 'Reunião', maximo: max, pontos: max, detalhe: 'Reunião realizada' };
  }
  if (s.reuniaoAgendada) {
    return { chave: 'reuniao', rotulo: 'Reunião', maximo: max, pontos: round1(max * 0.7), detalhe: 'Reunião agendada' };
  }
  return { chave: 'reuniao', rotulo: 'Reunião', maximo: max, pontos: 0, detalhe: 'Sem reunião' };
}

/* ------------------------------------------------------------------ */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatarMinutos(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (60 * 24))} dia(s)`;
}
