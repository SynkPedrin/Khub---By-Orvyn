import { classificarErroGoogle, erroDeResposta, paraHttp, MENSAGEM_MEU_NEGOCIO_SEM_ACESSO } from './google-erros';
import { hasPermission, permissionFor } from '../../auth/permissions.guard';

const corpo = (code: number, status: string, message: string, reason?: string) => ({
  error: { code, status, message, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] : [] },
});

describe('classificação de erros do Google', () => {
  it('lê o formato AIP-193 (reason do ErrorInfo)', () => {
    const e = erroDeResposta(403, corpo(403, 'PERMISSION_DENIED', 'x', 'SERVICE_DISABLED'), 'tag_manager');
    expect(e.reason).toBe('SERVICE_DISABLED');
    expect(e.googleStatus).toBe('PERMISSION_DENIED');
    expect(classificarErroGoogle(e)).toBe('api_desativada');
  });

  it('Perfil da Empresa sem acesso aprovado: 403 de API não habilitada vira mensagem específica', () => {
    const e = erroDeResposta(403, corpo(403, 'PERMISSION_DENIED', 'My Business Account Management API has not been used in project 123 before or it is disabled.'), 'meu_negocio');
    expect(classificarErroGoogle(e)).toBe('meu_negocio_sem_acesso');
    const http = paraHttp(e);
    expect(http.getStatus()).toBe(403);
    expect(http.getResponse()).toMatchObject({ code: 'google_meu_negocio_sem_acesso', title: MENSAGEM_MEU_NEGOCIO_SEM_ACESSO });
    expect(MENSAGEM_MEU_NEGOCIO_SEM_ACESSO).toContain('Application for Basic API Access');
  });

  it('Perfil da Empresa com cota 0 (429) também é falta de aprovação', () => {
    const e = erroDeResposta(429, corpo(429, 'RESOURCE_EXHAUSTED', "Quota exceeded for quota metric 'Requests'", 'RATE_LIMIT_EXCEEDED'), 'meu_negocio');
    expect(classificarErroGoogle(e)).toBe('meu_negocio_sem_acesso');
  });

  it('429 em outro produto é limite, não falta de aprovação', () => {
    const e = erroDeResposta(429, corpo(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', 'RATE_LIMIT_EXCEEDED'), 'search_console');
    expect(classificarErroGoogle(e)).toBe('limite');
  });

  it('escopo insuficiente pede reconexão com a permissão certa', () => {
    const e = erroDeResposta(403, corpo(403, 'PERMISSION_DENIED', 'Request had insufficient authentication scopes.', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'), 'tag_manager');
    expect(classificarErroGoogle(e)).toBe('escopo_insuficiente');
    expect(paraHttp(e).getStatus()).toBe(409);
  });

  it('token revogado nunca vira 401 (o web faria logout da sessão KHUB)', () => {
    const oauth = erroDeResposta(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 'oauth');
    expect(classificarErroGoogle(oauth)).toBe('reconectar');
    expect(paraHttp(oauth).getStatus()).toBe(409);
    const api = erroDeResposta(401, corpo(401, 'UNAUTHENTICATED', 'Invalid Credentials'), 'search_console');
    expect(paraHttp(api).getStatus()).toBe(409);
  });

  it('403 comum é falta de permissão no recurso; 404 e 5xx mapeados', () => {
    expect(classificarErroGoogle(erroDeResposta(403, corpo(403, 'PERMISSION_DENIED', 'User does not have sufficient permission for site'), 'search_console'))).toBe('sem_permissao');
    expect(paraHttp(erroDeResposta(404, corpo(404, 'NOT_FOUND', 'nf'), 'tag_manager')).getStatus()).toBe(404);
    expect(paraHttp(erroDeResposta(503, {}, 'tag_manager')).getStatus()).toBe(502);
  });
});

describe('permissões das rotas /v1/google', () => {
  const u = (role: string) => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
  it('leitura é de manager+, nunca de member ou viewer', () => {
    const p = permissionFor('google', 'search-console/analise', 'GET');
    expect(hasPermission(u('manager'), p)).toBe(true);
    expect(hasPermission(u('admin'), p)).toBe(true);
    expect(hasPermission(u('member'), p)).toBe(false);
    expect(hasPermission(u('viewer'), p)).toBe(false);
  });
  it('conectar e escrever é só de owner/admin', () => {
    for (const [rota, metodo] of [['auth-url', 'GET'], ['tag-manager/publicar', 'POST'], ['meu-negocio/avaliacoes/responder', 'POST'], ['conexao', 'DELETE']] as const) {
      const p = permissionFor('google', rota, metodo);
      expect(hasPermission(u('manager'), p)).toBe(false);
      expect(hasPermission(u('owner'), p)).toBe(true);
    }
  });
});
