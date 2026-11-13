/**
 * MOTOR DO SIMULADOR DE CAMPANHAS (Meta Ads)
 * ==========================================
 *
 * Ambiente de teste: o operador monta a campanha (objetivo, verba, público,
 * posicionamento) e os criativos (hook, copy, título, CTA, formato, vídeo) e
 * vê o que essa verba tende a entregar ANTES de gastar um real.
 *
 * Como chega nos números:
 *  1. **Base de mercado** (CPM, CTR de link e taxa clique → resultado) por
 *     objetivo. São PREMISSAS DE REFERÊNCIA para negócios locais no Brasil,
 *     não dado da Meta, e o produto diz isso na tela. Quando a conta do
 *     tenant tem histórico real (`ad_insights`), a base é CALIBRADA com ele
 *     por encolhimento: quanto mais impressões reais, mais pesa a conta.
 *  2. **Nota do criativo** (hook, copy, CTA, criativo) por regras explícitas,
 *     cada uma com o motivo exibido ao operador. Nota 60 = neutra (não mexe
 *     na base); acima melhora CTR/conversão e barateia o CPM (o leilão premia
 *     anúncio relevante); abaixo piora.
 *  3. **Dia a dia com Monte Carlo** (semente determinística: mesma entrada,
 *     mesmo resultado): fase de aprendizado, pressão da verba sobre o
 *     público (CPM sobe), alcance com saturação, frequência e fadiga do
 *     criativo. Sai a mediana e a faixa provável (p10–p90).
 *
 * Nada aqui chama rede nem banco: a calibração entra pronta.
 */

export type Objetivo = 'mensagens' | 'leads' | 'conversoes' | 'trafego' | 'alcance' | 'engajamento';
export type Formato = 'imagem' | 'video' | 'carrossel';
export type Posicionamento = 'automatico' | 'feed' | 'stories_reels';
export type Cta =
  | 'enviar_mensagem' | 'saiba_mais' | 'cadastre_se' | 'agendar' | 'comprar' | 'fale_conosco' | 'obter_oferta' | 'ligar';
export type TextoNaImagem = 'pouco' | 'medio' | 'muito';

export const OBJETIVOS: Objetivo[] = ['mensagens', 'leads', 'conversoes', 'trafego', 'alcance', 'engajamento'];
export const FORMATOS: Formato[] = ['imagem', 'video', 'carrossel'];
export const POSICIONAMENTOS: Posicionamento[] = ['automatico', 'feed', 'stories_reels'];
export const CTAS: Cta[] = ['enviar_mensagem', 'saiba_mais', 'cadastre_se', 'agendar', 'comprar', 'fale_conosco', 'obter_oferta', 'ligar'];

export interface CriativoSim {
  nome: string;
  formato: Formato;
  hook: string;
  copy: string;
  titulo: string;
  cta: Cta;
  /** Só vídeo. */
  videoSegundos?: number;
  legendas?: boolean;
  /** Aparece rosto humano no criativo. */
  rosto?: boolean;
  textoNaImagem?: TextoNaImagem;
  /** Nota visual (0–100) devolvida pela análise de IA da imagem/vídeo, se houve. */
  notaVisualIa?: number;
}

export interface EntradaSimulacao {
  objetivo: Objetivo;
  orcamentoDia: number;
  dias: number;
  /** Pessoas no público (estimativa). */
  publico: number;
  posicionamento: Posicionamento;
  ticketMedio: number;
  /** % dos resultados que viram venda (0–100). */
  taxaFechamento: number;
  criativos: CriativoSim[];
  /** Sobrescreve a base (o operador conhece o mercado dele). */
  premissas?: { cpm?: number; ctr?: number; conversao?: number };
}

/** Histórico real da conta (soma do período), se existir. */
export interface Calibracao {
  impressoes: number;
  cliques: number;
  gasto: number;
  resultados: number;
}

export interface Motivo { ok: boolean; texto: string }
export interface Dimensao { nota: number; motivos: Motivo[] }
export interface NotaCriativo {
  geral: number;
  hook: Dimensao;
  copy: Dimensao;
  cta: Dimensao;
  criativo: Dimensao;
  riscoReprovacao: boolean;
}

export interface Faixa { p10: number; p50: number; p90: number }
export interface Dia { dia: number; gasto: number; impressoes: number; cliques: number; resultados: number; cpr: number; frequencia: number; aprendizado: boolean }

export interface ResultadoCriativo {
  nome: string;
  nota: NotaCriativo;
  orcamentoDia: number;
  investimento: number;
  impressoes: number;
  alcance: number;
  frequencia: number;
  cliques: number;
  ctr: number;
  cpc: number;
  cpm: number;
  resultados: Faixa;
  custoPorResultado: Faixa;
  vendas: number;
  receita: number | null;
  roas: number | null;
  /** Dia em que sai do aprendizado (50 resultados em 7 dias); null = não sai. */
  saidaAprendizado: number | null;
  /** Chance de ser o melhor criativo (menor custo por resultado), 0–1. */
  chanceMelhor: number;
  serie: Dia[];
}

