import { urlSegura } from './url-segura';

describe('urlSegura — credencial nunca vai para log/Sentry (doc 18)', () => {
  it('token da Evolution no path', () => {
    expect(urlSegura('/v1/hooks/evolution/whk_abc123def456')).toBe('/v1/hooks/evolution/[redigido]');
  });
  it('chave do webhook genérico no path', () => {
    expect(urlSegura('/v1/hooks/c2a9f0e1-segredo')).toBe('/v1/hooks/[redigido]');
  });
  it('token da Stevo na query, preservando os demais parâmetros', () => {
    expect(urlSegura('/v1/webhooks/stevo?token=whk_e9xyz&evento=msg')).toBe('/v1/webhooks/stevo?token=[redigido]&evento=msg');
  });
  it('verify token da Meta e chaves comuns', () => {
    expect(urlSegura('/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=1')).toBe('/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=[redigido]&hub.challenge=1');
    expect(urlSegura('/x?apikey=1&ApiKey=2')).toBe('/x?apikey=[redigido]&ApiKey=[redigido]');
  });
  it('URL sem segredo passa intacta', () => {
    expect(urlSegura('/v1/crm/contacts?q=ana&limit=20')).toBe('/v1/crm/contacts?q=ana&limit=20');
    expect(urlSegura(undefined)).toBe('');
  });
});
