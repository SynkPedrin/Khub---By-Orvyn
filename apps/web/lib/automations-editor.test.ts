import { describe, expect, it } from 'vitest';
import {
  colar,
  comandoDaTecla,
  desfazer,
  excluir,
  inserirEntre,
  novoHistorico,
  organizarHorizontal,
  organizarVertical,
  pareceVertical,
  primeiroPasso,
  recortar,
  refazer,
  registrar,
  type Tecla,
} from './automations-editor';
import type { Grafo, NoGrafo } from './automations';

const no = (id: string, tipo: string, x = 0, y = 0, config: Record<string, unknown> = {}): NoGrafo => ({ id, tipo, posicao: { x, y }, config });
const seq = (prefixo = 'x') => {
  let i = 0;
  return () => `${prefixo}${++i}`;
};

describe('histórico (desfazer/refazer)', () => {
  it('desfaz e refaz na ordem certa', () => {
    let h = novoHistorico<number>();
    h = registrar(h, 1, { agora: 0 });
    h = registrar(h, 2, { agora: 5000 });
    const d1 = desfazer(h, 3)!;
    expect(d1.estado).toBe(2);
    const d2 = desfazer(d1.historico, 2)!;
    expect(d2.estado).toBe(1);
    expect(desfazer(d2.historico, 1)).toBeNull();
    const r1 = refazer(d2.historico, 1)!;
    expect(r1.estado).toBe(2);
    const r2 = refazer(r1.historico, 2)!;
    expect(r2.estado).toBe(3);
    expect(refazer(r2.historico, 3)).toBeNull();
  });

  it('gravar depois de desfazer apaga o futuro', () => {
    let h = registrar(novoHistorico<string>(), 'a', { agora: 0 });
    const d = desfazer(h, 'b')!;
    h = registrar(d.historico, 'a', { agora: 10 });
    expect(h.futuro).toEqual([]);
    expect(refazer(h, 'c')).toBeNull();
  });

  it('digitação contínua no mesmo campo vira um passo só', () => {
    let h = novoHistorico<string>();
    h = registrar(h, '', { chave: 'config:n1', agora: 0 });
    h = registrar(h, 'O', { chave: 'config:n1', agora: 300 });
    h = registrar(h, 'Oi', { chave: 'config:n1', agora: 600 });
    expect(h.passado).toEqual(['']);
    // outra chave, ou depois da janela, abre passo novo
    h = registrar(h, 'Oi!', { chave: 'config:n2', agora: 700 });
    h = registrar(h, 'x', { chave: 'config:n2', agora: 5000 });
    expect(h.passado).toEqual(['', 'Oi!', 'x']);
  });

  it('respeita o limite descartando o mais antigo', () => {
    let h = novoHistorico<number>();
    for (let i = 0; i < 5; i++) h = registrar(h, i, { agora: i * 10_000, limite: 3 });
    expect(h.passado).toEqual([2, 3, 4]);
  });
});

