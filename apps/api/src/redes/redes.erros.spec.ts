import { ErroRede, mapearErroGoogle, mapearErroMeta, mapearErroTiktok, secaoDeErro } from './redes.erros';
import { PERMISSOES_IG } from './redes.tipos';

describe('mapearErroMeta', () => {
  it('#10 sem citar a permissão: devolve as esperadas da chamada', () => {
    const i = mapearErroMeta(403, { error: { message: '(#10) Application does not have permission for this action', type: 'OAuthException', code: 10 } }, PERMISSOES_IG.insights);
    expect(i.tipo).toBe('permissao');
    expect(i.faltando).toEqual(['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement']);
    expect(i.mensagem).toContain('Revisão do App');
  });
  it('#200 citando a permissão: devolve só a citada', () => {
    const i = mapearErroMeta(403, { error: { message: '(#200) Requires instagram_content_publish permission to manage the object', code: 200 } }, PERMISSOES_IG.publicar);
    expect(i).toMatchObject({ tipo: 'permissao', faltando: ['instagram_content_publish'], codigo: '200' });
  });
  it('"Not enough viewers" é falta de dado, não de permissão', () => {
    expect(mapearErroMeta(400, { error: { message: '(#10) Not enough viewers for the media to show insights', code: 10 } }, []).tipo).toBe('dados');
  });
  it('190 e subcódigos de sessão: token', () => {
    expect(mapearErroMeta(401, { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } }, []).tipo).toBe('token');
    expect(mapearErroMeta(400, { error: { message: 'x', code: 102, error_subcode: 467 } }, []).tipo).toBe('token');
  });
  it('limites: 4, 17, 32, 613', () => {
    for (const code of [4, 17, 32, 613]) expect(mapearErroMeta(400, { error: { message: 'limit', code } }, []).tipo).toBe('limite');
  });
  it('5xx: indisponível', () => {
    expect(mapearErroMeta(503, {}, []).tipo).toBe('indisponivel');
  });
});

describe('mapearErroTiktok', () => {
  it('scope_not_authorized: lista o escopo esperado', () => {
    expect(mapearErroTiktok(401, { error: { code: 'scope_not_authorized', message: '', log_id: 'l' } }, ['user.info.stats'])).toMatchObject({ tipo: 'permissao', faltando: ['user.info.stats'] });
  });
  it('cliente sem auditoria: diz que falta a auditoria', () => {
    const i = mapearErroTiktok(403, { error: { code: 'unaudited_client_can_only_post_to_private_accounts' } }, ['video.publish']);
    expect(i.tipo).toBe('permissao');
    expect(i.faltando[0]).toContain('Auditoria');
  });
  it('URL sem domínio verificado: configuração no portal', () => {
    expect(mapearErroTiktok(403, { error: { code: 'url_ownership_unverified' } }, []).tipo).toBe('config');
  });
  it('token inválido (API e OAuth) e limites', () => {
    expect(mapearErroTiktok(401, { error: { code: 'access_token_invalid' } }, []).tipo).toBe('token');
    expect(mapearErroTiktok(400, { error: 'invalid_grant', error_description: 'expired' }, []).tipo).toBe('token');
    expect(mapearErroTiktok(429, { error: { code: 'rate_limit_exceeded' } }, []).tipo).toBe('limite');
    expect(mapearErroTiktok(403, { error: { code: 'spam_risk_too_many_posts' } }, []).tipo).toBe('limite');
  });
});

describe('mapearErroGoogle', () => {
  const corpo = (reason: string, status?: string) => ({ error: { code: 403, message: 'm', status, errors: [{ reason, domain: 'global' }] } });
  it('escopo insuficiente: lista os escopos esperados', () => {
    expect(mapearErroGoogle(403, corpo('insufficientPermissions'), ['https://www.googleapis.com/auth/yt-analytics.readonly'])).toMatchObject({ tipo: 'permissao', faltando: ['https://www.googleapis.com/auth/yt-analytics.readonly'] });
    expect(mapearErroGoogle(403, { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, ['x']).tipo).toBe('permissao');
  });
  it('API desativada no projeto: configuração', () => {
    const i = mapearErroGoogle(403, corpo('accessNotConfigured'), []);
    expect(i.tipo).toBe('config');
    expect(i.faltando[0]).toContain('Google Cloud');
  });
  it('cota: limite; 401 e invalid_grant: token', () => {
    expect(mapearErroGoogle(403, corpo('quotaExceeded'), []).tipo).toBe('limite');
    expect(mapearErroGoogle(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, []).tipo).toBe('token');
    expect(mapearErroGoogle(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, []).tipo).toBe('token');
  });
});

describe('secaoDeErro', () => {
  it('converte ErroRede na seção da tela com o que falta', () => {
    const e = new ErroRede('instagram', mapearErroMeta(403, { error: { message: '(#10) x', code: 10 } }, ['instagram_manage_insights']));
    expect(secaoDeErro(e)).toMatchObject({ status: 'sem_permissao', faltando: ['instagram_manage_insights'] });
  });
  it('erro genérico vira status erro', () => {
    expect(secaoDeErro(new Error('rede caiu')).status).toBe('erro');
  });
});