export interface PontoVerba { orcamentoDia: number; resultados: number; custoPorResultado: number }

export interface ResultadoSimulacao {
  objetivo: Objetivo;
  resultadoNome: string;
  base: { cpm: number; ctr: number; conversao: number; fonte: 'conta' | 'referencia' | 'mista' | 'manual'; pesoConta: number };
  total: {
    investimento: number; impressoes: number; alcance: number; frequencia: number; cliques: number;
    ctr: number; cpm: number; resultados: Faixa; custoPorResultado: Faixa; vendas: number; receita: number | null; roas: number | null;
  };
  criativos: ResultadoCriativo[];
  vencedor: string | null;
  curvaVerba: PontoVerba[];
  verbaRecomendada: number | null;
  serie: Dia[];
  alertas: { nivel: 'info' | 'atencao' | 'risco'; texto: string }[];
  rodadas: number;
}

/* ------------------------------------------------------------------ */
/* Premissas de referência (negócio local, Brasil). Não é dado da Meta. */
/* ------------------------------------------------------------------ */

interface Base { cpm: number; ctr: number; conversao: number }
/** cpm em R$, ctr de link em %, conversao = % dos cliques que viram resultado. */
export const REFERENCIA: Record<Objetivo, Base> = {
  mensagens: { cpm: 24, ctr: 1.2, conversao: 22 },
  leads: { cpm: 28, ctr: 1.1, conversao: 10 },
  conversoes: { cpm: 32, ctr: 1.0, conversao: 3 },
  trafego: { cpm: 14, ctr: 1.3, conversao: 100 },
  alcance: { cpm: 7, ctr: 0.5, conversao: 100 },
  engajamento: { cpm: 10, ctr: 0.8, conversao: 100 },
};

export const NOME_RESULTADO: Record<Objetivo, string> = {
  mensagens: 'conversas iniciadas',
  leads: 'leads',
  conversoes: 'conversões',
  trafego: 'cliques no link',
  alcance: 'pessoas alcançadas',
  engajamento: 'engajamentos',
};

/** Objetivos em que o resultado é alguém com intenção (gera venda). */
const GERA_VENDA: Record<Objetivo, boolean> = {
  mensagens: true, leads: true, conversoes: true, trafego: false, alcance: false, engajamento: false,
};

const POSICIONAMENTO: Record<Posicionamento, { cpm: number; ctr: number }> = {
  automatico: { cpm: 0.9, ctr: 1 },
  feed: { cpm: 1.15, ctr: 1 },
  stories_reels: { cpm: 0.75, ctr: 0.85 },
};

/** Meta: o conjunto sai do aprendizado com ~50 eventos de otimização em 7 dias. */
const EVENTOS_APRENDIZADO = 50;

/* ------------------------------------------------------------------ */
/* Nota do criativo                                                    */
/* ------------------------------------------------------------------ */

const limitar = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const palavras = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RE_CURIOSIDADE = /\b(como|por que|porque|pare|atencao|nunca|erro|segredo|ninguem|descubra|o que|voce sabia|cuidado|verdade)\b/;
const RE_VOCE = /\b(voce|vc|sua|seu|suas|seus|te)\b/;
const RE_DOR_DESEJO = /\b(dor|medo|cansad|vergonha|inseguranc|sonho|quer|queria|resultado|economi|ganhar|perder|sem precisar|finalmente|rapido|facil|livre)\w*/;
const RE_ABERTURA_FRACA = /^(ola|oi|conheca|venha|somos|a empresa|bem[- ]vind|nos da|aqui na|aqui no)\b/;
const RE_PROVA = /(\+\s?de\s?\d|\d+\s?(clientes|pacientes|alunos|avaliac|anos|familias|casos)|depoimento|estrelas|★|avaliad)/;
const RE_OFERTA = /\b(hoje|agora|vagas?|ultim[ao]s?|ate dia|tempo limitado|desconto|gratis|gratuit[ao]|bonus|condicao especial|so esta semana|promoc)\w*/;
const RE_CTA_VERBAL = /\b(clique|clica|chame|chama|fale|agende|agenda|garanta|toque|envie|manda|saiba|reserve|cadastre|vem)\w*/;
const RE_BENEFICIO = /\b(resultado|economi|rapido|sem dor|seguro|conforto|praticidade|transform|melhor|aument|reduz|eviden|natural)\w*/;