describe('inserirEntre', () => {
  const base: Grafo = {
    nos: [no('g', 'gatilho.contato_criado', 0, 0), no('c', 'controle.condicao', 0, 170), no('sim', 'acao.adicionar_tag', -150, 340), no('nao', 'controle.encerrar', 150, 340), no('fim', 'controle.encerrar', -150, 510)],
    arestas: [
      { id: 'a1', de: 'g', para: 'c' },
      { id: 'a2', de: 'c', para: 'sim', ramo: 'r-sim' },
      { id: 'a3', de: 'c', para: 'nao', ramo: 'r-nao' },
      { id: 'a4', de: 'sim', para: 'fim' },
    ],
  };

  it('religa as duas pontas e mantém o ramo de origem', () => {
    const g = inserirEntre(base, 'a2', no('novo', 'controle.esperar'), { gerarId: seq('e') });
    expect(g.arestas.find((a) => a.id === 'a2')).toBeUndefined();
    expect(g.arestas).toEqual(expect.arrayContaining([
      { id: 'e1', de: 'c', para: 'novo', ramo: 'r-sim' },
      { id: 'e2', de: 'novo', para: 'sim' },
    ]));
    // o outro ramo não foi tocado
    expect(g.arestas).toContainEqual({ id: 'a3', de: 'c', para: 'nao', ramo: 'r-nao' });
  });

  it('o novo ocupa o lugar do destino e só o caminho de baixo desce', () => {
    const g = inserirEntre(base, 'a2', no('novo', 'controle.esperar'), { gerarId: seq(), espacoY: 100 });
    const p = (id: string) => g.nos.find((n) => n.id === id)!.posicao;
    expect(p('novo')).toEqual({ x: -150, y: 340 });
    expect(p('sim')).toEqual({ x: -150, y: 440 });
    expect(p('fim')).toEqual({ x: -150, y: 610 });
    expect(p('nao')).toEqual({ x: 150, y: 340 }); // ramo vizinho fica parado
    expect(p('g')).toEqual({ x: 0, y: 0 });
  });

  it('nó ramificado inserido segue pela primeira saída', () => {
    const g = inserirEntre(base, 'a1', no('cond2', 'controle.condicao'), { gerarId: seq('e'), ramosDoNovo: ['primeiro', 'segundo'] });
    expect(g.arestas).toContainEqual({ id: 'e2', de: 'cond2', para: 'c', ramo: 'primeiro' });
    expect(g.arestas).toContainEqual({ id: 'e1', de: 'g', para: 'cond2' });
  });

  it('aresta inexistente não muda nada', () => {
    expect(inserirEntre(base, 'nada', no('x', 'controle.esperar'), { gerarId: seq() })).toBe(base);
  });

  it('laço (Ir para voltando) não trava o empurrão', () => {
    const g0: Grafo = { nos: [no('g', 'gatilho.webhook'), no('a', 'acao.adicionar_tag', 0, 170), no('b', 'controle.esperar', 0, 340)], arestas: [{ id: '1', de: 'g', para: 'a' }, { id: '2', de: 'a', para: 'b' }, { id: '3', de: 'b', para: 'a' }] };
    const g = inserirEntre(g0, '1', no('n', 'controle.esperar'), { gerarId: seq(), espacoY: 10 });
    expect(g.nos.find((n) => n.id === 'a')!.posicao.y).toBe(180);
    expect(g.nos.find((n) => n.id === 'b')!.posicao.y).toBe(350);
  });
});

describe('copiar/colar', () => {
  const g: Grafo = {
    nos: [no('g', 'gatilho.contato_criado'), no('a', 'acao.adicionar_tag', 0, 100, { tag: 'vip' }), no('ir', 'controle.ir_para', 0, 200, { alvoNoId: 'a' }), no('ir2', 'controle.ir_para', 0, 300, { alvoNoId: 'g' })],
    arestas: [{ id: '1', de: 'g', para: 'a' }, { id: '2', de: 'a', para: 'ir' }, { id: '3', de: 'ir', para: 'ir2' }],
    notas: [{ id: 'nt', texto: 'lembrete', posicao: { x: 400, y: 0 } }],
  };

  it('cola com ids novos, mesma config, arestas internas religadas', () => {
    const r = recortar(g, new Set(['a', 'ir', 'ir2', 'nt']));
    expect(r.arestas.map((a) => a.id)).toEqual(['2', '3']); // a aresta g→a ficou de fora
    let i = 0;
    const c = colar(r, (p) => `${p}-${++i}`);
    expect(c.nos.map((n) => n.id)).toEqual(['n-1', 'n-2', 'n-3']);
    expect(c.notas).toEqual([{ id: 'nota-4', texto: 'lembrete', posicao: { x: 440, y: 40 } }]);
    expect(c.nos[0].config).toEqual({ tag: 'vip' });
    expect(c.nos[0].posicao).toEqual({ x: 40, y: 140 });
    expect(c.arestas).toEqual([{ id: 'e-5', de: 'n-1', para: 'n-2' }, { id: 'e-6', de: 'n-2', para: 'n-3' }]);
    // "Ir para" interno aponta para a cópia; o que apontava para fora mantém o original
    expect(c.nos[1].config).toEqual({ alvoNoId: 'n-1' });
    expect(c.nos[2].config).toEqual({ alvoNoId: 'g' });
  });

  it('a cópia é independente do original (config clonada)', () => {
    const r = recortar(g, new Set(['a']));
    const c = colar(r, (p) => `${p}x`);
    (c.nos[0].config as { tag: string }).tag = 'mudou';
    expect(g.nos[1].config).toEqual({ tag: 'vip' });
  });
});

