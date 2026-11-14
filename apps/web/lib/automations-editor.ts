/**
 * Lógica pura do editor de automações (Q3.3): desfazer/refazer, inserir nó
 * entre dois, copiar/colar, excluir religando, auto-layout vertical e mapa de
 * atalhos. Sem React e sem rede: o canvas chama estas funções e os testes
 * (vitest) as exercitam diretamente.
 */
import type { ArestaGrafo, Grafo, NoGrafo, NotaGrafo } from './automations';

// ============================================================ histórico

/** Pilha de snapshots. `passado` = estados anteriores; `futuro` = o que o desfazer tirou. */
export interface Historico<T> {
  passado: T[];
  futuro: T[];
  /** Chave da última gravação (agrupa digitação contínua no mesmo campo). */
  ultimaChave: string | null;
  ultimoEm: number;
}

export const LIMITE_HISTORICO = 100;
/** Edições com a mesma chave dentro desta janela viram um passo só no desfazer. */
export const JANELA_AGRUPAR_MS = 1000;

export function novoHistorico<T>(): Historico<T> {
  return { passado: [], futuro: [], ultimaChave: null, ultimoEm: 0 };
}

/**
 * Grava o estado ANTES de uma mudança. Com `chave` (ex.: `config:<noId>`), uma
 * sequência de edições no mesmo lugar dentro de `janelaMs` vira um único passo:
 * Ctrl+Z desfaz a palavra digitada, não cada letra. Qualquer gravação nova
 * apaga o futuro (refazer), como em todo editor.
 */
export function registrar<T>(
  h: Historico<T>,
  estadoAntes: T,
  opts: { chave?: string; agora?: number; janelaMs?: number; limite?: number } = {},
): Historico<T> {
  const agora = opts.agora ?? Date.now();
  const janela = opts.janelaMs ?? JANELA_AGRUPAR_MS;
  if (opts.chave && h.ultimaChave === opts.chave && agora - h.ultimoEm < janela && h.passado.length > 0) {
    return { ...h, futuro: [], ultimoEm: agora };
  }
  const limite = opts.limite ?? LIMITE_HISTORICO;
  const passado = [...h.passado, estadoAntes];
  if (passado.length > limite) passado.splice(0, passado.length - limite);
  return { passado, futuro: [], ultimaChave: opts.chave ?? null, ultimoEm: agora };
}

export function desfazer<T>(h: Historico<T>, atual: T): { historico: Historico<T>; estado: T } | null {
  if (!h.passado.length) return null;
  const estado = h.passado[h.passado.length - 1];
  return {
    estado,
    historico: { passado: h.passado.slice(0, -1), futuro: [...h.futuro, atual], ultimaChave: null, ultimoEm: 0 },
  };
}

export function refazer<T>(h: Historico<T>, atual: T): { historico: Historico<T>; estado: T } | null {
  if (!h.futuro.length) return null;
  const estado = h.futuro[h.futuro.length - 1];
  return {
    estado,
    historico: { passado: [...h.passado, atual], futuro: h.futuro.slice(0, -1), ultimaChave: null, ultimoEm: 0 },
  };
}

// ============================================================ utilidades

const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Ids alcançáveis a partir de `inicio` seguindo as arestas (inclui `inicio`). */
export function descendentes(arestas: ArestaGrafo[], inicio: string, ignorar?: Set<string>): Set<string> {
  const vistos = new Set<string>();
  const fila = [inicio];
  while (fila.length) {
    const atual = fila.shift()!;
    if (vistos.has(atual) || ignorar?.has(atual)) continue;
    vistos.add(atual);
    for (const a of arestas) if (a.de === atual && !vistos.has(a.para)) fila.push(a.para);
  }
  return vistos;
}

// ============================================================ inserir entre

