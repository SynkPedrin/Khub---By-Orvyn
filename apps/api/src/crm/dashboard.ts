/**
 * Regras do Dashboard de receita (mockup "panorama da operação").
 *
 * Funções puras (sem Prisma) para serem testáveis — mesmo padrão de
 * `funil.ts`. O serviço busca linhas cruas no banco; aqui viram série
 * diária com zeros, delta honesto contra o período anterior e os grupos
 * de fonte que o mockup exibe.
 *
 * Princípio herdado do dashboard antigo: sem base de comparação, o delta
 * é `null` e a tela não mostra número inventado.
 */

export type PeriodoDashboard = '7d' | '30d' | '90d';

export const PERIODOS: PeriodoDashboard[] = ['7d', '30d', '90d'];

/** Querystring solta → período válido; ausente/lixo cai no padrão de 30 dias. */
export function periodoDashboard(p: unknown): PeriodoDashboard {
  return p === '7d' || p === '90d' ? p : '30d';
}

export function diasDoPeriodo(p: PeriodoDashboard): number {
  return p === '7d' ? 7 : p === '90d' ? 90 : 30;
}

/** Dia civil em America/Sao_Paulo como 'YYYY-MM-DD' (mesmo fuso do resto do CRM). */
export function diaSP(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Soma dias a uma data 'YYYY-MM-DD' sem pisar em fuso (aritmética de calendário em UTC). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Primeiro dia do período que termina hoje (inclusive). */
export function inicioDoPeriodo(hoje: string, dias: number): string {
  return somarDias(hoje, -(dias - 1));
}

export interface PontoSerie {
  dia: string;
  valor: number;
}

/**
 * Completa a série diária do período com zeros nos dias sem movimento.
 * `rows` vem do GROUP BY do banco (só dias com dado).
 */
export function serieDiaria(rows: { dia: string; valor: number }[], inicio: string, hoje: string): PontoSerie[] {
  const porDia = new Map(rows.map((r) => [r.dia, r.valor]));
  const out: PontoSerie[] = [];
  for (let d = inicio; d <= hoje; d = somarDias(d, 1)) {
    out.push({ dia: d, valor: porDia.get(d) ?? 0 });
  }
  return out;
}

/**
 * Delta percentual contra o período anterior, com 1 casa decimal.
 * `null` quando a base é zero — dividir por zero inventaria "+∞%" ou "0%".
 */
export function deltaPct(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

/** Soma o que cai no período atual e no anterior (mesma janela deslocada). */
export function dividirPeriodos(rows: { dia: string; valor: number }[], inicio: string): { atual: number; anterior: number } {
  let atual = 0;
  let anterior = 0;
  for (const r of rows) {
    if (r.dia >= inicio) atual += r.valor;
    else anterior += r.valor;
  }
  return { atual, anterior };
}

/* ------------------------------------------------------------------ */
/* Fontes de lead → grupos do mockup                                   */
/* ------------------------------------------------------------------ */

export type GrupoFonte = 'Meta Ads' | 'Google Ads' | 'Tráfego Pago' | 'Indicação' | 'Orgânico' | 'Importação' | 'Outros';

export const ORDEM_GRUPOS: GrupoFonte[] = ['Meta Ads', 'Google Ads', 'Tráfego Pago', 'Indicação', 'Orgânico', 'Importação', 'Outros'];

/** A rosca do mockup tem no máximo 4 fatias; o resto vira "Outros". */
export const MAX_FATIAS = 4;

/**
 * Grupo de exibição da fonte de UM contato. Prioridade: atribuição gravada
 * na entrada (db/066); sem ela, o texto legado de `origem` — que na base
 * real aparece como "importacao", "Avec", "Instagram", "Meta Ads",
 * "Tráfego"… (o que a primeira versão não reconhecia: 97% caía em Outros).
 */
export function grupoDaFonte(fonte: string | null | undefined, origem: string | null | undefined): GrupoFonte {
  const f = (fonte ?? '').trim();
  if (f === 'meta_ads') return 'Meta Ads';
  if (f === 'google_ads') return 'Google Ads';
  if (f === 'indicacao') return 'Indicação';
  if (f === 'importacao') return 'Importação';
  if (['whatsapp_direto', 'instagram_direto', 'messenger_direto', 'formulario', 'manual'].includes(f)) return 'Orgânico';
  if (f) return 'Outros'; // tiktok_ads, desconhecida…

  const o = (origem ?? '').toLowerCase();
  if (!o) return 'Outros';
  // Import primeiro: "importacao" e sistemas antigos (Avec) não dizem a
  // origem real do lead — rótulo honesto é "veio de uma importação".
  if (/(importa|avec|csv|planilha|ghl)/.test(o)) return 'Importação';
  if (/(meta|facebook|instagram ads|lead ads|fb ads)/.test(o)) return 'Meta Ads';
  if (/(google|gclid|adwords)/.test(o)) return 'Google Ads';
  // "Tráfego" sozinho (rótulo comum de import do GHL) = anúncio sem plataforma
  // identificada; separar de Meta/Google é o que a base permite afirmar.
  if (/tr[áa]fego/.test(o)) return 'Tráfego Pago';
  if (/indica/.test(o)) return 'Indicação';
  if (/(whatsapp|instagram|messenger|site|formul|organico|orgânico|agendamento)/.test(o)) return 'Orgânico';
  return 'Outros';
}

export interface FatiaFonte {
  rotulo: GrupoFonte;
  valor: number;
  pct: number;
}

/**
 * Agrega linhas `{ fonte, origem, total }` nos grupos do mockup, com
 * percentual inteiro. Mais de 4 grupos com dado: ficam os 4 maiores e o
 * resto soma em "Outros" (limite visual da rosca, ver charts.tsx).
 */
export function agruparFontes(rows: { fonte: string; origem: string; total: number }[]): FatiaFonte[] {
  const soma = new Map<GrupoFonte, number>();
  let geral = 0;
  for (const r of rows) {
    const g = grupoDaFonte(r.fonte, r.origem);
    soma.set(g, (soma.get(g) ?? 0) + r.total);
    geral += r.total;
  }
  if (geral <= 0) return [];
  const presentes = ORDEM_GRUPOS.filter((g) => (soma.get(g) ?? 0) > 0).sort((a, b) => (soma.get(b)! - soma.get(a)! || ORDEM_GRUPOS.indexOf(a) - ORDEM_GRUPOS.indexOf(b)));
  const visiveis = presentes.slice(0, MAX_FATIAS);
  const resto = presentes.slice(MAX_FATIAS).reduce((s, g) => s + soma.get(g)!, 0);
  const fatias = visiveis.map((g) => ({ rotulo: g, valor: soma.get(g)! }));
  if (resto > 0) {
    const i = fatias.findIndex((f) => f.rotulo === 'Outros');
    if (i >= 0) fatias[i] = { rotulo: 'Outros', valor: fatias[i].valor + resto };
    else fatias.push({ rotulo: 'Outros', valor: resto });
  }
  return fatias.map((f) => ({ ...f, pct: Math.round(((f.valor / geral) * 1000) / 10) }));
}

/* ------------------------------------------------------------------ */
/* Insights determinísticos (sem LLM): cada frase sai de um número real */
/* ------------------------------------------------------------------ */

export interface Insight {
  icone: 'chart' | 'leads' | 'check2' | 'clock';
  texto: string;
}

export interface InsightInput {
  receitaDelta: number | null;
  receitaTotal: number;
  leadsMes: number;
  leadsMesAnterior: number;
  conversao: number | null;
  conversaoBase: 'fechados' | 'etapa_final' | null;
  tarefasHoje: number;
}

const fmtPct = (v: number) => Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function construirInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.receitaDelta !== null) {
    out.push({
      icone: 'chart',
      texto: `Sua receita ${i.receitaDelta >= 0 ? 'cresceu' : 'caiu'} ${fmtPct(i.receitaDelta)}% em relação ao período anterior.`,
    });
  }
  if (i.leadsMes > 0) {
    const d = deltaPct(i.leadsMes, i.leadsMesAnterior);
    out.push({
      icone: 'leads',
      texto: `Você tem ${i.leadsMes.toLocaleString('pt-BR')} novos leads este mês${d !== null ? ` (${d >= 0 ? '+' : '−'}${fmtPct(d)}%)` : ''}.`,
    });
  }
  // Conversão só vira insight quando veio de negócios fechados de verdade;
  // a base "etapa final" é aproximação e não sustenta a frase.
  if (i.conversao !== null && i.conversaoBase === 'fechados') {
    out.push({ icone: 'check2', texto: `A taxa de conversão está em ${i.conversao}%.` });
  }
  if (i.tarefasHoje > 0) {
    out.push({
      icone: 'clock',
      texto: `Você possui ${i.tarefasHoje} ${i.tarefasHoje === 1 ? 'tarefa pendente' : 'tarefas pendentes'} para hoje.`,
    });
  }
  return out;
}
