import { BadRequestException } from '@nestjs/common';
import { AtualizarTarefaSchema, CriarEventoSchema, CriarTarefaSchema, inicioDoDia, lerFiltros, transicao, validar } from './daily.catalogo';
import { nomeDoEmail } from './daily.service';

const base = { status: 'a_fazer', tipo: 'outro', aprovacao: null, concluidaEm: null, publicadoEm: null };
const agora = new Date('2026-11-16T15:00:00Z');

describe('Daily da agência: transições', () => {
  it('concluir marca concluidaEm; reabrir limpa', () => {
    expect(transicao(base, { status: 'concluida' }, agora)).toEqual({ status: 'concluida', concluidaEm: agora });
    expect(transicao({ ...base, status: 'concluida', concluidaEm: agora }, { status: 'em_andamento' }, agora)).toEqual({ status: 'em_andamento', concluidaEm: null });
  });

  it('virar conteúdo ganha aprovação "em produção"', () => {
    expect(transicao(base, { tipo: 'reel' }, agora)).toEqual({ aprovacao: 'em_producao' });
  });

  it('publicar conclui e marca publicadoEm; despublicar reabre', () => {
    const reel = { ...base, tipo: 'reel', aprovacao: 'aprovado' };
    expect(transicao(reel, { aprovacao: 'publicado' }, agora)).toEqual({ aprovacao: 'publicado', status: 'concluida', publicadoEm: agora, concluidaEm: agora });
    const publicado = { ...reel, aprovacao: 'publicado', status: 'concluida', concluidaEm: agora, publicadoEm: agora };
    expect(transicao(publicado, { aprovacao: 'ajustes' }, agora)).toEqual({ aprovacao: 'ajustes', status: 'em_andamento', publicadoEm: null, concluidaEm: null });
  });

  it('mudar só a posição não gera efeito', () => {
    expect(transicao({ ...base, tipo: 'post', aprovacao: 'em_producao' }, {}, agora)).toEqual({});
  });
});

describe('Daily da agência: validação', () => {
  it('criar exige título e rejeita campo desconhecido', () => {
    expect(() => validar(CriarTarefaSchema, {})).toThrow(BadRequestException);
    expect(() => validar(CriarTarefaSchema, { titulo: 'x', agencyId: 'outra' })).toThrow(BadRequestException);
    expect(validar(CriarTarefaSchema, { titulo: '  Post de segunda  ', descricao: '' })).toEqual({ titulo: 'Post de segunda', descricao: null });
  });

  it('datas viram Date e plataformas não repetem', () => {
    const r = validar(AtualizarTarefaSchema, { prazoEm: '2026-11-20T15:00:00.000Z', plataformas: ['instagram', 'instagram', 'tiktok'] });
    expect(r.prazoEm).toEqual(new Date('2026-11-20T15:00:00.000Z'));
    expect(r.plataformas).toEqual(['instagram', 'tiktok']);
    expect(() => validar(AtualizarTarefaSchema, {})).toThrow(BadRequestException);
    expect(() => validar(AtualizarTarefaSchema, { status: 'feito' })).toThrow(BadRequestException);
  });

  it('evento não pode terminar antes de começar', () => {
    expect(() => validar(CriarEventoSchema, { titulo: 'Gravação', inicioEm: '2026-11-20T15:00:00Z', fimEm: '2026-11-20T14:00:00Z' })).toThrow(BadRequestException);
    expect(validar(CriarEventoSchema, { titulo: 'Gravação', inicioEm: '2026-11-20T15:00:00Z' }).inicioEm).toEqual(new Date('2026-11-20T15:00:00Z'));
  });
});

describe('Daily da agência: filtros', () => {
  it('ignora valores desconhecidos em vez de falhar', () => {
    const f = lerFiltros({ escopo: 'minhas', status: 'a_fazer,xpto', prazo: 'ontem', cliente: 'não-uuid', q: '  reel  ' });
    expect(f).toMatchObject({ escopo: 'minhas', status: ['a_fazer'], prazo: undefined, clientId: undefined, q: 'reel' });
  });

  it('Studio só aceita tipos de conteúdo', () => {
    expect(lerFiltros({ tipo: 'reel,copy,post' }, true).tipo).toEqual(['reel', 'post']);
    expect(lerFiltros({ cliente: 'interno' }).clientId).toBe('interno');
  });
});

describe('Daily da agência: datas e nomes', () => {
  it('início do dia em Brasília', () => {
    // 01:30 UTC de 17/11 ainda é 16/11 em São Paulo.
    expect(inicioDoDia('America/Sao_Paulo', new Date('2026-11-17T01:30:00Z')).toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(inicioDoDia('America/Sao_Paulo', new Date('2026-11-17T01:30:00Z'), 7).toISOString()).toBe('2026-11-23T03:00:00.000Z');
    expect(inicioDoDia('UTC', new Date('2026-11-17T01:30:00Z')).toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });

  it('nome a partir do e-mail', () => {
    expect(nomeDoEmail('maria.souza@x.com')).toBe('Maria Souza');
    expect(nomeDoEmail('@x.com')).toBe('Membro');
  });
});
