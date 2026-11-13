import { describe, expect, it } from 'vitest';
import { chaveCustom, detectarSeparador, lerCsv, montarLinhas, sugerirMapeamento } from './csv';
import { totalProposta } from './comercial';

describe('lerCsv', () => {
  it('aspas, aspas escapadas, vírgula e quebra de linha dentro do campo', () => {
    const t = 'Nome,Obs\n"Silva, Ana","disse ""oi""\nem duas linhas"\nBruno,ok\n';
    expect(lerCsv(t)).toEqual([['Nome', 'Obs'], ['Silva, Ana', 'disse "oi"\nem duas linhas'], ['Bruno', 'ok']]);
  });
  it('BOM do Excel, CRLF e ponto e vírgula (Excel pt-BR)', () => {
    const t = '﻿nome;telefone\r\nAna;11 9999-0000\r\n\r\n';
    expect(detectarSeparador(t)).toBe(';');
    expect(lerCsv(t)).toEqual([['nome', 'telefone'], ['Ana', '11 9999-0000']]);
  });
  it('separador dentro de aspas não confunde a detecção', () => {
    expect(detectarSeparador('"a;b;c",x,y\n1,2,3')).toBe(',');
  });
  it('linhas vazias são ignoradas', () => {
    expect(lerCsv('a,b\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('mapeamento de colunas', () => {
  it('reconhece o export de contatos do GHL', () => {
    const cab = ['Contact Id', 'First Name', 'Last Name', 'Phone', 'Email', 'Company Name', 'Tags', 'Source', 'Created'];
    expect(sugerirMapeamento(cab)).toEqual(['', 'primeiroNome', 'sobrenome', 'telefone', 'email', 'empresa', 'tags', 'origem', '']);
  });
  it('reconhece planilha em português com acento', () => {
    expect(sugerirMapeamento(['Nome', 'Celular', 'E-mail', 'Observações', 'Município'])).toEqual(['nome', 'telefone', 'email', 'observacao', 'cidade']);
  });
  it('não mapeia duas colunas para o mesmo campo automaticamente', () => {
    expect(sugerirMapeamento(['Telefone', 'Celular'])).toEqual(['telefone', '']);
  });
  it('monta linhas com campos personalizados e soma colunas no mesmo campo', () => {
    const r = montarLinhas([['Ana', 'vip', 'ghl', '1990-01-02']], ['nome', 'tags', 'tags', 'custom:nascimento']);
    expect(r).toEqual([{ nome: 'Ana', tags: 'vip, ghl', campos: { nascimento: '1990-01-02' } }]);
  });
  it('chave de campo personalizado válida para o servidor', () => {
    expect(chaveCustom('Data de Nascimento')).toBe('data_de_nascimento');
    expect(chaveCustom('2º Procedimento')).toBe('procedimento');
  });
});

describe('totalProposta (espelha o servidor)', () => {
  it('centavos exatos e nunca negativo', () => {
    expect(totalProposta([{ descricao: 'a', quantidade: 3, valorUnitario: 0.1 }], 0)).toBe(0.3);
    expect(totalProposta([{ descricao: 'a', quantidade: 2, valorUnitario: 250 }, { descricao: 'b', quantidade: 1, valorUnitario: 89.9 }], 39.9)).toBe(550);
    expect(totalProposta([{ descricao: 'a', quantidade: 1, valorUnitario: 10 }], 50)).toBe(0);
  });
});