export const ESPACO_Y = 170;
export const LARGURA_NO = 240;
export const ESPACO_X = 60;
/** Layout horizontal (estilo GHL avançado): distância entre colunas (cabe a aresta e o "+"). */
export const ESPACO_COLUNA = 110;
/** Layout horizontal: distância entre linhas (ramos e gatilhos empilhados). */
export const ALTURA_LINHA = 150;
/** Passo de uma coluna para a próxima no layout horizontal. */
export const PASSO_COLUNA = LARGURA_NO + ESPACO_COLUNA;

/**
 * Insere `novo` no meio da aresta `arestaId` (o "+" do canvas).
 *
 * - A aresta `de → para` vira `de → novo` (mantendo o ramo de origem: inserir
 *   dentro do caminho "Sim" de uma condição continua no "Sim") e
 *   `novo → para`.
 * - Se o nó novo tem saídas nomeadas (condição, split, esperar resposta), o
 *   resto do fluxo sai pela PRIMEIRA delas; as outras ficam para o usuário ligar.
 * - O nó novo ocupa o lugar de `para`, e `para` desce (ou, no layout
 *   horizontal, `eixo: 'x'`, vai para a direita) junto com tudo que vem
 *   depois dele, abrindo espaço sem sobrepor cards.
 */
export function inserirEntre(
  g: Grafo,
  arestaId: string,
  novo: NoGrafo,
  opts: { gerarId: () => string; ramosDoNovo?: string[]; espacoY?: number; eixo?: 'x' | 'y'; espacoX?: number },
): Grafo {
  const a = g.arestas.find((x) => x.id === arestaId);
  if (!a) return g;
  const destino = g.nos.find((n) => n.id === a.para);
  const horizontal = opts.eixo === 'x';
  const dx = horizontal ? opts.espacoX ?? PASSO_COLUNA : 0;
  const dy = horizontal ? 0 : opts.espacoY ?? ESPACO_Y;
  const posNovo = destino ? { ...destino.posicao } : novo.posicao;

  const empurrar = descendentes(g.arestas, a.para, new Set([novo.id]));
  const nos = g.nos.map((n) => (empurrar.has(n.id) ? { ...n, posicao: { x: n.posicao.x + dx, y: n.posicao.y + dy } } : n));

  const entrada: ArestaGrafo = { id: opts.gerarId(), de: a.de, para: novo.id, ...(a.ramo ? { ramo: a.ramo } : {}) };
  const ramoSaida = opts.ramosDoNovo?.[0];
  const saida: ArestaGrafo = { id: opts.gerarId(), de: novo.id, para: a.para, ...(ramoSaida ? { ramo: ramoSaida } : {}) };

  return {
    ...g,
    nos: [...nos, { ...novo, posicao: posNovo }],
    arestas: [...g.arestas.filter((x) => x.id !== arestaId), entrada, saida],
  };
}

// ============================================================ copiar / colar

export interface Recorte {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  notas: NotaGrafo[];
}

/** O que vai para a área de transferência: os nós/notas escolhidos e as arestas ENTRE eles. */
export function recortar(g: Grafo, ids: Set<string>): Recorte {
  return clonar({
    nos: g.nos.filter((n) => ids.has(n.id)),
    arestas: g.arestas.filter((a) => ids.has(a.de) && ids.has(a.para)),
    notas: (g.notas ?? []).filter((n) => ids.has(n.id)),
  });
}

/**
 * Cola um recorte com ids NOVOS (nunca colide com o que já está no canvas),
 * mantendo a config de cada nó. Referências internas são religadas: arestas e
 * o destino de "Ir para" que apontava para um nó copiado passam a apontar para
 * a cópia; "Ir para" que apontava para fora continua apontando para o original.
 */
