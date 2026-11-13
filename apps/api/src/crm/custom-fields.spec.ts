import { BadRequestException } from '@nestjs/common';
import { montarFiltroCampos, normalizarOpcoes, normalizarValor, slugChave, validarValores, type DefCampo } from './custom-fields';
import { CustomFieldsService, filtroCamposContato, validarCamposNaTransacao } from './custom-fields.service';
import { permissionFor, hasPermission } from '../auth/permissions.guard';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/decorators';
import { CrmService } from './crm.service';
import { filtroDaQuery } from './contatos-filtro';

const def = (chave: string, tipo: string, extra: Partial<DefCampo> = {}): DefCampo => ({
  chave, rotulo: chave.toUpperCase(), tipo, opcoes: [], obrigatorio: false, arquivadoEm: null, ...extra,
});

const DEFS: DefCampo[] = [
  def('convenio', 'select', { opcoes: ['Unimed', 'Amil', 'Particular'] }),
  def('interesses', 'multiselect', { opcoes: ['Botox', 'Laser', 'Peeling'] }),
  def('idade', 'number'),
  def('ticket', 'money'),
  def('nascimento', 'date'),
  def('vip', 'boolean'),
  def('obs', 'textarea'),
  def('cpf', 'text', { obrigatorio: true }),
  def('whats2', 'phone'),
  def('email2', 'email'),
  def('site', 'url'),
  def('antigo', 'text', { arquivadoEm: new Date('2026-01-01') }),
];

describe('custom-fields: normalizarValor (um formato canônico por tipo)', () => {
  it.each([
    ['number', '42', 42],
    ['number', 3.5, 3.5],
    ['money', '1999.999', 2000],
    ['money', 10.256, 10.26],
    ['date', '2026-02-28', '2026-02-28'],
    ['boolean', 'true', true],
    ['boolean', false, false],
    ['email', ' Ana@Clinica.COM ', 'ana@clinica.com'],
    ['url', 'khub.com.br/x', 'https://khub.com.br/x'],
    ['phone', '+55 (11) 97777-1234', '+55 (11) 97777-1234'],
    ['text', '  oi  ', 'oi'],
  ])('%s aceita %p → %p', (tipo, bruto, esperado) => {
    expect(normalizarValor({ tipo, opcoes: [] }, bruto)).toEqual({ ok: true, valor: esperado });
  });

  it.each([
    ['number', 'abc'],
    ['number', true],
    ['money', '10,50'],
    ['date', '2026-02-30'],
    ['date', '28/02/2026'],
    ['boolean', 'sim'],
    ['email', 'ana@'],
    ['url', 'javascript:alert(1)'],
    ['url', 'ftp://x.com'],
    ['phone', '123'],
    ['text', { a: 1 }],
    ['text', 'x'.repeat(501)],
    ['desconhecido', 'x'],
  ])('%s rejeita %p', (tipo, bruto) => {
    expect(normalizarValor({ tipo, opcoes: [] }, bruto).ok).toBe(false);
  });

  it('select casa sem diferença de maiúscula e devolve a opção oficial; fora da lista é erro', () => {
    const d = DEFS[0];
    expect(normalizarValor(d, 'unimed')).toEqual({ ok: true, valor: 'Unimed' });
    expect(normalizarValor(d, 'Bradesco').ok).toBe(false);
  });

  it('multiselect devolve na ordem das opções, sem repetidas; opção estranha é erro', () => {
    const d = DEFS[1];
    expect(normalizarValor(d, ['peeling', 'Botox', 'botox'])).toEqual({ ok: true, valor: ['Botox', 'Peeling'] });
    expect(normalizarValor(d, ['Botox', 'Lipo']).ok).toBe(false);
    expect(normalizarValor(d, 'Botox').ok).toBe(false);
  });
});

