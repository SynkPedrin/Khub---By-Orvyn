/**
 * Regras do funil usadas pelo Dashboard e pelo Pipeline.
 *
 * Funções puras (sem Prisma) para serem testáveis. Três erros que existiam
 * antes e que estas regras impedem:
 *  1. etapas de TODOS os funis eram misturadas num quadro só (o tenant com
 *     dois funis via 11 colunas de funis diferentes);
 *  2. negócios ganhos e perdidos eram contados como "abertos" e somados no
 *     "valor em pipeline";
 *  3. "taxa de conversão" dividia a última etapa pelo total de negócios.
 */

export interface FunilRef {
  id: string;
  nome: string;
}
export interface EtapaRef {
  id: string;
  pipelineId: string;
  nome: string;
  cor: string;
  ordem: number;
}
export interface NegocioRef {
  id: string;
  pipelineId: string;
  stageId: string;
  status: string;
  valor: number;
  atualizadoEm: Date;
}

export const ABERTO = 'aberto';
export const GANHO = 'ganho';
export const PERDIDO = 'perdido';

/**
 * Funil exibido: o pedido (se existir) ou o que tem mais negócios ABERTOS;
 * empate fica com o mais antigo (ordem de `funis`, que vem por criação).
 */
export function escolherFunil(funis: FunilRef[], negocios: NegocioRef[], pedido?: string | null): FunilRef | null {
  if (!funis.length) return null;
  if (pedido) {
    const f = funis.find((x) => x.id === pedido);
    if (f) return f;
  }
  const abertos = new Map<string, number>();
  for (const n of negocios) if (n.status === ABERTO) abertos.set(n.pipelineId, (abertos.get(n.pipelineId) ?? 0) + 1);
  return funis.reduce((melhor, f) => ((abertos.get(f.id) ?? 0) > (abertos.get(melhor.id) ?? 0) ? f : melhor), funis[0]);
}

export interface ResumoFunil {
  abertos: number;
  valorAberto: number;
  ganhos: number;
  valorGanho: number;
  perdidos: number;
  /** % inteiro; null quando não há base para calcular. */
  conversao: number | null;
  /** De onde veio a conversão — a UI explica isso em vez de fingir precisão. */
  conversaoBase: 'fechados' | 'etapa_final' | null;
  etapas: { id: string; nome: string; cor: string; total: number; valor: number }[];
}

/** Números de UM funil: etapas com os negócios abertos e conversão honesta. */
export function resumirFunil(funilId: string, etapas: EtapaRef[], negocios: NegocioRef[]): ResumoFunil {
  const doFunil = negocios.filter((n) => n.pipelineId === funilId);
  const abertos = doFunil.filter((n) => n.status === ABERTO);
  const ganhos = doFunil.filter((n) => n.status === GANHO);
  const perdidos = doFunil.filter((n) => n.status === PERDIDO);
  const soma = (xs: NegocioRef[]) => xs.reduce((s, n) => s + n.valor, 0);
  const minhas = etapas.filter((e) => e.pipelineId === funilId).sort((a, b) => a.ordem - b.ordem);
  const linhas = minhas.map((e) => {
    const ds = abertos.filter((n) => n.stageId === e.id);
    return { id: e.id, nome: e.nome, cor: e.cor, total: ds.length, valor: soma(ds) };
  });

  let conversao: number | null = null;
  let conversaoBase: ResumoFunil['conversaoBase'] = null;
  const fechados = ganhos.length + perdidos.length;
  if (fechados > 0) {
    conversao = Math.round((ganhos.length / fechados) * 100);
    conversaoBase = 'fechados';
  } else if (abertos.length > 0 && linhas.length > 0) {
    // Sem fechamento registrado (ex.: base importada com tudo "aberto"): a
    // fatia que já chegou à etapa final é o melhor sinal disponível.
    conversao = Math.round((linhas[linhas.length - 1].total / abertos.length) * 100);
    conversaoBase = 'etapa_final';
  }

  return {
    abertos: abertos.length,
    valorAberto: soma(abertos),
    ganhos: ganhos.length,
    valorGanho: soma(ganhos),
    perdidos: perdidos.length,
    conversao,
    conversaoBase,
    etapas: linhas,
  };
}

/**
 * Receita fechada por mês (negócios GANHOS, pela data da última atualização,
 * que é quando o status virou "ganho"), dos últimos `meses` meses incluindo o
 * atual, com zeros nos meses sem venda. Fuso de São Paulo para o corte do mês.
 */
export function receitaMensal(negocios: NegocioRef[], agora: Date, meses = 6): { mes: string; valor: number }[] {
  const chave = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(d);
    return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
  };
  const [ano, mes] = chave(agora).split('-').map(Number);
  const serie: { mes: string; valor: number }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 15));
    serie.push({ mes: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, valor: 0 });
  }
  const idx = new Map(serie.map((s, i) => [s.mes, i]));
  for (const n of negocios) {
    if (n.status !== GANHO) continue;
    const i = idx.get(chave(n.atualizadoEm));
    if (i !== undefined) serie[i].valor += n.valor;
  }
  return serie;
}