export function colar(r: Recorte, gerarId: (prefixo: 'n' | 'e' | 'nota') => string, deslocamento = { x: 40, y: 40 }): Recorte & { mapa: Record<string, string> } {
  const mapa: Record<string, string> = {};
  for (const n of r.nos) mapa[n.id] = gerarId('n');
  for (const n of r.notas) mapa[n.id] = gerarId('nota');
  const mover = (p: { x: number; y: number }) => ({ x: p.x + deslocamento.x, y: p.y + deslocamento.y });

  const nos = r.nos.map((n) => {
    const config = clonar(n.config);
    const alvo = (config as { alvoNoId?: unknown }).alvoNoId;
    if (n.tipo === 'controle.ir_para' && typeof alvo === 'string' && mapa[alvo]) {
      (config as { alvoNoId: string }).alvoNoId = mapa[alvo];
    }
    return { ...clonar(n), id: mapa[n.id], posicao: mover(n.posicao), config };
  });
  const arestas = r.arestas
    .filter((a) => mapa[a.de] && mapa[a.para])
    .map((a) => ({ ...a, id: gerarId('e'), de: mapa[a.de], para: mapa[a.para] }));
  const notas = r.notas.map((n) => ({ ...clonar(n), id: mapa[n.id], posicao: mover(n.posicao) }));
  return { nos, arestas, notas, mapa };
}

// ============================================================ excluir

/**
 * Exclui nós/notas e as arestas ligadas a eles. Quando o nó removido é um elo
 * simples da corrente (exatamente uma entrada e uma saída sem ramo), o pai é
 * religado direto ao filho, preservando o ramo de entrada: apagar o "Esperar"
 * do meio não parte o fluxo em dois.
 */
export function excluir(g: Grafo, ids: Set<string>, gerarId: () => string): Grafo {
  let arestas = [...g.arestas];
  for (const id of ids) {
    const entradas = arestas.filter((a) => a.para === id);
    const saidas = arestas.filter((a) => a.de === id);
    arestas = arestas.filter((a) => a.de !== id && a.para !== id);
    if (entradas.length === 1 && saidas.length === 1 && !saidas[0].ramo) {
      const de = entradas[0].de;
      const para = saidas[0].para;
      const ramo = entradas[0].ramo;
      const jaExiste = arestas.some((a) => a.de === de && a.para === para && (a.ramo ?? '') === (ramo ?? ''));
      if (!ids.has(de) && !ids.has(para) && de !== para && !jaExiste) {
        arestas.push({ id: gerarId(), de, para, ...(ramo ? { ramo } : {}) });
      }
    }
  }
  return {
    ...g,
    nos: g.nos.filter((n) => !ids.has(n.id)),
    arestas,
    notas: (g.notas ?? []).filter((n) => !ids.has(n.id)),
  };
}

// ============================================================ auto-layout

/**
 * Auto-layout vertical (de cima para baixo), sem dependência externa: árvore
 * geradora por busca em largura a partir dos gatilhos, cada nó centralizado
 * sobre os filhos, ramos na ordem em que o nó os declara (Sim antes de Não).
 * Nó que volta para um anterior (Ir para, laço) não puxa a árvore de novo.
 * Notas não se mexem: são anotação livre de quem montou o fluxo.
 */