describe('custom-fields: validarValores (serviço único)', () => {
  it('mescla com os valores atuais, normaliza e preserva chaves de sistema', () => {
    const r = validarValores(DEFS, { idade: '30', vip: true, convenio: 'amil' }, { atuais: { lead_origem: 'Meta', cpf: '123', obs: 'x' } });
    expect(r).toEqual({ ok: true, valores: { lead_origem: 'Meta', cpf: '123', obs: 'x', idade: 30, vip: true, convenio: 'Amil' } });
  });

  it('null, "" e [] limpam o campo', () => {
    const r = validarValores(DEFS, { obs: null, interesses: [], site: '' }, { atuais: { obs: 'x', interesses: ['Botox'], site: 'https://a.com' } });
    expect(r).toEqual({ ok: true, valores: {} });
  });

  it('lista TODOS os campos com problema: tipo errado, chave desconhecida e obrigatório ausente', () => {
    const r = validarValores(DEFS, { idade: 'trinta', inventado: 1, nascimento: '2026-13-01' }, { exigirObrigatorios: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.map((e) => [e.chave, e.erro])).toEqual([
      ['idade', 'esperado número'],
      ['inventado', 'campo personalizado desconhecido'],
      ['nascimento', 'esperada data no formato AAAA-MM-DD'],
      ['cpf', 'campo obrigatório'],
    ]);
    expect(r.erros.find((e) => e.chave === 'cpf')?.rotulo).toBe('CPF');
  });

  it('obrigatório já gravado satisfaz; limpar um obrigatório é erro', () => {
    expect(validarValores(DEFS, { idade: 1 }, { atuais: { cpf: '1' }, exigirObrigatorios: true }).ok).toBe(true);
    const r = validarValores(DEFS, { cpf: '' }, { atuais: { cpf: '1' }, exigirObrigatorios: true });
    expect(r.ok).toBe(false);
  });

  it('sem exigirObrigatorios (automação preenchendo um campo) não trava por outro vazio', () => {
    expect(validarValores(DEFS, { vip: true }).ok).toBe(true);
  });

  it('campo arquivado: não recebe valor novo, mas pode ser limpo, e o valor guardado fica', () => {
    expect(validarValores(DEFS, { antigo: 'novo' }).ok).toBe(false);
    expect(validarValores(DEFS, { antigo: null }, { atuais: { antigo: 'x' } })).toEqual({ ok: true, valores: {} });
    expect(validarValores(DEFS, { idade: 2 }, { atuais: { antigo: 'x' } })).toEqual({ ok: true, valores: { antigo: 'x', idade: 2 } });
  });
});

describe('custom-fields: montarFiltroCampos (cf_<chave>, _min, _max)', () => {
  it('igualdade pelo tipo: number vira número, boolean vira boolean, select vira opção oficial', () => {
    const r = montarFiltroCampos(DEFS, { idade: '30', vip: 'true', convenio: 'unimed' });
    expect(r.erros).toEqual([]);
    expect(r.condicoes).toEqual([
      { camposCustom: { path: ['idade'], equals: 30 } },
      { camposCustom: { path: ['vip'], equals: true } },
      { camposCustom: { path: ['convenio'], equals: 'Unimed' } },
    ]);
  });

  it('multiselect filtra por "contém a opção"', () => {
    expect(montarFiltroCampos(DEFS, { interesses: 'laser' }).condicoes).toEqual([{ camposCustom: { path: ['interesses'], array_contains: ['Laser'] } }]);
  });

  it('faixa inclusiva para number, money e date', () => {
    const r = montarFiltroCampos(DEFS, { idade_min: '18', ticket_max: '500', nascimento_min: '1990-01-01' });
    expect(r.condicoes).toEqual([
      { camposCustom: { path: ['idade'], gte: 18 } },
      { camposCustom: { path: ['ticket'], lte: 500 } },
      { camposCustom: { path: ['nascimento'], gte: '1990-01-01' } },
    ]);
  });

  it('faixa em tipo sem ordem e valor fora do tipo são erro (400), não lista vazia', () => {
    const r = montarFiltroCampos(DEFS, { convenio_min: 'a', idade: 'muitos', nascimento_max: 'ontem' });
    expect(r.condicoes).toEqual([]);
    expect(r.erros.map((e) => e.chave)).toEqual(['convenio', 'idade', 'nascimento']);
  });

  it('chave exata tem prioridade sobre o sufixo _min', () => {
    const defs = [def('nota_min', 'text'), def('nota', 'number')];
    expect(montarFiltroCampos(defs, { nota_min: 'x' }).condicoes).toEqual([{ camposCustom: { path: ['nota_min'], equals: 'x' } }]);
  });

  it('chave sem definição ativa (dado histórico, ex. lead_origem, ou campo arquivado) mantém a igualdade textual', () => {
    expect(montarFiltroCampos(DEFS, { lead_origem: 'Meta', antigo: 'x' }).condicoes).toEqual([
      { camposCustom: { path: ['lead_origem'], equals: 'Meta' } },
      { camposCustom: { path: ['antigo'], equals: 'x' } },
    ]);
  });
});

describe('custom-fields: utilitários', () => {
  it('slugChave gera chave estável e válida', () => {
    expect(slugChave('Plano de Saúde (2º)')).toBe('plano_de_saude_2');
    expect(slugChave('123 abc')).toBe('c_123_abc');
    expect(slugChave('!!!')).toBe('campo');
  });

  it('normalizarOpcoes apara, deduplica e exige ao menos uma opção na lista', () => {
    expect(normalizarOpcoes('select', [' A ', 'a', 'B', ''])).toEqual({ ok: true, opcoes: ['A', 'B'] });
    expect(normalizarOpcoes('select', []).ok).toBe(false);
    expect(normalizarOpcoes('text', undefined)).toEqual({ ok: true, opcoes: [] });
  });
});

// --------------------------------------------------------------------------
// Serviço (com transação falsa): erro RFC 7807 com a lista e regras de escrita
// --------------------------------------------------------------------------

type Row = DefCampo & { id: string; entidade: string; ordem: number; grupo: string | null; createdAt: Date };

function fakePrisma(rows: Row[], uso = 0) {
  const tx = {
    customFieldDef: {
      findMany: jest.fn(async (args: { where?: { entidade?: string; id?: { notIn: string[] } } }) =>
        rows.filter((r) => (!args.where?.entidade || r.entidade === args.where.entidade) && (!args.where?.id || !args.where.id.notIn.includes(r.id)))),
      findUnique: jest.fn(async (args: { where: { id: string } }) => rows.find((r) => r.id === args.where.id) ?? null),
      create: jest.fn(async (args: { data: Partial<Row> }) => ({ id: 'novo', createdAt: new Date(), arquivadoEm: null, grupo: null, ...args.data })),
      update: jest.fn(async (args: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === args.where.id)!;
        Object.assign(r, Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)));
        return r;
      }),
      delete: jest.fn(async () => ({})),
    },
    contact: {
      findUnique: jest.fn(async () => ({ id: 'c1', camposCustom: { cpf: '1', lead_origem: 'Meta' } })),
      update: jest.fn(async (_args: { where: { id: string }; data: Record<string, unknown> }) => ({})),
    },
    $queryRaw: jest.fn(async () => [{ n: BigInt(uso) }]),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  return { prisma, tx };
}
const T = '11111111-1111-1111-1111-111111111111';
const linha = (id: string, d: DefCampo, ordem: number): Row => ({ ...d, id, entidade: 'contact', ordem, grupo: null, createdAt: new Date() });

