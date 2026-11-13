import type { ConfigFragmentacao } from '../config/agent-config';

/**
 * MESSAGE CHUNKING ENGINE (docs/AI_AGENT_ARCHITECTURE.md §6.1)
 * ============================================================
 *
 * Transforma UMA resposta do modelo em blocos de WhatsApp naturais.
 *
 * Duas camadas:
 *  1. **Semântica** — o prompt pede ao modelo que separe ideias com linha em
 *     branco. Cada parágrafo é uma unidade de sentido escolhida pelo próprio
 *     modelo. Dentro dele, as frases são classificadas (saudação, informação,
 *     pergunta, chamada para ação) e a troca de função abre bloco novo — é o
 *     que separa "Olá, Ana! Tudo bem?" do conteúdo e deixa a pergunta final
 *     sozinha, como uma pessoa faria.
 *  2. **Determinística** (fallback e garantia) — limites de caracteres,
 *     palavras e emojis por bloco; mín./máx. de blocos; frase longa demais
 *     quebra em oração (`;`, `:`, `,`, conjunções) e, só em último caso, em
 *     palavra. Nunca corta palavra, número, URL ou e-mail.
 *
 * Função pura: sem I/O, sem relógio, sem aleatoriedade — mesma entrada,
 * mesma saída (testável e reproduzível no simulador).
 */

export interface BlocoMensagem {
  ordem: number;
  texto: string;
  /** Espera ANTES de enviar este bloco (simula digitação). */
  atrasoMs: number;
}

export interface ResultadoFragmentacao {
  blocos: BlocoMensagem[];
  estrategia: 'semantica' | 'deterministica' | 'unica';
  /** Ajustes aplicados (emoji removido, limite excedido…) — vai para o trace. */
  ajustes: string[];
}

type TipoFrase = 'saudacao' | 'pergunta' | 'cta' | 'info';
interface Frase {
  texto: string;
  tipo: TipoFrase;
  paragrafo: number;
}