export function organizarVertical(
  g: Grafo,
  opts: { ordemRamos?: (noId: string) => string[]; larguraNo?: number; espacoX?: number; espacoY?: number; origem?: { x: number; y: number } } = {},
): Grafo {
  if (!g.nos.length) return g;
  const larg = opts.larguraNo ?? LARGURA_NO;
  const passoX = larg + (opts.espacoX ?? ESPACO_X);
  const passoY = opts.espacoY ?? ESPACO_Y;
  const origem = opts.origem ?? { x: 0, y: 0 };
  const ids = new Set(g.nos.map((n) => n.id));
  const temEntrada = new Set(g.arestas.filter((a) => ids.has(a.de)).map((a) => a.para));

  const ordem = (noId: string, ramo?: string) => {
    if (!ramo) return Number.MAX_SAFE_INTEGER;
    const i = opts.ordemRamos?.(noId).indexOf(ramo) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };

  // raízes: gatilhos primeiro, depois quem não tem entrada; da esquerda para a direita
  const porX = [...g.nos].sort((a, b) => a.posicao.x - b.posicao.x || a.posicao.y - b.posicao.y);
  const raizes = [
    ...porX.filter((n) => n.tipo.startsWith('gatilho.')),
    ...porX.filter((n) => !n.tipo.startsWith('gatilho.') && !temEntrada.has(n.id)),
  ];

  const filhos = new Map<string, string[]>();
  const profundidade = new Map<string, number>();
  const visitar = (raiz: string) => {
    if (profundidade.has(raiz)) return;
    profundidade.set(raiz, 0);
    const fila = [raiz];
    while (fila.length) {
      const atual = fila.shift()!;
      const saidas = g.arestas
        .filter((a) => a.de === atual && ids.has(a.para))
        .sort((x, y) => ordem(atual, x.ramo) - ordem(atual, y.ramo));
      const lista: string[] = [];
      for (const s of saidas) {
        if (profundidade.has(s.para)) continue;
        profundidade.set(s.para, profundidade.get(atual)! + 1);
        lista.push(s.para);
        fila.push(s.para);
      }
      filhos.set(atual, lista);
    }
  };
  for (const r of raizes) visitar(r.id);
  for (const n of porX) visitar(n.id); // ciclos sem raiz

  const largura = new Map<string, number>();
  const medir = (id: string): number => {
    const f = filhos.get(id) ?? [];
    const w = f.length ? f.reduce((s, c) => s + medir(c), 0) : 1;
    largura.set(id, w);
    return w;
  };
  const pos = new Map<string, { x: number; y: number }>();
  const posicionar = (id: string, inicio: number) => {
    const w = largura.get(id) ?? 1;
    const centro = inicio + w / 2;
    pos.set(id, { x: Math.round(origem.x + centro * passoX - passoX / 2), y: Math.round(origem.y + (profundidade.get(id) ?? 0) * passoY) });
    let cursor = inicio;
    for (const c of filhos.get(id) ?? []) {
      posicionar(c, cursor);
      cursor += largura.get(c) ?? 1;
    }
  };
  let cursor = 0;
  const topos = [...raizes.map((r) => r.id), ...porX.map((n) => n.id)].filter((id, i, arr) => arr.indexOf(id) === i && (profundidade.get(id) ?? 0) === 0);
  for (const r of topos) {
    if (pos.has(r)) continue;
    medir(r);
    posicionar(r, cursor);
    cursor += largura.get(r) ?? 1;
  }

  return { ...g, nos: g.nos.map((n) => ({ ...n, posicao: pos.get(n.id) ?? n.posicao })) };
}

// ============================================================ atalhos

export type Comando = 'desfazer' | 'refazer' | 'copiar' | 'colar' | 'duplicar' | 'excluir' | 'organizar' | 'ajuda' | 'nota';

export interface Tecla {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** O foco está num campo de texto: o atalho é do campo, não do canvas. */
  emCampo: boolean;
}

/** Traduz uma tecla em comando do canvas (ou null). Ctrl e Cmd valem igual. */
export function comandoDaTecla(t: Tecla): Comando | null {
  if (t.emCampo || t.altKey) return null;
  const mod = t.ctrlKey || t.metaKey;
  const k = t.key.toLowerCase();
  if (mod && k === 'z') return t.shiftKey ? 'refazer' : 'desfazer';
  if (mod && k === 'y' && !t.shiftKey) return 'refazer';
  if (mod && !t.shiftKey && k === 'c') return 'copiar';
  if (mod && !t.shiftKey && k === 'v') return 'colar';
  if (mod && !t.shiftKey && k === 'd') return 'duplicar';
  if (mod && t.shiftKey && k === 'l') return 'organizar';
  if (!mod && (t.key === 'Delete' || t.key === 'Backspace')) return 'excluir';
  if (!mod && t.key === '?') return 'ajuda';
  if (!mod && !t.shiftKey && k === 'n') return 'nota';
  return null;
}