describe('excluir', () => {
  it('nó do meio da corrente: religa o pai ao filho, preservando o ramo', () => {
    const g: Grafo = { nos: [no('c', 'controle.condicao'), no('m', 'controle.esperar'), no('f', 'acao.adicionar_tag')], arestas: [{ id: '1', de: 'c', para: 'm', ramo: 'sim' }, { id: '2', de: 'm', para: 'f' }] };
    const r = excluir(g, new Set(['m']), seq('e'));
    expect(r.nos.map((n) => n.id)).toEqual(['c', 'f']);
    expect(r.arestas).toEqual([{ id: 'e1', de: 'c', para: 'f', ramo: 'sim' }]);
  });

  it('nó ramificado não é religado (não dá para escolher qual ramo herdaria)', () => {
    const g: Grafo = { nos: [no('g', 'gatilho.webhook'), no('c', 'controle.condicao'), no('f', 'acao.adicionar_tag')], arestas: [{ id: '1', de: 'g', para: 'c' }, { id: '2', de: 'c', para: 'f', ramo: 'sim' }] };
    expect(excluir(g, new Set(['c']), seq()).arestas).toEqual([]);
  });

  it('remove notas e todas as arestas tocadas', () => {
    const g: Grafo = { nos: [no('a', 'gatilho.webhook'), no('b', 'acao.adicionar_tag'), no('c', 'acao.remover_tag')], arestas: [{ id: '1', de: 'a', para: 'b' }, { id: '2', de: 'a', para: 'c' }], notas: [{ id: 'n', texto: '', posicao: { x: 0, y: 0 } }] };
    const r = excluir(g, new Set(['a', 'n']), seq());
    expect(r.arestas).toEqual([]);
    expect(r.notas).toEqual([]);
  });
});

describe('organizarVertical', () => {
  it('gatilho no topo, ramos lado a lado na ordem declarada, pai centrado', () => {
    const g: Grafo = {
      nos: [no('nao', 'controle.encerrar', 900, 900), no('sim', 'acao.adicionar_tag', 5, 5), no('c', 'controle.condicao', 50, 50), no('g', 'gatilho.contato_criado', 300, 300)],
      arestas: [{ id: '1', de: 'g', para: 'c' }, { id: '2', de: 'c', para: 'nao', ramo: 'r-nao' }, { id: '3', de: 'c', para: 'sim', ramo: 'r-sim' }],
    };
    const r = organizarVertical(g, { ordemRamos: (id) => (id === 'c' ? ['r-sim', 'r-nao'] : []), larguraNo: 200, espacoX: 100, espacoY: 150 });
    const p = (id: string) => r.nos.find((n) => n.id === id)!.posicao;
    expect(p('g').y).toBe(0);
    expect(p('c').y).toBe(150);
    expect(p('sim').y).toBe(300);
    expect(p('nao').y).toBe(300);
    expect(p('sim').x).toBeLessThan(p('nao').x); // "Sim" à esquerda
    expect(p('c').x).toBe((p('sim').x + p('nao').x) / 2);
    expect(p('g').x).toBe(p('c').x);
  });

  it('laço não duplica nem trava; nó solto vira outra coluna', () => {
    const g: Grafo = {
      nos: [no('g', 'gatilho.webhook'), no('a', 'acao.adicionar_tag'), no('b', 'controle.ir_para'), no('solto', 'acao.criar_nota')],
      arestas: [{ id: '1', de: 'g', para: 'a' }, { id: '2', de: 'a', para: 'b' }, { id: '3', de: 'b', para: 'a' }],
    };
    const r = organizarVertical(g, { larguraNo: 200, espacoX: 100, espacoY: 100 });
    const p = (id: string) => r.nos.find((n) => n.id === id)!.posicao;
    expect([p('g').y, p('a').y, p('b').y]).toEqual([0, 100, 200]);
    expect(p('solto').y).toBe(0);
    expect(p('solto').x).toBeGreaterThan(p('g').x);
  });

  it('não move notas', () => {
    const g: Grafo = { nos: [no('g', 'gatilho.webhook', 500, 500)], arestas: [], notas: [{ id: 'n', texto: 'x', posicao: { x: 9, y: 9 } }] };
    expect(organizarVertical(g).notas).toEqual(g.notas);
  });
});