/** Padrões que a política de publicidade da Meta costuma reprovar. */
const RISCOS_POLITICA: { re: RegExp; texto: string }[] = [
  { re: /\bvoce (e|esta|tem|sofre de)\s+(gord|obes|acima do peso|diabet|depress|ansios|endividad|calv|careca|feio)/, texto: 'Afirma um atributo pessoal do leitor ("você é/tem…"). A Meta reprova.' },
  { re: /\b(resultado garantido|100% garantido|garantia de resultado|cura (definitiva|garantida)|cura\b)/, texto: 'Promete resultado garantido ou cura: reprovação provável (e risco ético em saúde).' },
  { re: /\bantes e depois\b/, texto: 'Fala em "antes e depois": a Meta restringe em saúde, estética e emagrecimento.' },
  { re: /\b(emagre\w+|perca|perder)\s+\d+\s?(kg|quilos)\s+em\b/, texto: 'Promete perda de peso em prazo definido: reprovação provável.' },
  { re: /\b(fique rico|dinheiro facil|renda garantida)\b/, texto: 'Promessa financeira irreal: reprovação provável.' },
];

function notaHook(hook: string, formato: Formato): Dimensao {
  const t = norm(hook);
  const m: Motivo[] = [];
  if (!t.trim()) return { nota: 15, motivos: [{ ok: false, texto: 'Sem hook: os primeiros segundos decidem se a pessoa para de rolar.' }] };
  let n = 45;
  const w = palavras(hook).length;
  if (w >= 4 && w <= 12) { n += 12; m.push({ ok: true, texto: `Curto e direto (${w} palavras).` }); }
  else if (w > 18) { n -= 12; m.push({ ok: false, texto: `Longo demais para um hook (${w} palavras). Corte para até 12.` }); }
  else if (w < 4) { n -= 4; m.push({ ok: false, texto: 'Muito curto: falta dizer para quem é ou o que a pessoa ganha.' }); }
  if (/\?/.test(hook) || RE_CURIOSIDADE.test(t)) { n += 10; m.push({ ok: true, texto: 'Abre curiosidade (pergunta ou gatilho de atenção).' }); }
  if (/\d/.test(hook)) { n += 7; m.push({ ok: true, texto: 'Tem número: deixa a promessa concreta.' }); }
  if (RE_VOCE.test(t)) { n += 7; m.push({ ok: true, texto: 'Fala com a pessoa ("você").' }); }
  else m.push({ ok: false, texto: 'Não fala com a pessoa: experimente começar por "você".' });
  if (RE_DOR_DESEJO.test(t)) { n += 8; m.push({ ok: true, texto: 'Toca numa dor ou desejo.' }); }
  if (RE_ABERTURA_FRACA.test(t)) { n -= 16; m.push({ ok: false, texto: 'Começa falando da empresa ("conheça", "somos"…). Comece pelo problema do cliente.' }); }
  const letras = hook.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letras.length > 8 && letras.replace(/[^A-ZÀ-Ý]/g, '').length / letras.length > 0.6) { n -= 8; m.push({ ok: false, texto: 'Caixa alta demais: parece grito e baixa a qualidade percebida.' }); }
  if (/!{2,}/.test(hook)) { n -= 4; m.push({ ok: false, texto: 'Exclamações em excesso.' }); }
  if (formato === 'video') m.push({ ok: true, texto: 'Em vídeo, o hook precisa estar falado E escrito nos 3 primeiros segundos.' });
  return { nota: Math.round(limitar(n)), motivos: m };
}

function notaCopy(copy: string, objetivo: Objetivo): { dim: Dimensao; riscos: string[] } {
  const t = norm(copy);
  const m: Motivo[] = [];
  const riscos = RISCOS_POLITICA.filter((r) => r.re.test(t)).map((r) => r.texto);
  if (!t.trim()) return { dim: { nota: 20, motivos: [{ ok: false, texto: 'Sem texto principal.' }] }, riscos };
  let n = 40;
  const w = palavras(copy).length;
  const [min, max] = objetivo === 'mensagens' || objetivo === 'trafego' ? [12, 90] : objetivo === 'alcance' || objetivo === 'engajamento' ? [8, 70] : [25, 150];
  if (w >= min && w <= max) { n += 12; m.push({ ok: true, texto: `Tamanho bom para o objetivo (${w} palavras).` }); }
  else if (w < min) { n -= 6; m.push({ ok: false, texto: `Curto (${w} palavras): falta benefício, prova ou próximo passo.` }); }
  else { n -= 10; m.push({ ok: false, texto: `Longo (${w} palavras): quase ninguém lê depois do "ver mais". Ideal até ${max}.` }); }
  if (RE_BENEFICIO.test(t)) { n += 8; m.push({ ok: true, texto: 'Mostra benefício.' }); } else m.push({ ok: false, texto: 'Não deixa claro o que a pessoa ganha.' });
  if (RE_PROVA.test(t)) { n += 10; m.push({ ok: true, texto: 'Tem prova (números, avaliações, tempo de mercado).' }); } else m.push({ ok: false, texto: 'Sem prova social: um número ou depoimento aumenta a confiança.' });
  if (RE_OFERTA.test(t)) { n += 8; m.push({ ok: true, texto: 'Tem oferta ou motivo para agir agora.' }); } else m.push({ ok: false, texto: 'Sem motivo para agir agora (vagas, condição, prazo).' });
  if (RE_CTA_VERBAL.test(t)) { n += 8; m.push({ ok: true, texto: 'Pede a ação no texto.' }); } else m.push({ ok: false, texto: 'O texto não pede a ação ("chame no WhatsApp", "agende"…).' });
  if (copy.split(/\n\s*\n|\n/).filter((l) => l.trim()).length >= 2) { n += 4; m.push({ ok: true, texto: 'Quebrado em linhas: fácil de escanear.' }); }
  for (const r of riscos) { n -= 12; m.push({ ok: false, texto: r }); }
  return { dim: { nota: Math.round(limitar(n)), motivos: m }, riscos };
}

