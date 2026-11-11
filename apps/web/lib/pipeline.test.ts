import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { contarFiltros, ehEtapaDePerda, faixaInvalida, filtrosDaUrl, linhasDoQuadro, mensagemDeErro, ordenarLinhas, paraQuery, type NegocioQuadro } from './pipeline';

const OWNER = 'eeeeeeee-0000-4000-8000-000000000001';
const neg = (id: string, extra: Partial<NegocioQuadro> = {}): NegocioQuadro => ({
  id, titulo: id, contato: '-', contactId: null, valor: 0, origem: '', status: 'aberto', stageId: 's', ownerId: null,
  createdAt: '2026-11-01T12:00:00Z', ultimoContatoAt: null, motivoPerda: null, ...extra,
});

describe('pipeline: filtros na URL (Q2.1)', () => {
  it('ida e volta: só o que a API aceita, sem chave vazia e sem status padrão', () => {
    const f = filtrosDaUrl(new URLSearchParams(`q=plano&ownerId=${OWNER}&origem=Instagram&tag=vip&valorMin=100,50&valorMax=900&status=ganhos&criadoDe=2026-10-01&criadoAte=2026-10-31&deal=x`));
    expect(f).toEqual({ q: 'plano', ownerId: OWNER, origem: 'Instagram', tag: 'vip', valorMin: '100.50', valorMax: '900', status: 'ganhos', criadoDe: '2026-10-01', criadoAte: '2026-10-31' });
    expect(paraQuery(f).toString()).toBe(`q=plano&ownerId=${OWNER}&origem=Instagram&tag=vip&valorMin=100.50&valorMax=900&status=ganhos&criadoDe=2026-10-01&criadoAte=2026-10-31`);
    expect(paraQuery({ status: 'abertos', q: '  ' }).toString()).toBe('');
  });

  it('link editado à mão não quebra a tela: valores inválidos são descartados', () => {
    expect(filtrosDaUrl(new URLSearchParams('ownerId=fulano&status=arquivados&valorMin=abc&criadoDe=01/10/2026'))).toEqual({});
    expect(filtrosDaUrl(new URLSearchParams('ownerId=nenhum')).ownerId).toBe('nenhum');
  });

  it('conta filtros ligados e detecta faixa de valor invertida', () => {
    expect(contarFiltros({})).toBe(0);
    expect(contarFiltros({ status: 'abertos' })).toBe(0);
    expect(contarFiltros({ status: 'todos', tag: 'vip' })).toBe(2);
    expect(faixaInvalida({ valorMin: '900', valorMax: '100' })).toBe(true);
    expect(faixaInvalida({ valorMin: '100' })).toBe(false);
  });
});

describe('pipeline: etapa de perda', () => {
  it.each([['Perdido', true], ['Fechado / Perdido', true], ['PERDIDOS', true], ['Perda', true], ['Proposta', false], ['Fechado / Ganho', false], ['Perdigão', false]])('%s → %s', (nome, esperado) => {
    expect(ehEtapaDePerda(nome)).toBe(esperado);
  });
});

describe('pipeline: visão Lista', () => {
  const quadro = {
    stages: [
      { id: 's1', nome: 'Novo', cor: '#000', deals: [neg('b', { valor: 300, ownerId: OWNER, contato: 'Bruna' }), neg('a', { valor: 100, ultimoContatoAt: '2026-11-05T00:00:00Z' })] },
      { id: 's2', nome: 'Proposta', cor: '#111', deals: [neg('c', { valor: 200, contato: 'ana', ultimoContatoAt: '2026-11-02T00:00:00Z' })] },
    ],
  };
  const linhas = linhasDoQuadro(quadro, (id) => (id ? 'Pedro' : ''));

  it('achata as etapas com nome/cor/ordem e o nome do dono', () => {
    expect(linhas.map((l) => [l.id, l.etapa, l.ordemEtapa, l.dono])).toEqual([['b', 'Novo', 0, 'Pedro'], ['a', 'Novo', 0, ''], ['c', 'Proposta', 1, '']]);
  });

  it('ordena por valor, etapa e texto (sem diferenciar maiúsculas); vazio vai para o fim', () => {
    expect(ordenarLinhas(linhas, { coluna: 'valor', dir: 'desc' }).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(ordenarLinhas(linhas, { coluna: 'etapa', dir: 'desc' }).map((l) => l.id)).toEqual(['c', 'b', 'a']);
    expect(ordenarLinhas(linhas, { coluna: 'contato', dir: 'asc' }).map((l) => l.id)).toEqual(['c', 'b', 'a']);
    expect(ordenarLinhas(linhas, { coluna: 'dono', dir: 'desc' }).map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(ordenarLinhas(linhas, { coluna: 'ultimoContato', dir: 'desc' }).map((l) => l.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('pipeline: mensagem de erro', () => {
  it('usa o detail do RFC 7807 quando existe', () => {
    expect(mensagemDeErro(new ApiError(400, { title: 'Bad Request', detail: 'motivo de perda obrigatório' }))).toBe('motivo de perda obrigatório');
    expect(mensagemDeErro(new Error('x'), 'padrão')).toBe('padrão');
  });
});
