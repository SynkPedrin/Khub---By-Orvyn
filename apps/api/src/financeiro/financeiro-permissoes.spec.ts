import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/permissions.guard';
import type { AuthUser } from '../auth/decorators';

/** Roda o guard real como se a request fosse `method /controller/route`. */
function passa(role: string, controller: string, route: string, method = 'GET', modulos: string[] | null = null): boolean {
  const handler = () => undefined;
  class Ctrl {}
  Reflect.defineMetadata(PATH_METADATA, controller, Ctrl);
  Reflect.defineMetadata(PATH_METADATA, route, handler);
  const user: AuthUser = { identityId: 'i', tenantId: 't', role, email: 'a@b.c', modulos };
  const ctx = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Ctrl,
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  };
  try {
    return new PermissionsGuard(new Reflector()).canActivate(ctx as never);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('Financeiro: quem vê e quem mexe no dinheiro da empresa (FIN-GESTAO)', () => {
  const leituras = ['transacoes', 'fluxo', 'categorias', 'comissoes/equipe', 'comissoes/geradas'];
  const escritas: [string, string][] = [
    ['transacoes', 'POST'],
    ['transacoes/:id', 'PATCH'],
    ['transacoes/:id', 'DELETE'],
    ['categorias', 'POST'],
    ['importar', 'POST'],
    ['comissoes/equipe/:identityId', 'PUT'],
    ['comissoes/geradas/:id/pagar', 'POST'],
    ['comissoes/geradas/:id/estornar', 'POST'],
  ];

  it.each(leituras)('member NÃO lê %s (caixa e comissões da equipe são sensíveis)', (r) => {
    expect(passa('member', 'financeiro', r)).toBe(false);
  });

  it.each(leituras)('manager e owner leem %s', (r) => {
    expect(passa('manager', 'financeiro', r)).toBe(true);
    expect(passa('owner', 'financeiro', r)).toBe(true);
  });

  it.each(escritas)('só owner/admin escreve em %s (%s)', (r, m) => {
    expect(passa('owner', 'financeiro', r, m)).toBe(true);
    expect(passa('admin', 'financeiro', r, m)).toBe(true);
    expect(passa('manager', 'financeiro', r, m)).toBe(false);
    expect(passa('member', 'financeiro', r, m)).toBe(false);
    expect(passa('viewer', 'financeiro', r, m)).toBe(false);
  });

  it('cobranças continuam como antes: member lê, não cria', () => {
    expect(passa('member', 'financeiro', 'cobrancas')).toBe(true);
    expect(passa('member', 'financeiro', 'resumo')).toBe(true);
    expect(passa('member', 'financeiro', 'cobrancas', 'POST')).toBe(false);
  });

  it('o módulo Financeiro continua exigido para quem tem módulos restritos', () => {
    expect(passa('manager', 'financeiro', 'fluxo', 'GET', ['agenda'])).toBe(false);
    expect(passa('manager', 'financeiro', 'fluxo', 'GET', ['financeiro'])).toBe(true);
  });

  it('agenda: member marca e conclui atendimento, mas importação em lote é manager+', () => {
    expect(passa('member', 'agenda', 'compromissos/:id/status', 'POST')).toBe(true);
    expect(passa('member', 'agenda', 'importar', 'POST')).toBe(false);
    expect(passa('manager', 'agenda', 'importar', 'POST')).toBe(true);
  });
});