describe('organizarHorizontal (estilo GHL)', () => {
  const p = (g: Grafo, id: string) => g.nos.find((n) => n.id === id)!.posicao;

  it('gatilho à esquerda, passos para a direita, ramos se abrem no eixo Y na ordem declarada', () => {
    const g: Grafo = {
      nos: [no('nao', 'controle.encerrar', 9, 900), no('sim', 'acao.adicionar_tag', 5, 5), no('c', 'controle.condicao', 50, 50), no('g', 'gatilho.contato_criado', 300, 300)],
      arestas: [{ id: '1', de: 'g', para: 'c' }, { id: '2', de: 'c', para: 'nao', ramo: 'r-nao' }, { id: '3', de: 'c', para: 'sim', ramo: 'r-sim' }],
    };
    const r = organizarHorizontal(g, { ordemRamos: (id) => (id === 'c' ? ['r-sim', 'r-nao'] : []), passoColuna: 300, alturaLinha: 100 });
    expect(p(r, 'g').x).toBe(0);
    expect(p(r, 'c').x).toBe(300);
    expect(p(r, 'sim').x).toBe(600);
    expect(p(r, 'nao').x).toBe(600);
    expect(p(r, 'sim').y).toBeLessThan(p(r, 'nao').y); // "Sim" em cima
    expect(p(r, 'c').y).toBe((p(r, 'sim').y + p(r, 'nao').y) / 2);
    expect(p(r, 'g').y).toBe(p(r, 'c').y);
  });

  it('vários gatilhos empilhados numa coluna, todos levando ao mesmo primeiro passo', () => {
    const g: Grafo = {
      nos: [no('t1', 'gatilho.tag_adicionada', 0, 0), no('t2', 'gatilho.contato_criado', 400, 0), no('t3', 'gatilho.agendado', 800, 0), no('a', 'acao.enviar_sms', 0, 200), no('b', 'controle.encerrar', 0, 400)],
      arestas: [{ id: '1', de: 't1', para: 'a' }, { id: '2', de: 't2', para: 'a' }, { id: '3', de: 't3', para: 'a' }, { id: '4', de: 'a', para: 'b' }],
    };
    const r = organizarHorizontal(g, { passoColuna: 300, alturaLinha: 100 });
    expect([p(r, 't1').x, p(r, 't2').x, p(r, 't3').x]).toEqual([0, 0, 0]);
    expect(new Set([p(r, 't1').y, p(r, 't2').y, p(r, 't3').y]).size).toBe(3);
    expect(p(r, 'a').x).toBe(300);
    expect(p(r, 'b').x).toBe(600);
    // fluxo centrado na coluna de gatilhos
    expect(p(r, 'a').y).toBe(p(r, 't2').y);
    expect(pareceVertical(r)).toBe(false);
  });

  it('laço não trava; passo solto vira outro bloco; notas não se mexem', () => {
    const g: Grafo = {
      nos: [no('g', 'gatilho.webhook'), no('a', 'acao.adicionar_tag'), no('b', 'controle.ir_para'), no('solto', 'acao.criar_nota')],
      arestas: [{ id: '1', de: 'g', para: 'a' }, { id: '2', de: 'a', para: 'b' }, { id: '3', de: 'b', para: 'a' }],
      notas: [{ id: 'n', texto: 'x', posicao: { x: 9, y: 9 } }],
    };
    const r = organizarHorizontal(g, { passoColuna: 300, alturaLinha: 100 });
    expect([p(r, 'g').x, p(r, 'a').x, p(r, 'b').x]).toEqual([0, 300, 600]);
    expect(p(r, 'solto').x).toBe(300);
    expect(p(r, 'solto').y).not.toBe(p(r, 'a').y);
    expect(r.notas).toEqual(g.notas);
  });
});

