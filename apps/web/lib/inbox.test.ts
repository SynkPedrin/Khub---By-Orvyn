import { describe, expect, it } from 'vitest';
import { filtrarRespostas, resolverVariaveis, tamanhoLegivel, tipoDoArquivo, type RespostaRapida } from './inbox';

const r = (atalho: string, titulo: string, corpo = ''): RespostaRapida => ({ id: atalho, atalho, titulo, corpo, criadoPor: null, updatedAt: '' });

describe('respostas rápidas (Q2.5)', () => {
  it('resolve variáveis com os dados da conversa', () => {
    const txt = resolverVariaveis('Oi {{contato.primeiro_nome}}, aqui é {{ atendente.nome }} sobre {{negocio.titulo}}.', {
      contato: { nome: 'Marina Souza' },
      atendente: { nome: 'Pedro' },
      negocio: { titulo: 'Implante' },
    });
    expect(txt).toBe('Oi Marina, aqui é Pedro sobre Implante.');
  });

  it('variável sem valor ou desconhecida some (nunca o marcador cru)', () => {
    expect(resolverVariaveis('Oi {{contato.primeiro_nome}}, tudo bem? {{x.y}}', { contato: null })).toBe('Oi, tudo bem? ');
  });

  it('filtro prioriza atalho que começa com a busca', () => {
    const lista = [r('preco', 'Tabela'), r('boas-vindas', 'Boas-vindas'), r('agenda', 'Horários', 'sobre o preço da consulta')];
    // atalho que começa com a busca vem antes de quem só contém no texto
    expect(filtrarRespostas(lista, 'p').map((x) => x.atalho)).toEqual(['preco', 'agenda']);
    expect(filtrarRespostas(lista, 'bo').map((x) => x.atalho)).toEqual(['boas-vindas']);
    expect(filtrarRespostas(lista, 'preço').map((x) => x.atalho)).toEqual(['agenda']);
    expect(filtrarRespostas(lista, '')).toHaveLength(3);
  });
});

describe('anexos', () => {
  it('tipo pelo MIME e tamanho legível', () => {
    expect(tipoDoArquivo('image/png')).toBe('imagem');
    expect(tipoDoArquivo('audio/ogg')).toBe('audio');
    expect(tipoDoArquivo('application/pdf')).toBe('documento');
    expect(tamanhoLegivel(2048)).toBe('2 KB');
    expect(tamanhoLegivel(1572864)).toBe('1,5 MB');
  });
});

describe('gatilhos do composer', () => {
  it('"/" só no começo de palavra e sem espaço', async () => {
    const { tokenNoCursor } = await import('./inbox');
    expect(tokenNoCursor('/bo', 3, '/')).toEqual({ inicio: 0, busca: 'bo' });
    expect(tokenNoCursor('oi /pre', 7, '/')).toEqual({ inicio: 3, busca: 'pre' });
    expect(tokenNoCursor('http://x', 8, '/')).toBeNull();
    expect(tokenNoCursor('/boas vindas', 12, '/')).toBeNull();
  });

  it('"@" aceita nome composto, não atravessa linha', async () => {
    const { tokenNoCursor } = await import('./inbox');
    expect(tokenNoCursor('fala @Ana Pa', 12, '@')).toEqual({ inicio: 5, busca: 'Ana Pa' });
    expect(tokenNoCursor('email@x.com', 11, '@')).toBeNull();
    expect(tokenNoCursor('@ana\nok', 7, '@')).toBeNull();
  });
});
