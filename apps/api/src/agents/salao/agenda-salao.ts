/**
 * Agenda de salão para os agentes de IA (salão).
 *
 * O KHUB não guarda o expediente de cada profissional: o salão operava no
 * Avec e só os atendimentos foram exportados. Em vez de pedir cadastro manual
 * de jornada, o expediente é DEDUZIDO do histórico real da agenda:
 * - em que dias da semana cada profissional atende (dia com atendimento em
 *   pelo menos 2 semanas diferentes no período);
 * - a janela típica desse dia (percentis 10 do início e 90 do fim, para um
 *   encaixe fora da curva não abrir a agenda inteira);
 * - quais serviços ela faz (já fez o serviço no período).
 * Horário livre = dentro da janela, sem choque com atendimento ativo dela,
 * com a duração do serviço do catálogo.
 *
 * Funções puras: o serviço (salao-agenda.service.ts) só busca os dados.
 */

export interface AtendimentoHist {
  profissionalId: string;
  servicoId: string | null;
  /** epoch ms */
  inicio: number;
  fim: number;
}

export interface Janela {
  /** minutos desde 00:00 local */
  iniMin: number;
  fimMin: number;
}

/** profissionalId → dia da semana (0 = domingo) → janela. */
export type Expedientes = Map<string, Map<number, Janela>>;

export interface ServicoCatalogo {
  id: string;
  nome: string;
  duracaoMin: number;
  precoCentavos: number;
}

export interface ProfissionalCatalogo {
  id: string;
  nome: string;
}

const PASSO_MIN = 30;

/** Partes da data/hora no fuso (sem depender do fuso do servidor). */
export function partesLocais(ms: number, fuso: string): { data: string; diaSemana: number; minutos: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { data: `${p.year}-${p.month}-${p.day}`, diaSemana: dias[p.weekday] ?? 0, minutos: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Instante (epoch ms) de `data` às `minutos` no fuso, resolvendo o deslocamento do próprio dia. */
export function instanteNoFuso(data: string, minutos: number, fuso: string): number {
  const [y, m, d] = data.split('-').map(Number);
  const palpite = Date.UTC(y, m - 1, d, Math.floor(minutos / 60), minutos % 60);
  // Ajusta pelo deslocamento observado no palpite (2 passos cobrem virada de horário de verão).
  let t = palpite;
  for (let i = 0; i < 2; i++) {
    const p = partesLocais(t, fuso);
    const [py, pm, pd] = p.data.split('-').map(Number);
    const visto = Date.UTC(py, pm - 1, pd, Math.floor(p.minutos / 60), p.minutos % 60);
    t += palpite - visto;
  }
  return t;
}

export function diaDaSemana(data: string): number {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function somarDiasData(data: string, n: number): string {
  const [y, m, d] = data.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function percentil(valores: number[], p: number): number {
  const v = [...valores].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))));
  return v[i];
}

/**
 * Expediente por profissional e dia da semana a partir do histórico.
 * Só conta o dia da semana em que ela atendeu em >= `minSemanas` datas
 * diferentes (um encaixe isolado num sábado não abre todos os sábados).
 */
export function inferirExpedientes(hist: AtendimentoHist[], fuso: string, minSemanas = 2): Expedientes {
  // profissional → dia da semana → data → { primeiro início, último fim }
  const porProf = new Map<string, Map<number, Map<string, { ini: number; fim: number }>>>();
  for (const a of hist) {
    const ini = partesLocais(a.inicio, fuso);
    const fimMin = ini.minutos + Math.max(5, Math.round((a.fim - a.inicio) / 60_000));
    const porDia = porProf.get(a.profissionalId) ?? new Map();
    const porData = porDia.get(ini.diaSemana) ?? new Map();
    const atual = porData.get(ini.data);
    porData.set(ini.data, { ini: Math.min(atual?.ini ?? Infinity, ini.minutos), fim: Math.max(atual?.fim ?? 0, Math.min(fimMin, 24 * 60)) });
    porDia.set(ini.diaSemana, porData);
    porProf.set(a.profissionalId, porDia);
  }
  const out: Expedientes = new Map();
  for (const [prof, porDia] of porProf) {
    const m = new Map<number, Janela>();
    for (const [dia, porData] of porDia) {
      if (porData.size < minSemanas) continue;
      const dias = [...porData.values()];
      // Arredonda para a meia hora (início para baixo, fim para cima).
      const iniMin = Math.floor(percentil(dias.map((x) => x.ini), 10) / 30) * 30;
      const fimMin = Math.ceil(percentil(dias.map((x) => x.fim), 90) / 30) * 30;
      if (fimMin - iniMin >= 30) m.set(dia, { iniMin, fimMin });
    }
    if (m.size) out.set(prof, m);
  }
  return out;
}

/**
 * Duração típica do serviço (mediana do histórico, em passos de 15 min) com
 * pelo menos `minAmostras`. O catálogo importado do Avec veio com duração
 * padrão; a agenda real tem a duração de cada atendimento.
 */
export function duracaoTipica(hist: AtendimentoHist[], servicoId: string, minAmostras = 3): number | null {
  const d = hist.filter((a) => a.servicoId === servicoId).map((a) => Math.round((a.fim - a.inicio) / 60_000)).filter((m) => m >= 10 && m <= 8 * 60);
  if (d.length < minAmostras) return null;
  return Math.max(15, Math.round(percentil(d, 50) / 15) * 15);
}