describe('pareceVertical / primeiroPasso', () => {
  it('detecta o layout antigo de cima para baixo', () => {
    const g: Grafo = { nos: [no('g', 'gatilho.webhook', 0, 0), no('a', 'acao.adicionar_tag', 0, 170), no('b', 'controle.encerrar', 0, 340)], arestas: [] };
    expect(pareceVertical(g)).toBe(true);
    expect(pareceVertical({ nos: g.nos.slice(0, 2), arestas: [] })).toBe(false);
  });

  it('primeiro passo é o destino do gatilho, ou o passo sem entrada', () => {
    const g: Grafo = { nos: [no('g', 'gatilho.webhook'), no('a', 'acao.adicionar_tag'), no('b', 'controle.encerrar')], arestas: [{ id: '1', de: 'g', para: 'a' }, { id: '2', de: 'a', para: 'b' }] };
    expect(primeiroPasso(g)).toBe('a');
    expect(primeiroPasso({ ...g, arestas: [{ id: '2', de: 'a', para: 'b' }] })).toBe('a');
  });
});

describe('inserirEntre no eixo X', () => {
  it('o destino e o que vem depois vão para a direita, não para baixo', () => {
    const g: Grafo = { nos: [no('g', 'gatilho.webhook', 0, 0), no('a', 'acao.adicionar_tag', 350, 0), no('b', 'controle.encerrar', 700, 0)], arestas: [{ id: 'x', de: 'g', para: 'a' }, { id: 'y', de: 'a', para: 'b' }] };
    const r = inserirEntre(g, 'x', no('novo', 'controle.esperar'), { gerarId: seq(), eixo: 'x', espacoX: 350 });
    const pos = (id: string) => r.nos.find((n) => n.id === id)!.posicao;
    expect(pos('novo')).toEqual({ x: 350, y: 0 });
    expect(pos('a')).toEqual({ x: 700, y: 0 });
    expect(pos('b')).toEqual({ x: 1050, y: 0 });
  });
});

describe('comandoDaTecla', () => {
  const t = (p: Partial<Tecla>): Tecla => ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, emCampo: false, ...p });
  it('Ctrl e Cmd valem igual', () => {
    expect(comandoDaTecla(t({ key: 'z', ctrlKey: true }))).toBe('desfazer');
    expect(comandoDaTecla(t({ key: 'z', metaKey: true }))).toBe('desfazer');
    expect(comandoDaTecla(t({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('refazer');
    expect(comandoDaTecla(t({ key: 'y', ctrlKey: true }))).toBe('refazer');
    expect(comandoDaTecla(t({ key: 'c', metaKey: true }))).toBe('copiar');
    expect(comandoDaTecla(t({ key: 'v', ctrlKey: true }))).toBe('colar');
    expect(comandoDaTecla(t({ key: 'd', ctrlKey: true }))).toBe('duplicar');
    expect(comandoDaTecla(t({ key: 'L', ctrlKey: true, shiftKey: true }))).toBe('organizar');
  });
  it('Delete/Backspace excluem; ? abre a ajuda; N cria nota', () => {
    expect(comandoDaTecla(t({ key: 'Delete' }))).toBe('excluir');
    expect(comandoDaTecla(t({ key: 'Backspace' }))).toBe('excluir');
    expect(comandoDaTecla(t({ key: '?', shiftKey: true }))).toBe('ajuda');
    expect(comandoDaTecla(t({ key: 'n' }))).toBe('nota');
  });
  it('dentro de um campo de texto o atalho é do campo', () => {
    expect(comandoDaTecla(t({ key: 'z', ctrlKey: true, emCampo: true }))).toBeNull();
    expect(comandoDaTecla(t({ key: 'Backspace', emCampo: true }))).toBeNull();
  });
  it('tecla comum não é comando', () => {
    expect(comandoDaTecla(t({ key: 'a' }))).toBeNull();
    expect(comandoDaTecla(t({ key: 'z', altKey: true, ctrlKey: true }))).toBeNull();
  });
});