const CTA_POR_OBJETIVO: Record<Objetivo, Partial<Record<Cta, number>>> = {
  mensagens: { enviar_mensagem: 95, fale_conosco: 80, agendar: 70, saiba_mais: 60, obter_oferta: 65, ligar: 55 },
  leads: { cadastre_se: 90, obter_oferta: 86, saiba_mais: 80, agendar: 80, enviar_mensagem: 60 },
  conversoes: { comprar: 92, agendar: 90, obter_oferta: 85, saiba_mais: 65, cadastre_se: 70 },
  trafego: { saiba_mais: 90, obter_oferta: 75, comprar: 70, cadastre_se: 65 },
  alcance: { saiba_mais: 80, enviar_mensagem: 72, fale_conosco: 70 },
  engajamento: { saiba_mais: 78, enviar_mensagem: 75, fale_conosco: 72 },
};

export const CTA_ROTULO: Record<Cta, string> = {
  enviar_mensagem: 'Enviar mensagem', saiba_mais: 'Saiba mais', cadastre_se: 'Cadastre-se', agendar: 'Agendar',
  comprar: 'Comprar agora', fale_conosco: 'Fale conosco', obter_oferta: 'Obter oferta', ligar: 'Ligar agora',
};

function notaCta(cta: Cta, objetivo: Objetivo, copy: string): Dimensao {
  const base = CTA_POR_OBJETIVO[objetivo][cta] ?? 45;
  const melhor = (Object.entries(CTA_POR_OBJETIVO[objetivo]) as [Cta, number][]).sort((a, b) => b[1] - a[1])[0][0];
  const m: Motivo[] = [];
  if (base >= 85) m.push({ ok: true, texto: `"${CTA_ROTULO[cta]}" combina com o objetivo.` });
  else m.push({ ok: false, texto: `Para ${NOME_RESULTADO[objetivo]}, "${CTA_ROTULO[melhor]}" costuma converter melhor que "${CTA_ROTULO[cta]}".` });
  let n = base;
  if (RE_CTA_VERBAL.test(norm(copy))) { n += 5; m.push({ ok: true, texto: 'O texto reforça o botão.' }); }
  return { nota: Math.round(limitar(n)), motivos: m };
}

function notaCriativo(c: CriativoSim, pos: Posicionamento): Dimensao {
  const m: Motivo[] = [];
  let n: number;
  if (c.formato === 'video') {
    const s = c.videoSegundos ?? 0;
    if (!s) { n = 60; m.push({ ok: false, texto: 'Informe a duração do vídeo.' }); }
    else if (s <= 15) { n = 86; m.push({ ok: true, texto: `Vídeo curto (${s}s): retém até o fim.` }); }
    else if (s <= 30) { n = 76; m.push({ ok: true, texto: `Duração boa (${s}s).` }); }
    else if (s <= 60) { n = 62; m.push({ ok: false, texto: `${s}s é longo: a maioria sai antes do CTA. Tente uma versão de 15–30s.` }); }
    else { n = 46; m.push({ ok: false, texto: `${s}s é longo demais para anúncio frio.` }); }
    if (c.legendas) { n += 7; m.push({ ok: true, texto: 'Tem legenda: funciona sem som.' }); }
    else { n -= 6; m.push({ ok: false, texto: 'Sem legenda: boa parte assiste no mudo.' }); }
    if (pos === 'stories_reels') { n += 5; m.push({ ok: true, texto: 'Vídeo em Stories/Reels é o formato nativo.' }); }
  } else if (c.formato === 'carrossel') {
    n = 70; m.push({ ok: true, texto: 'Carrossel prende o dedo e mostra mais de um benefício.' });
    if (pos === 'stories_reels') { n -= 8; m.push({ ok: false, texto: 'Carrossel rende menos em Stories/Reels.' }); }
  } else {
    n = 64;
    if (pos === 'stories_reels') { n -= 8; m.push({ ok: false, texto: 'Imagem parada em Stories/Reels perde para vídeo.' }); }
    if (c.textoNaImagem === 'muito') { n -= 14; m.push({ ok: false, texto: 'Muito texto na imagem: a entrega costuma cair.' }); }
    else if (c.textoNaImagem === 'pouco') { n += 5; m.push({ ok: true, texto: 'Pouco texto na imagem.' }); }
  }
  if (c.rosto) { n += 7; m.push({ ok: true, texto: 'Tem rosto humano: gera conexão e para o scroll.' }); }
  else m.push({ ok: false, texto: 'Sem rosto humano: pessoas reais costumam parar mais o scroll.' });
  if (typeof c.notaVisualIa === 'number') {
    n = (n + c.notaVisualIa) / 2;
    m.push({ ok: c.notaVisualIa >= 60, texto: `Análise visual da IA: ${Math.round(c.notaVisualIa)}/100.` });
  }
  return { nota: Math.round(limitar(n)), motivos: m };
}