/** Quem já fez o serviço no período. Serviço sem histórico → ninguém (o chamador decide o fallback). */
export function profissionaisDoServico(hist: AtendimentoHist[], servicoId: string): Set<string> {
  return new Set(hist.filter((a) => a.servicoId === servicoId).map((a) => a.profissionalId));
}

/**
 * Inícios livres (epoch ms) de uma profissional num dia: dentro da janela,
 * de `passoMin` em `passoMin`, sem choque com os ocupados, e não antes de
 * `agora + antecedenciaMin`.
 */
export function horariosLivres(args: {
  data: string;
  janela: Janela;
  duracaoMin: number;
  ocupados: { inicio: number; fim: number }[];
  fuso: string;
  agora: number;
  antecedenciaMin?: number;
  passoMin?: number;
}): number[] {
  const passo = args.passoMin ?? PASSO_MIN;
  const limite = args.agora + (args.antecedenciaMin ?? 60) * 60_000;
  const livres: number[] = [];
  for (let m = args.janela.iniMin; m + args.duracaoMin <= args.janela.fimMin; m += passo) {
    const ini = instanteNoFuso(args.data, m, args.fuso);
    const fim = ini + args.duracaoMin * 60_000;
    if (ini < limite) continue;
    if (args.ocupados.some((o) => o.inicio < fim && o.fim > ini)) continue;
    livres.push(ini);
  }
  return livres;
}

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jeito que a cliente fala → como o catálogo do salão escreve. */
const SINONIMOS: [RegExp, string][] = [
  [/\bpedicure\b|\bpedicuro\b|\bunhas? (do|dos|de) pes?\b/g, 'pe'],
  [/\bmanicure\b|\bunhas? (da|das|de) maos?\b/g, 'mao'],
  [/\bmaos\b/g, 'mao'],
  [/\bpes\b/g, 'pe'],
  [/\bsobrancelhas\b/g, 'sobrancelha'],
  [/\bcilios\b/g, 'cilios'],
];
function falado(termo: string): string {
  let t = normalizar(termo);
  for (const [re, por] of SINONIMOS) t = t.replace(re, por);
  return t.replace(/\s+/g, ' ').trim();
}
const palavrasDe = (s: string) => s.split(' ').filter((w) => w && w !== 'e' && w !== 'de' && w !== 'com' && w !== 'do' && w !== 'da');
const mesmasPalavras = (a: string, b: string) => {
  const x = new Set(palavrasDe(a));
  const y = new Set(palavrasDe(b));
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
};

/**
 * Serviço do catálogo pelo nome que a cliente falou ("pedicure", "pé e mão",
 * "design de sobrancelha"). Ordem: nome igual (aceita sinônimo e ordem das
 * palavras); nome que contém o termo; palavras em comum (palavra de 3+ letras:
 * sigla de variação como "P"/"TP" não casa sozinha). Variações do MESMO serviço
 * ("Design de Sobrancelha T/P/TP") → a mais feita no histórico (`popularidade`),
 * a cliente não conhece o código interno; a equipe ajusta se precisar.
 */
export function acharServico(
  servicos: ServicoCatalogo[],
  termo: string,
  popularidade: Map<string, number> = new Map(),
): { servico: ServicoCatalogo | null; candidatos: ServicoCatalogo[]; variacoes?: string[] } {
  const t = falado(termo);
  if (!t) return { servico: null, candidatos: [] };
  const nome = (s: ServicoCatalogo) => falado(s.nome);
  const exato = servicos.find((s) => nome(s) === t) ?? servicos.find((s) => mesmasPalavras(nome(s), t));
  if (exato) return { servico: exato, candidatos: [] };
  const pop = (s: ServicoCatalogo) => popularidade.get(s.id) ?? 0;
  const contem = servicos.filter((s) => nome(s).includes(t));
  if (contem.length === 1) return { servico: contem[0], candidatos: [] };
  if (contem.length > 1) {
    // Todas começam pelo que a cliente falou = variações do mesmo serviço.
    if (contem.every((s) => nome(s).startsWith(t))) {
      const ord = [...contem].sort((a, b) => pop(b) - pop(a) || a.nome.length - b.nome.length);
      return { servico: ord[0], candidatos: [], variacoes: ord.slice(1).map((s) => s.nome) };
    }
    return { servico: null, candidatos: [...contem].sort((a, b) => pop(b) - pop(a)).slice(0, 5) };
  }
  const palavras = palavrasDe(t).filter((p) => p.length > 2);
  const pontuados = servicos
    .map((s) => {
      const n = palavrasDe(nome(s)).filter((w) => w.length > 2);
      return { s, pts: palavras.filter((p) => n.some((w) => w.startsWith(p) || p.startsWith(w))).length };
    })
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts || pop(b.s) - pop(a.s) || a.s.nome.length - b.s.nome.length);
  if (pontuados.length && (pontuados.length === 1 || pontuados[0].pts > pontuados[1].pts)) return { servico: pontuados[0].s, candidatos: [] };
  return { servico: null, candidatos: pontuados.slice(0, 5).map((x) => x.s) };
}

/** Profissional pelo nome (primeiro nome basta: "Rita", "gabi"). */
export function acharProfissional(profs: ProfissionalCatalogo[], termo: string): ProfissionalCatalogo | null {
  const t = normalizar(termo);
  if (!t) return null;
  return (
    profs.find((p) => normalizar(p.nome) === t) ??
    profs.find((p) => normalizar(p.nome).split(' ')[0] === t.split(' ')[0]) ??
    profs.find((p) => normalizar(p.nome).startsWith(t)) ??
    null
  );
}
