import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { MODULOS, modulosDaRota, modulosDe, moduloLiberado, normalizarModulos, papelRestringivel } from './modulos';
import type { AuthUser } from './decorators';

/** Roda o guard real como se a request fosse `method /controller/route`. */
function passa(user: AuthUser, controller: string, route: string, method = 'GET'): boolean {
  const handler = () => undefined;
  class Ctrl {}
  Reflect.defineMetadata(PATH_METADATA, controller, Ctrl);
  Reflect.defineMetadata(PATH_METADATA, route, handler);
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

const colaborador = (modulos: string[] | null, role = 'member'): AuthUser => ({ identityId: 'i', tenantId: 't', role, email: 'a@b.c', modulos });

describe('acesso por módulo (ADR-0045)', () => {
  it('normaliza: só chaves conhecidas, sem repetição, na ordem do catálogo', () => {
    expect(normalizarModulos(['ia', 'conversas', 'xpto', 'ia', 3])).toEqual(['conversas', 'ia']);
    expect(normalizarModulos('ia')).toEqual([]);
  });

  it('permissoes sem `modulos` = sem restrição; lista vazia = nada', () => {
    expect(modulosDe({})).toBeNull();
    expect(modulosDe(null)).toBeNull();
    expect(modulosDe({ modulos: [] })).toEqual([]);
    expect(modulosDe({ modulos: ['agenda'] })).toEqual(['agenda']);
  });

  it('owner e admin nunca são restringíveis', () => {
    expect(papelRestringivel('owner')).toBe(false);
    expect(papelRestringivel('admin')).toBe(false);
    expect(['manager', 'member', 'viewer'].every(papelRestringivel)).toBe(true);
  });

  it('sem restrição, toda rota de módulo passa', () => {
    for (const m of MODULOS) expect(moduloLiberado(null, [m])).toBe(true);
  });

  it('IA bloqueada até ser liberada para a pessoa', () => {
    const semIa = colaborador(['dashboard', 'leads', 'pipeline', 'conversas', 'agenda']);
    expect(passa(semIa, 'nyro', 'chat', 'POST')).toBe(false);
    expect(passa(semIa, 'agents', '')).toBe(false);
    expect(passa(semIa, 'rag', 'docs')).toBe(false);
    const comIa = colaborador(['conversas', 'ia']);
    expect(passa(comIa, 'nyro', 'status')).toBe(true);
    expect(passa(comIa, 'agents', '')).toBe(true);
  });

  it('só Agenda: vê a agenda, não lê conversas nem o funil', () => {
    const u = colaborador(['agenda']);
    expect(passa(u, 'agenda', 'compromissos')).toBe(true);
    expect(passa(u, 'agenda', 'compromissos', 'POST')).toBe(true);
    expect(passa(u, 'crm', 'conversations')).toBe(false);
    expect(passa(u, 'crm', 'deals')).toBe(false);
    expect(passa(u, 'crm', 'overview')).toBe(false);
    // Lê o contato do compromisso, mas não edita cadastro.
    expect(passa(u, 'crm', 'contacts/:id')).toBe(true);
    expect(passa(u, 'crm', 'contacts/:id', 'PATCH')).toBe(false);
  });

  it('só Conversas: responde e edita o contato, lê a agenda dele, não mexe no funil', () => {
    const u = colaborador(['conversas']);
    expect(passa(u, 'crm', 'conversations/:id/messages', 'POST')).toBe(true);
    expect(passa(u, 'crm', 'contacts/:id', 'PATCH')).toBe(true);
    expect(passa(u, 'agenda', 'compromissos')).toBe(true);
    expect(passa(u, 'agenda', 'compromissos', 'POST')).toBe(false);
    expect(passa(u, 'crm', 'deals')).toBe(true);
    expect(passa(u, 'crm', 'deals/:id/move', 'PATCH')).toBe(false);
  });

  it('Dashboard lê o resumo; automações e financeiro ficam de fora', () => {
    const u = colaborador(['dashboard']);
    expect(passa(u, 'crm', 'overview')).toBe(true);
    expect(passa(u, 'analytics', 'funil')).toBe(true);
    expect(passa(u, 'automations', '')).toBe(false);
    expect(passa(u, 'financeiro', 'cobrancas')).toBe(false);
  });

  it('o papel continua valendo: módulo não dá poder que o papel não tem', () => {
    const viewer = colaborador(['pipeline'], 'viewer');
    expect(passa(viewer, 'crm', 'deals')).toBe(true);
    expect(passa(viewer, 'crm', 'deals/:id', 'PATCH')).toBe(false);
  });

  it('rotas fora de módulo (perfil, configurações) só dependem do papel', () => {
    const u = colaborador([]);
    expect(modulosDaRota('settings', 'profile', 'GET')).toBeNull();
    expect(passa(u, 'settings', 'profile')).toBe(true);
    expect(passa(u, 'auth', 'me')).toBe(true);
  });

  it('owner com `modulos` gravado por engano não é barrado (o guard JWT nem lê)', () => {
    // O JwtAuthGuard só preenche `modulos` para papel restringível; aqui o owner chega sem.
    expect(passa({ identityId: 'i', tenantId: 't', role: 'owner', email: 'a@b.c' }, 'nyro', 'chat', 'POST')).toBe(true);
  });
});