// Abreviações em pt-BR. TÍTULOS são abreviação mesmo antes de maiúscula
// ("Dra. Paula"); as DEMAIS só quando a próxima palavra é minúscula ou número
// ("às 14h. O valor…" encerra a frase; "aprox. 3 dias" não).
const TITULOS = new Set(['dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'av', 'eng', 'adv', 'exmo', 'exma', 'sto', 'sta']);
const ABREVIACOES = new Set([
  'ex', 'etc', 'obs', 'pág', 'pag', 'tel', 'cel', 'nº', 'no', 'n', 'vs', 'aprox', 'min', 'máx', 'max', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez', 'ltda', 'cia', 'p', 'pg', 'h', 'hr', 'hrs', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'sab', 'dom', 'qtd', 'ref',
]);

const RE_EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;
const RE_SAUDACAO = /^(oi+|ol[áa]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo (bem|bom|certo|joia|tranquilo)|como vai|como (voc[eê]|vc) est[áa]|prazer|seja bem[- ]vind[oa]|bem[- ]vind[oa])\b/i;
const RE_CTA = /^(posso|podemos|quer que|gostaria de agendar|vamos|me (conta|diz|fala|manda|envia)|clique|acesse|responda|confirma|me confirma)\b/i;

export function contarEmojis(texto: string): number {
  return (texto.match(RE_EMOJI) ?? []).length;
}

function contarPalavras(texto: string): number {
  return texto.trim() ? texto.trim().split(/\s+/).length : 0;
}

/** Remove marcação que o WhatsApp mostraria crua (títulos, negrito duplo, bullets markdown). */
export function limparMarkdown(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Segmenta em frases respeitando abreviações, números (R$ 1.500,00; 3.5),
 * URLs, e-mails, reticências e pontuação composta (?!). Emoji logo após o
 * fim da frase fica com ela.
 */
export function segmentarFrases(paragrafo: string): string[] {
  const frases: string[] = [];
  let atual = '';
  const n = paragrafo.length;
  for (let i = 0; i < n; i++) {
    const c = paragrafo[i];
    atual += c;
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…' && c !== '\n') continue;
    if (c === '\n') {
      // Quebra de linha explícita (lista/bullet) encerra a frase.
      if (atual.trim()) frases.push(atual.trim());
      atual = '';
      continue;
    }
    // Absorve pontuação repetida ("?!", "...", "!!").
    while (i + 1 < n && /[.!?…]/.test(paragrafo[i + 1])) atual += paragrafo[++i];
    const prox = paragrafo[i + 1];
    if (c === '.' && prox !== undefined && /\S/.test(prox)) continue; // 1.500 / site.com / a.b@c.d
    if (c === '.') {
      const palavra = (atual.slice(0, -1).match(/([\p{L}º]+)$/u)?.[1] ?? '').toLowerCase();
      if (!/\.\.$/.test(atual)) {
        if (TITULOS.has(palavra)) continue;
        const seguinte = paragrafo.slice(i + 1).trimStart()[0];
        if (ABREVIACOES.has(palavra) && seguinte !== undefined && /[\p{Ll}\d]/u.test(seguinte)) continue;
      }
    }
    // Emojis/aspas/parênteses colados ao fim continuam na mesma frase.
    while (i + 1 < n) {
      const resto = paragrafo.slice(i + 1);
      const m = resto.match(/^\s?(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|["'”’)\]])/u);
      if (!m) break;
      atual += m[0];
      i += m[0].length;
    }
    if (atual.trim()) frases.push(atual.trim());
    atual = '';
  }
  if (atual.trim()) frases.push(atual.trim());
  return frases;
}

function classificar(frase: string): TipoFrase {
  const t = frase.replace(RE_EMOJI, '').trim();
  if (RE_SAUDACAO.test(t) && t.length <= 60) return 'saudacao';
  if (/\?\s*["'”’)]?$/.test(t)) return 'pergunta';
  if (RE_CTA.test(t)) return 'cta';
  return 'info';
}

/** Quebra frase longa em orações; em último caso por palavras. Nunca corta palavra. */
export function quebrarFraseLonga(frase: string, maxChars: number, maxPalavras: number): string[] {
  const cabe = (s: string) => s.length <= maxChars && contarPalavras(s) <= maxPalavras;
  if (cabe(frase)) return [frase];
  const separadores = [/(?<=;)\s+/, /(?<=:)\s+/, /(?<=,)\s+(?=(?:mas|porém|porque|pois|então|entretanto|além disso|e também)\b)/i, /(?<=,)\s+/, /\s+(?=(?:mas|porém|porque|pois|então|e)\s)/i];
  for (const sep of separadores) {
    const partes = frase.split(sep).map((p) => p.trim()).filter(Boolean);
    if (partes.length < 2) continue;
    const juntas: string[] = [];
    for (const p of partes) {
      const ult = juntas[juntas.length - 1];
      if (ult !== undefined && cabe(`${ult} ${p}`)) juntas[juntas.length - 1] = `${ult} ${p}`;
      else juntas.push(p);
    }
    if (juntas.every(cabe)) return juntas;
    // Recursão só nos pedaços que ainda não cabem.
    if (juntas.length > 1) return juntas.flatMap((j) => quebrarFraseLonga(j, maxChars, maxPalavras));
  }
  // Último recurso: por palavras (tokens com URL/e-mail/número ficam inteiros).
  const palavras = frase.split(/\s+/);
  const saida: string[] = [];
  let buf = '';
  for (const p of palavras) {
    const cand = buf ? `${buf} ${p}` : p;
    if (buf && !cabe(cand)) {
      saida.push(buf);
      buf = p;
    } else buf = cand;
  }
  if (buf) saida.push(buf);
  return saida;
}

function limitarEmojis(texto: string, max: number): { texto: string; removidos: number } {
  let vistos = 0;
  let removidos = 0;
  const t = texto.replace(RE_EMOJI, (e) => {
    vistos++;
    if (vistos > max) {
      removidos++;
      return '';
    }
    return e;
  });
  return { texto: t.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim(), removidos };
}

/** Atraso de "digitação" proporcional ao tamanho, dentro da faixa configurada. */
export function atrasoDigitacao(texto: string, cfg: Pick<ConfigFragmentacao, 'digitacaoCps' | 'intervaloMinMs' | 'intervaloMaxMs'>): number {
  const ms = Math.round((texto.length / cfg.digitacaoCps) * 1000);
  return Math.min(cfg.intervaloMaxMs, Math.max(cfg.intervaloMinMs, ms));
}

/** Junta frases do mesmo bloco; a introdução "…:" e a lista seguinte ficam em linhas próprias. */
function juntar(g: Frase[]): string {
  return g.reduce((acc, x, i) => (i === 0 ? x.texto : `${acc}${x.texto.includes('\n') && acc.endsWith(':') ? '\n' : ' '}${x.texto}`), '');
}

export function fragmentarMensagem(textoBruto: string, cfg: ConfigFragmentacao): ResultadoFragmentacao {
  const ajustes: string[] = [];
  const texto = limparMarkdown(textoBruto);
  if (!texto) return { blocos: [], estrategia: 'unica', ajustes };

  if (!cfg.ativo) {
    const { texto: t, removidos } = limitarEmojis(texto, Math.max(cfg.maxEmojisBloco, 3));
    if (removidos) ajustes.push(`${removidos} emoji(s) removido(s)`);
    return { blocos: [{ ordem: 1, texto: t, atrasoMs: atrasoDigitacao(t, cfg) }], estrategia: 'unica', ajustes };
  }

  const maxC = cfg.maxCaracteresBloco;
  const maxP = cfg.maxPalavrasBloco;
  const cabe = (s: string) => s.length <= maxC && contarPalavras(s) <= maxP;

  // 1) parágrafos (fronteira semântica do modelo) → frases classificadas
  const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const semantica = paragrafos.length > 1;
  const frases: Frase[] = [];
  paragrafos.forEach((p, idx) => {
    const linhas = p.split('\n').map((l) => l.trim()).filter(Boolean);
    // Só é LISTA se as linhas têm marcador ("• ", "- ", "1.") ou se há uma
    // introdução "…:". Frases soltas em linhas seguidas continuam sendo frases
    // (cada uma pode virar seu balão).
    const marcadas = linhas.filter((l) => /^(•|\d{1,2}[.)])\s/.test(l)).length;
    const ehListaReal = linhas.length > 1 && (marcadas >= 2 || (linhas[0].endsWith(':') && marcadas >= 1));
    if (ehListaReal) {
      // Lista: as linhas ficam juntas (com a quebra) até o limite de caracteres.
      // Uma linha de abertura terminada em ":" é a introdução da lista.
      const intro = linhas[0].endsWith(':') ? linhas.shift()! : null;
      if (intro) for (const f of segmentarFrases(intro)) frases.push({ texto: f, tipo: classificar(f), paragrafo: idx });
      let buf = '';
      for (const l of linhas) {
        if (buf && `${buf}\n${l}`.length > maxC) {
          frases.push({ texto: buf, tipo: 'info', paragrafo: idx });
          buf = l;
        } else buf = buf ? `${buf}\n${l}` : l;
      }
      if (buf) frases.push({ texto: buf, tipo: 'info', paragrafo: idx });
      return;
    }
    for (const f of segmentarFrases(p)) {
      for (const pedaco of quebrarFraseLonga(f, maxC, maxP)) {
        if (pedaco !== f && !ajustes.includes('frase longa quebrada em orações')) ajustes.push('frase longa quebrada em orações');
        frases.push({ texto: pedaco, tipo: classificar(pedaco), paragrafo: idx });
      }
    }
  });

  // 2) agrupamento por função + tamanho
  const alvo = Math.min(cfg.tamanhoMedio, maxC);
  const grupos: Frase[][] = [];
  for (const f of frases) {
    const g = grupos[grupos.length - 1];
    if (!g) {
      grupos.push([f]);
      continue;
    }
    const ult = g[g.length - 1];
    const juntoTexto = juntar([...g, f]);
    const ehLista = (x: Frase) => x.texto.includes('\n');
    const mudouParagrafo = f.paragrafo !== ult.paragrafo && cfg.quebraSemantica !== 'frases';
    const tamanhoAtual = g.reduce((t, x) => t + x.texto.length + 1, 0);
    let quebrar: boolean;
    if (ehLista(ult) || (ehLista(f) && !ult.texto.endsWith(':'))) quebrar = true;
    else if (ehLista(f)) quebrar = juntoTexto.length > maxC;
    else if (!cabe(juntoTexto)) quebrar = true;
    else if (cfg.quebraSemantica === 'paragrafos') quebrar = mudouParagrafo;
    else if (cfg.quebraSemantica === 'frases') quebrar = !(ult.tipo === 'saudacao' && f.tipo === 'saudacao');
    else if (mudouParagrafo) quebrar = true;
    else if (ult.tipo === 'saudacao') quebrar = f.tipo !== 'saudacao';
    else if (f.tipo === 'pergunta' || f.tipo === 'cta') quebrar = ult.tipo === 'info' ? tamanhoAtual >= alvo * 0.35 : false;
    else quebrar = cfg.preferirCurtas ? tamanhoAtual >= alvo * 0.6 || juntoTexto.length > alvo : juntoTexto.length > alvo * 1.5;
    if (quebrar) grupos.push([f]);
    else g.push(f);
  }

  let blocos = grupos.map((g) => juntar(g));

  // 2b) balão que é só um aparte "(Gel ou comum)" volta para o anterior
  blocos = blocos.reduce<string[]>((acc, b) => {
    if (acc.length && /^\([^()]{1,80}\)[.!?]?$/.test(b.trim())) acc[acc.length - 1] = `${acc[acc.length - 1]} ${b.trim()}`;
    else acc.push(b);
    return acc;
  }, []);

  // 3) máximo de blocos: funde o par adjacente de menor soma (preferindo o que cabe)
  while (blocos.length > cfg.maxBlocos) {
    let melhor = -1;
    let melhorTam = Infinity;
    for (let i = 0; i < blocos.length - 1; i++) {
      const tam = blocos[i].length + blocos[i + 1].length + 1;
      const penal = cabe(`${blocos[i]} ${blocos[i + 1]}`) ? 0 : 100_000;
      if (tam + penal < melhorTam) {
        melhorTam = tam + penal;
        melhor = i;
      }
    }
    if (melhorTam >= 100_000 && !ajustes.includes('conteúdo excede maxBlocos × maxCaracteresBloco: limite de caracteres relaxado')) {
      ajustes.push('conteúdo excede maxBlocos × maxCaracteresBloco: limite de caracteres relaxado');
    }
    blocos = [...blocos.slice(0, melhor), `${blocos[melhor]} ${blocos[melhor + 1]}`, ...blocos.slice(melhor + 2)];
  }

  // 4) mínimo de blocos: divide o maior bloco que tenha mais de uma frase
  while (blocos.length < cfg.minBlocos) {
    let idx = -1;
    let frasesIdx: string[] = [];
    for (let i = 0; i < blocos.length; i++) {
      const fs = segmentarFrases(blocos[i]);
      if (fs.length > 1 && (idx < 0 || blocos[i].length > blocos[idx].length)) {
        idx = i;
        frasesIdx = fs;
      }
    }
    if (idx < 0) break; // não inventa divisão no meio de uma frase única
    const meio = Math.ceil(frasesIdx.length / 2);
    blocos = [...blocos.slice(0, idx), frasesIdx.slice(0, meio).join(' '), frasesIdx.slice(meio).join(' '), ...blocos.slice(idx + 1)];
  }

  // 5) emojis e pontuação por bloco
  let totalRemovidos = 0;
  blocos = blocos.map((b) => {
    const { texto: t, removidos } = limitarEmojis(b, cfg.maxEmojisBloco);
    totalRemovidos += removidos;
    if (cfg.pontuacao === 'leve' && /[^.]\.$/.test(t) && !/\b(etc|ltda)\.$/i.test(t)) return t.slice(0, -1);
    return t;
  }).filter(Boolean);
  if (totalRemovidos) ajustes.push(`${totalRemovidos} emoji(s) acima do limite removido(s)`);

  const saida = blocos.map((t, i) => ({ ordem: i + 1, texto: t, atrasoMs: atrasoDigitacao(t, cfg) }));
  return { blocos: saida, estrategia: semantica ? 'semantica' : 'deterministica', ajustes };
}