/** O que o "?" de ajuda lista. `mod` vira Ctrl ou ⌘ conforme o sistema. */
export const ATALHOS: { teclas: string[]; descricao: string }[] = [
  { teclas: ['mod', 'Z'], descricao: 'Desfazer' },
  { teclas: ['mod', 'Shift', 'Z'], descricao: 'Refazer (também mod + Y)' },
  { teclas: ['mod', 'C'], descricao: 'Copiar os nós selecionados' },
  { teclas: ['mod', 'V'], descricao: 'Colar (com ids novos e a mesma configuração)' },
  { teclas: ['mod', 'D'], descricao: 'Duplicar a seleção' },
  { teclas: ['Delete'], descricao: 'Excluir a seleção (o fluxo é religado quando dá)' },
  { teclas: ['mod', 'Shift', 'L'], descricao: 'Organizar o fluxo de cima para baixo' },
  { teclas: ['N'], descricao: 'Nova nota de texto no centro do canvas' },
  { teclas: ['Shift', 'arrastar'], descricao: 'Selecionar vários nós com uma caixa' },
  { teclas: ['?'], descricao: 'Mostrar estes atalhos' },
];

/**
 * Auto-layout HORIZONTAL (da esquerda para a direita), como o construtor
 * avançado do GHL: os gatilhos ficam empilhados numa coluna à esquerda, o
 * fluxo segue para a direita (uma coluna por passo) e os ramos de uma
 * condição se abrem para cima e para baixo, na ordem declarada (Sim antes
 * de Não). Vários gatilhos que levam ao mesmo passo compartilham a mesma
 * continuação: o fluxo fica centrado na coluna de gatilhos.
 * Laços (Ir para) não puxam a árvore de novo; notas não se mexem.
 */