describe('CustomFieldsService', () => {
  it('validarCamposNaTransacao lança 400 com `campos` listando cada erro', async () => {
    const { tx } = fakePrisma(DEFS.map((d, i) => linha(`id${i}`, d, i)));
    const erro = await validarCamposNaTransacao(tx as unknown as Prisma.TransactionClient, 'contact', { idade: 'x', fantasma: 1 }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    const corpo = (erro as BadRequestException).getResponse() as { message: string; code: string; campos: { chave: string }[] };
    expect(corpo.code).toBe('campos_custom_invalidos');
    expect(corpo.campos.map((c) => c.chave)).toEqual(['idade', 'fantasma']);
    expect(corpo.message).toContain('IDADE');
  });

  it('filtroCamposContato: sem cf não consulta o banco; com valor inválido é 400', async () => {
    const { tx } = fakePrisma(DEFS.map((d, i) => linha(`id${i}`, d, i)));
    const txc = tx as unknown as Prisma.TransactionClient;
    expect(await filtroCamposContato(txc, undefined)).toBeUndefined();
    expect(tx.customFieldDef.findMany).not.toHaveBeenCalled();
    expect(await filtroCamposContato(txc, { idade_min: '18' })).toEqual([{ camposCustom: { path: ['idade'], gte: 18 } }]);
    await expect(filtroCamposContato(txc, { idade: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create gera chave pelo rótulo, sem colidir, e põe no fim da ordem', async () => {
    const { prisma, tx } = fakePrisma([linha('a', def('convenio', 'text'), 4)]);
    const v = await new CustomFieldsService(prisma).create(T, { entidade: 'contact', rotulo: 'Convênio', tipo: 'text' });
    expect(v.chave).toBe('convenio_2');
    expect(tx.customFieldDef.create.mock.calls[0][0].data.ordem).toBe(5);
  });

  it('create de select sem opções é 400', async () => {
    const { prisma } = fakePrisma([]);
    await expect(new CustomFieldsService(prisma).create(T, { entidade: 'deal', rotulo: 'Fonte', tipo: 'select' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trocar o tipo de campo com dados é 409; excluir campo com dados é 409 (o caminho é arquivar)', async () => {
    const { prisma } = fakePrisma([linha('a', def('idade', 'number'), 0)], 3);
    const svc = new CustomFieldsService(prisma);
    await expect(svc.update(T, 'a', { tipo: 'text' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.remove(T, 'a')).rejects.toMatchObject({ status: 409 });
  });

  it('arquivar marca arquivadoEm sem tocar nos registros; restaurar limpa', async () => {
    const { prisma, tx } = fakePrisma([linha('a', def('idade', 'number'), 0)]);
    const svc = new CustomFieldsService(prisma);
    expect((await svc.arquivar(T, 'a', true)).arquivado).toBe(true);
    expect(tx.contact.update).not.toHaveBeenCalled();
    expect((await svc.arquivar(T, 'a', false)).arquivado).toBe(false);
  });

  it('reordenar grava 0..n na ordem pedida e manda os ausentes para o fim', async () => {
    const rows = [linha('a', def('a', 'text'), 0), linha('b', def('b', 'text'), 1), linha('c', def('c', 'text'), 2)];
    const { prisma } = fakePrisma(rows);
    await new CustomFieldsService(prisma).reordenar(T, 'contact', ['c', 'a']);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.ordem]))).toEqual({ c: 0, a: 1, b: 2 });
  });

  it('atualizarCamposContato (helper do motor): valida, mescla e devolve as chaves alteradas', async () => {
    const { prisma, tx } = fakePrisma(DEFS.map((d, i) => linha(`id${i}`, d, i)));
    const r = await new CustomFieldsService(prisma).atualizarCamposContato(T, 'c1', { vip: 'true', cpf: '1' });
    expect(r).toEqual({ ok: true, alterados: ['vip'] });
    expect(tx.contact.update.mock.calls[0][0]).toMatchObject({ data: { camposCustom: { cpf: '1', lead_origem: 'Meta', vip: true } } });
    await expect(new CustomFieldsService(prisma).atualizarCamposContato(T, 'c1', { idade: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PermissionsGuard: definições só owner/admin escrevem', () => {
  const u = (role: string) => ({ role, tenantId: T, identityId: 'i' }) as unknown as AuthUser;
  it.each([['owner', true], ['admin', true], ['manager', false], ['member', false], ['viewer', false]])('%s escreve? %p', (role, pode) => {
    expect(hasPermission(u(role), permissionFor('crm', 'custom-fields', 'POST'))).toBe(pode);
    expect(hasPermission(u(role), permissionFor('crm', 'custom-fields/:id', 'PATCH'))).toBe(pode);
  });
  it('qualquer papel que lê o CRM lê as definições (o formulário precisa delas)', () => {
    expect(hasPermission(u('viewer'), permissionFor('crm', 'custom-fields', 'GET'))).toBe(true);
    expect(hasPermission(u('member'), permissionFor('crm', 'custom-fields', 'GET'))).toBe(true);
  });
  it('chave de API nunca escreve definição', () => {
    const api = { role: 'api', scopes: ['*'], tenantId: T, identityId: 'i' } as unknown as AuthUser;
    expect(hasPermission(api, permissionFor('crm', 'custom-fields', 'POST'))).toBe(false);
  });
});

describe('CrmService.listContacts com cf_* (filtro pelo tipo da definição)', () => {
  function svc(captura: { where?: unknown }[]) {
    const tx = {
      customFieldDef: { findMany: jest.fn(async () => DEFS) },
      contact: { findMany: jest.fn(async (a: { where?: unknown }) => { captura.push(a); return []; }), findUnique: jest.fn(async () => null) },
      $queryRaw: jest.fn(async () => []),
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    return new CrmService(prisma, { publicar: () => undefined } as never, { revalidarSeVencido: () => undefined } as never);
  }

  it('cf_idade_min=18&cf_vip=true&cf_interesses=laser vira filtro JSON tipado no WHERE', async () => {
    const captura: { where?: unknown }[] = [];
    await svc(captura).listContacts(T, { filtro: filtroDaQuery({ cf_idade_min: '18', cf_vip: 'true', cf_interesses: 'laser', limit: '10' }) });
    expect(captura[0].where).toEqual({
      AND: [
        { camposCustom: { path: ['idade'], gte: 18 } },
        { camposCustom: { path: ['vip'], equals: true } },
        { camposCustom: { path: ['interesses'], array_contains: ['Laser'] } },
      ],
    });
  });

  it('valor fora do tipo devolve 400 com a lista de campos (não lista vazia)', async () => {
    await expect(svc([]).listContacts(T, { filtro: filtroDaQuery({ cf_idade: 'muitos' }) })).rejects.toBeInstanceOf(BadRequestException);
  });
});