export function avaliarCriativo(c: CriativoSim, objetivo: Objetivo, pos: Posicionamento): NotaCriativo {
  const hook = notaHook(c.hook, c.formato);
  const { dim: copy, riscos } = notaCopy(`${c.titulo}\n${c.copy}`.trim(), objetivo);
  const cta = notaCta(c.cta, objetivo, c.copy);
  const criativo = notaCriativo(c, pos);
  const geral = Math.round(0.3 * hook.nota + 0.25 * criativo.nota + 0.3 * copy.nota + 0.15 * cta.nota);
  return { geral, hook, copy, cta, criativo, riscoReprovacao: riscos.length > 0 };
}

/* ------------------------------------------------------------------ */
/* Simulação                                                           */
/* ------------------------------------------------------------------ */

/** PRNG determinístico (mulberry32). */
function rng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Fator log-normal com mediana 1. */
function lognormal(r: () => number, sigma: number): number {
  const u = Math.max(r(), 1e-9);
  const v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(sigma * z);
}
function quantil(ordenado: number[], q: number): number {
  if (!ordenado.length) return 0;
  const i = (ordenado.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (i - lo);
}
const faixa = (v: number[]): Faixa => {
  const o = [...v].sort((a, b) => a - b);
  return { p10: quantil(o, 0.1), p50: quantil(o, 0.5), p90: quantil(o, 0.9) };
};

/** Base de mercado: referência, calibrada pela conta e/ou sobrescrita pelo operador. */
export function baseDeMercado(objetivo: Objetivo, cal?: Calibracao | null, premissas?: EntradaSimulacao['premissas']) {
  const ref = REFERENCIA[objetivo];
  let { cpm, ctr, conversao } = ref;
  let pesoConta = 0;
  if (cal && cal.impressoes >= 3000 && cal.gasto > 0) {
    // Encolhimento: com 20 mil impressões a conta pesa metade.
    pesoConta = cal.impressoes / (cal.impressoes + 20_000);
    const cpmConta = (cal.gasto / cal.impressoes) * 1000;
    const ctrConta = (cal.cliques / cal.impressoes) * 100;
    cpm = pesoConta * cpmConta + (1 - pesoConta) * cpm;
    if (cal.cliques > 0) ctr = pesoConta * ctrConta + (1 - pesoConta) * ctr;
    if (GERA_VENDA[objetivo] && cal.cliques >= 100 && cal.resultados > 0) {
      const pesoConv = cal.cliques / (cal.cliques + 300);
      conversao = pesoConv * ((cal.resultados / cal.cliques) * 100) + (1 - pesoConv) * conversao;
    }
  }
  const manual = !!(premissas?.cpm || premissas?.ctr || premissas?.conversao);
  if (premissas?.cpm) cpm = premissas.cpm;
  if (premissas?.ctr) ctr = premissas.ctr;
  if (premissas?.conversao) conversao = premissas.conversao;
  const fonte: ResultadoSimulacao['base']['fonte'] = manual ? 'manual' : pesoConta >= 0.75 ? 'conta' : pesoConta > 0 ? 'mista' : 'referencia';
  return { cpm, ctr, conversao, fonte, pesoConta };
}

/** Multiplicadores do criativo. Nota 60 = neutro. */
export function efeitoDoCriativo(n: NotaCriativo, formato: Formato) {
  const atencao = 0.55 * n.hook.nota + 0.45 * n.criativo.nota;
  const persuasao = 0.6 * n.copy.nota + 0.4 * n.cta.nota;
  const formatoCtr = formato === 'video' ? 1.08 : formato === 'carrossel' ? 1.04 : 1;
  return {
    ctr: (0.45 + 1.25 * Math.pow(atencao / 100, 1.6)) * formatoCtr,
    conversao: 0.7 + 0.5 * (persuasao / 100),
    cpm: 1.15 - 0.25 * (n.geral / 100),
  };
}

interface Rodada { dias: Dia[]; resultados: number; gasto: number; impressoes: number; cliques: number; alcance: number; saida: number | null }

/** Uma rodada (um "universo") de um criativo, dia a dia. */
function rodar(
  e: Pick<EntradaSimulacao, 'objetivo' | 'dias' | 'publico' | 'posicionamento'>,
  orcamentoDia: number,
  base: Base,
  ef: ReturnType<typeof efeitoDoCriativo>,
  mercado: { cpm: number; ctr: number; conv: number },
  r: () => number,
): Rodada {
  const pos = POSICIONAMENTO[e.posicionamento];
  const N = Math.max(1000, e.publico);
  const cpmBase = base.cpm * pos.cpm * ef.cpm * mercado.cpm;
  const ctrBase = (base.ctr / 100) * pos.ctr * ef.ctr * mercado.ctr;
  const convBase = Math.min(1, (base.conversao / 100) * ef.conversao * mercado.conv);
  let impAcum = 0;
  let resAcum = 0;
  let res7 = 0;
  let saida: number | null = null;
  let alcanceAnterior = 0;
  const dias: Dia[] = [];
  let gasto = 0;
  let cliquesTot = 0;
  for (let d = 1; d <= e.dias; d++) {
    const aprendizado = saida === null;
    // Pressão da verba sobre o público: CPM sobe quando a verba quer mais
    // impressões por dia do que o público comporta.
    // Leilão mais caro à medida que a verba avança sobre o público.
    const pressao = (orcamentoDia / cpmBase) * 1000 / N;
    let cpm = cpmBase * (1 + 3.5 * Math.pow(pressao, 0.75)) * lognormal(r, 0.1);
    if (aprendizado) cpm *= 1.1;
    const impressoes = (orcamentoDia / cpm) * 1000;
    impAcum += impressoes;
    const alcance = N * (1 - Math.exp(-impAcum / N));
    const frequencia = impAcum / Math.max(alcance, 1);
    const fadiga = frequencia > 2 ? 1 / (1 + 0.25 * (frequencia - 2)) : 1;
    const ctr = ctrBase * fadiga * lognormal(r, 0.12);
    const cliques = impressoes * ctr;
    let resultados: number;
    if (e.objetivo === 'alcance') resultados = alcance - alcanceAnterior;
    else if (e.objetivo === 'engajamento') resultados = impressoes * Math.min(0.2, ctr * 2.5);
    else if (e.objetivo === 'trafego') resultados = cliques;
    else resultados = cliques * convBase * (aprendizado ? 0.82 : 1) * lognormal(r, 0.15);
    alcanceAnterior = alcance;
    resAcum += resultados;
    if (d <= 7) res7 += resultados;
    if (saida === null && d <= 7 && res7 >= EVENTOS_APRENDIZADO) saida = d;
    gasto += orcamentoDia;
    cliquesTot += cliques;
    dias.push({ dia: d, gasto: orcamentoDia, impressoes, cliques, resultados, cpr: resultados > 0 ? orcamentoDia / resultados : 0, frequencia, aprendizado });
  }
  return { dias, resultados: resAcum, gasto, impressoes: impAcum, cliques: cliquesTot, alcance: alcanceAnterior, saida };
}

const RODADAS = 400;

function mediana(v: number[]) { return quantil([...v].sort((a, b) => a - b), 0.5); }

function serieMediana(rodadas: Rodada[], dias: number): Dia[] {
  const out: Dia[] = [];
  for (let d = 0; d < dias; d++) {
    const col = rodadas.map((x) => x.dias[d]);
    const gasto = col[0].gasto;
    const resultados = mediana(col.map((c) => c.resultados));
    out.push({
      dia: d + 1,
      gasto,
      impressoes: mediana(col.map((c) => c.impressoes)),
      cliques: mediana(col.map((c) => c.cliques)),
      resultados,
      cpr: resultados > 0 ? gasto / resultados : 0,
      frequencia: mediana(col.map((c) => c.frequencia)),
      aprendizado: col.filter((c) => c.aprendizado).length > col.length / 2,
    });
  }
  return out;
}

export function simular(e: EntradaSimulacao, cal?: Calibracao | null): ResultadoSimulacao {
  const base = baseDeMercado(e.objetivo, cal, e.premissas);
  const r = rng(hash(JSON.stringify(e)));
  const n = e.criativos.length;
  // ABO: verba dividida igualmente entre os criativos (teste A/B justo).
  const orcCriativo = e.orcamentoDia / n;
  const notas = e.criativos.map((c) => avaliarCriativo(c, e.objetivo, e.posicionamento));
  const efeitos = e.criativos.map((c, i) => efeitoDoCriativo(notas[i], c.formato));
  // Cada criativo atinge um público N/n (dividem o mesmo público).
  const ePorCriativo = { ...e, publico: e.publico / Math.max(1, Math.sqrt(n)) };

  const porCriativo: Rodada[][] = e.criativos.map(() => []);
  for (let k = 0; k < RODADAS; k++) {
    // Fator de mercado COMPARTILHADO entre criativos na mesma rodada (leilão do dia).
    const mercado = { cpm: lognormal(r, 0.18), ctr: lognormal(r, 0.12), conv: lognormal(r, 0.2) };
    e.criativos.forEach((_, i) => {
      // Incerteza própria do criativo (o que a nota não captura).
      const proprio = { cpm: mercado.cpm, ctr: mercado.ctr * lognormal(r, 0.2), conv: mercado.conv * lognormal(r, 0.18) };
      porCriativo[i].push(rodar(ePorCriativo, orcCriativo, base, efeitos[i], proprio, r));
    });
  }

  // Chance de cada criativo ser o melhor (mais resultados com a mesma verba).
  const vitorias = e.criativos.map(() => 0);
  for (let k = 0; k < RODADAS; k++) {
    let melhor = 0;
    for (let i = 1; i < n; i++) if (porCriativo[i][k].resultados > porCriativo[melhor][k].resultados) melhor = i;
    vitorias[melhor]++;
  }

  const geraVenda = GERA_VENDA[e.objetivo];
  const criativos: ResultadoCriativo[] = e.criativos.map((c, i) => {
    const rs = porCriativo[i];
    const res = faixa(rs.map((x) => x.resultados));
    const investimento = orcCriativo * e.dias;
    const impressoes = mediana(rs.map((x) => x.impressoes));
    const alcance = mediana(rs.map((x) => x.alcance));
    const cliques = mediana(rs.map((x) => x.cliques));
    const cpr = faixa(rs.map((x) => (x.resultados > 0 ? investimento / x.resultados : investimento)));
    const vendas = geraVenda ? res.p50 * (e.taxaFechamento / 100) : 0;
    const receita = geraVenda ? vendas * e.ticketMedio : null;
    const saidas = rs.map((x) => x.saida);
    const saiu = saidas.filter((s): s is number => s !== null);
    return {
      nome: c.nome,
      nota: notas[i],
      orcamentoDia: orcCriativo,
      investimento,
      impressoes,
      alcance,
      frequencia: impressoes / Math.max(alcance, 1),
      cliques,
      ctr: impressoes ? (cliques / impressoes) * 100 : 0,
      cpc: cliques ? investimento / cliques : 0,
      cpm: impressoes ? (investimento / impressoes) * 1000 : 0,
      resultados: res,
      // Faixa de custo invertida: p10 de custo = cenário bom.
      custoPorResultado: { p10: cpr.p10, p50: cpr.p50, p90: cpr.p90 },
      vendas,
      receita,
      roas: receita !== null && investimento > 0 ? receita / investimento : null,
      saidaAprendizado: saiu.length > rs.length / 2 ? mediana(saiu) : null,
      chanceMelhor: vitorias[i] / RODADAS,
      serie: serieMediana(rs, e.dias),
    };
  });

  // Totais por rodada (somando criativos) para a faixa do total.
  const totRes = Array.from({ length: RODADAS }, (_, k) => porCriativo.reduce((s, rs) => s + rs[k].resultados, 0));
  const investimento = e.orcamentoDia * e.dias;
  const resultados = faixa(totRes);
  const cprTot = faixa(totRes.map((x) => (x > 0 ? investimento / x : investimento)));
  const impressoes = criativos.reduce((s, c) => s + c.impressoes, 0);
  const cliques = criativos.reduce((s, c) => s + c.cliques, 0);
  const alcance = Math.min(e.publico, criativos.reduce((s, c) => s + c.alcance, 0));
  const vendas = geraVenda ? resultados.p50 * (e.taxaFechamento / 100) : 0;
  const receita = geraVenda ? vendas * e.ticketMedio : null;

  const serie: Dia[] = Array.from({ length: e.dias }, (_, d) => {
    const linhas = criativos.map((c) => c.serie[d]);
    const res = linhas.reduce((s, l) => s + l.resultados, 0);
    const gasto = linhas.reduce((s, l) => s + l.gasto, 0);
    return {
      dia: d + 1,
      gasto,
      impressoes: linhas.reduce((s, l) => s + l.impressoes, 0),
      cliques: linhas.reduce((s, l) => s + l.cliques, 0),
      resultados: res,
      cpr: res > 0 ? gasto / res : 0,
      frequencia: linhas.reduce((s, l) => s + l.frequencia, 0) / linhas.length,
      aprendizado: linhas.some((l) => l.aprendizado),
    };
  });

  const vencedor = n > 1 ? criativos.reduce((a, b) => (b.chanceMelhor > a.chanceMelhor ? b : a)).nome : null;
  const curvaVerba = curva(e, base, efeitos);
  const verbaRecomendada = recomendar(curvaVerba);

  return {
    objetivo: e.objetivo,
    resultadoNome: NOME_RESULTADO[e.objetivo],
    base: { cpm: base.cpm, ctr: base.ctr, conversao: base.conversao, fonte: base.fonte, pesoConta: base.pesoConta },
    total: {
      investimento, impressoes, alcance, frequencia: impressoes / Math.max(alcance, 1), cliques,
      ctr: impressoes ? (cliques / impressoes) * 100 : 0,
      cpm: impressoes ? (investimento / impressoes) * 1000 : 0,
      resultados, custoPorResultado: cprTot, vendas, receita,
      roas: receita !== null && investimento > 0 ? receita / investimento : null,
    },
    criativos,
    vencedor,
    curvaVerba,
    verbaRecomendada,
    serie,
    alertas: alertas(e, criativos, resultados.p50, impressoes / Math.max(alcance, 1)),
    rodadas: RODADAS,
  };
}

/** Quanto rende cada nível de verba (retornos decrescentes). */
function curva(e: EntradaSimulacao, base: Base, efeitos: ReturnType<typeof efeitoDoCriativo>[]): PontoVerba[] {
  const fatores = [0.25, 0.5, 1, 1.5, 2, 3, 5];
  const n = e.criativos.length;
  const ePorCriativo = { ...e, publico: e.publico / Math.max(1, Math.sqrt(n)) };
  return fatores.map((f) => {
    const orc = Math.max(6, e.orcamentoDia * f);
    // Mesma semente em todos os níveis (números aleatórios comuns): a curva
    // mostra o efeito da verba, não o ruído entre sorteios.
    const r = rng(hash(`${JSON.stringify(e)}|curva`));
    const tot: number[] = [];
    for (let k = 0; k < 120; k++) {
      const mercado = { cpm: lognormal(r, 0.18), ctr: lognormal(r, 0.12), conv: lognormal(r, 0.2) };
      let soma = 0;
      for (let i = 0; i < n; i++) soma += rodar(ePorCriativo, orc / n, base, efeitos[i], mercado, r).resultados;
      tot.push(soma);
    }
    const res = mediana(tot);
    return { orcamentoDia: Math.round(orc), resultados: res, custoPorResultado: res > 0 ? (orc * e.dias) / res : 0 };
  });
}

/**
 * Maior verba cujo custo por resultado não passa de 30% acima do custo da
 * verba mais eficiente da curva: dali para cima cada real rende bem menos.
 */
function recomendar(c: PontoVerba[]): number | null {
  const validos = c.filter((p) => p.custoPorResultado > 0);
  if (!validos.length) return null;
  const melhor = Math.min(...validos.map((p) => p.custoPorResultado));
  const ok = validos.filter((p) => p.custoPorResultado <= melhor * 1.3);
  return ok.length ? Math.max(...ok.map((p) => p.orcamentoDia)) : null;
}

function alertas(e: EntradaSimulacao, cs: ResultadoCriativo[], resultados: number, frequencia: number): ResultadoSimulacao['alertas'] {
  const out: ResultadoSimulacao['alertas'] = [];
  const porSemana = (resultados / e.dias) * 7 / cs.length;
  if (e.objetivo !== 'alcance' && e.objetivo !== 'engajamento' && porSemana < EVENTOS_APRENDIZADO) {
    const cprMedio = resultados > 0 ? (e.orcamentoDia * e.dias) / resultados : 0;
    const necessario = cprMedio > 0 ? Math.ceil((EVENTOS_APRENDIZADO / 7) * cprMedio * cs.length) : null;
    out.push({
      nivel: 'atencao',
      texto: `Aprendizado limitado: cerca de ${Math.round(porSemana)} ${NOME_RESULTADO[e.objetivo]} por semana em cada conjunto. A Meta otimiza bem a partir de ~50 por semana.${necessario ? ` Para chegar lá, a verba seria perto de R$ ${necessario}/dia.` : ''}${cs.length > 1 ? ' Testar menos criativos ao mesmo tempo também ajuda.' : ''}`,
    });
  }
  if (frequencia > 3.5) out.push({ nivel: 'atencao', texto: `Frequência alta (${frequencia.toFixed(1)}): o público é pequeno para essa verba e o criativo cansa. Amplie o público ou renove o criativo a cada 1–2 semanas.` });
  if (e.orcamentoDia < 15) out.push({ nivel: 'info', texto: 'Verba baixa: a entrega oscila muito de um dia para o outro. Leia o resultado pela semana, não pelo dia.' });
  for (const c of cs) {
    if (c.nota.riscoReprovacao) out.push({ nivel: 'risco', texto: `"${c.nome}": o texto tem trecho com risco de reprovação na Meta. Veja os motivos na nota da copy.` });
    if (c.nota.geral < 45) out.push({ nivel: 'atencao', texto: `"${c.nome}" está fraco (nota ${c.nota.geral}). Reescreva o hook antes de pôr verba.` });
  }
  return out;
}