export function organizarHorizontal(
  g: Grafo,
  opts: { ordemRamos?: (noId: string) => string[]; passoColuna?: number; alturaLinha?: number; origem?: { x: number; y: number } } = {},
): Grafo {
  if (!g.nos.length) return g;
  const passoX = opts.passoColuna ?? PASSO_COLUNA;
  const passoY = opts.alturaLinha ?? ALTURA_LINHA;
  const origem = opts.origem ?? { x: 0, y: 0 };
  const ids = new Set(g.nos.map((n) => n.id));
  const ehGat = (tipo: string) => tipo.startsWith('gatilho.');
  const temEntrada = new Set(g.arestas.filter((a) => ids.has(a.de)).map((a) => a.para));
  const ordem = (noId: string, ramo?: string) => {
    if (!ramo) return Number.MAX_SAFE_INTEGER;
    const i = opts.ordemRamos?.(noId).indexOf(ramo) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };

  // gatilhos na ordem em que aparecem (de cima para baixo, depois da esquerda)
  const porY = [...g.nos].sort((a, b) => a.posicao.y - b.posicao.y || a.posicao.x - b.posicao.x);
  const gatilhos = porY.filter((n) => ehGat(n.tipo));

  // Raiz virtual = todos os gatilhos. Os primeiros passos (saídas dos
  // gatilhos e passos sem entrada) ficam na coluna 1; o resto, por largura.
  const coluna = new Map<string, number>();
  const filhos = new Map<string, string[]>();
  for (const t of gatilhos) coluna.set(t.id, 0);
  const primeiros: string[] = [];
  const marcar = (id: string, col: number) => {
    if (coluna.has(id)) return false;
    coluna.set(id, col);
    return true;
  };
  for (const t of gatilhos) {
    const saidas = g.arestas.filter((a) => a.de === t.id && ids.has(a.para)).sort((x, y) => ordem(t.id, x.ramo) - ordem(t.id, y.ramo));
    for (const s of saidas) if (!ehGat(g.nos.find((n) => n.id === s.para)!.tipo) && marcar(s.para, 1)) primeiros.push(s.para);
  }
  for (const n of porY) if (!ehGat(n.tipo) && !temEntrada.has(n.id) && marcar(n.id, gatilhos.length ? 1 : 0)) primeiros.push(n.id);
  const fila = [...primeiros];
  while (fila.length) {
    const atual = fila.shift()!;
    const saidas = g.arestas
      .filter((a) => a.de === atual && ids.has(a.para))
      .sort((x, y) => ordem(atual, x.ramo) - ordem(atual, y.ramo));
    const lista: string[] = [];
    for (const s of saidas) {
      if (!marcar(s.para, coluna.get(atual)! + 1)) continue;
      lista.push(s.para);
      fila.push(s.para);
    }
    filhos.set(atual, lista);
  }
  // ciclos sem raiz: cada um vira um bloco a mais embaixo
  for (const n of porY) {
    if (coluna.has(n.id)) continue;
    marcar(n.id, gatilhos.length ? 1 : 0);
    primeiros.push(n.id);
    const f = [n.id];
    while (f.length) {
      const atual = f.shift()!;
      const lista: string[] = [];
      for (const s of g.arestas.filter((a) => a.de === atual && ids.has(a.para))) {
        if (!marcar(s.para, coluna.get(atual)! + 1)) continue;
        lista.push(s.para);
        f.push(s.para);
      }
      filhos.set(atual, lista);
    }
  }

  // altura (em linhas) de cada subárvore; o pai fica no meio dos filhos
  const altura = new Map<string, number>();
  const medir = (id: string): number => {
    const f = filhos.get(id) ?? [];
    const h = f.length ? f.reduce((s, c) => s + medir(c), 0) : 1;
    altura.set(id, h);
    return h;
  };
  const linha = new Map<string, number>();
  const posicionar = (id: string, inicio: number) => {
    const h = altura.get(id) ?? 1;
    linha.set(id, inicio + h / 2 - 0.5);
    let cursor = inicio;
    for (const c of filhos.get(id) ?? []) {
      posicionar(c, cursor);
      cursor += altura.get(c) ?? 1;
    }
  };
  let cursor = 0;
  for (const r of primeiros) {
    medir(r);
    posicionar(r, cursor);
    cursor += altura.get(r) ?? 1;
  }
  const linhasFluxo = cursor;

  // coluna de gatilhos centrada na altura do fluxo (e vice-versa)
  const total = Math.max(linhasFluxo, gatilhos.length);
  const offFluxo = (total - linhasFluxo) / 2;
  const offGat = (total - gatilhos.length) / 2;
  gatilhos.forEach((t, i) => linha.set(t.id, offGat + i));
  for (const id of linha.keys()) if (!gatilhos.some((t) => t.id === id)) linha.set(id, linha.get(id)! + offFluxo);

  const pos = (id: string) => ({ x: Math.round(origem.x + (coluna.get(id) ?? 0) * passoX), y: Math.round(origem.y + (linha.get(id) ?? 0) * passoY) });
  return { ...g, nos: g.nos.map((n) => (coluna.has(n.id) ? { ...n, posicao: pos(n.id) } : n)) };
}

/**
 * Fluxo salvo no layout antigo (de cima para baixo)? Mais de 2 nós e
 * espalhados mais na vertical que na horizontal. O editor reorganiza na
 * horizontal ao abrir (sem gravar até a pessoa mexer).
 */
export function pareceVertical(g: Grafo): boolean {
  if (g.nos.length <= 2) return false;
  const xs = g.nos.map((n) => n.posicao.x);
  const ys = g.nos.map((n) => n.posicao.y);
  return Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs);
}

/** Primeiro passo do fluxo: para onde os gatilhos levam (ou o passo sem entrada). */
export function primeiroPasso(g: Grafo): string | null {
  const ehGat = (id: string) => g.nos.find((n) => n.id === id)?.tipo.startsWith('gatilho.') ?? false;
  const daGatilho = g.arestas.find((a) => ehGat(a.de) && !ehGat(a.para));
  if (daGatilho) return daGatilho.para;
  const comEntrada = new Set(g.arestas.map((a) => a.para));
  return g.nos.find((n) => !n.tipo.startsWith('gatilho.') && !comEntrada.has(n.id))?.id ?? null;
}
