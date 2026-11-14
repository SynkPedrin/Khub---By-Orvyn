import { HttpException } from '@nestjs/common';
import { GoogleConexaoService, type CredencialGoogle } from './google-conexao.service';
import { GoogleApiError } from './google-erros';
import { ESCOPOS_POR_CAPACIDADE } from './google-escopos';
import type { ConfigService } from '../../config/config.service';
import type { CryptoService } from '../crypto.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { GoogleHttp } from './google-http';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csecret',
  INTEGRATIONS_ENCRYPTION_KEY: 'k',
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  WEB_URL: 'https://app.exemplo.com/',
};

function montar(opts: { integ?: { id: string; status: string; credentialsEncrypted: string | null } | null; env?: Record<string, string> } = {}) {
  const env = opts.env ?? ENV;
  const config = {
    get: (k: string) => env[k],
    missingVars: (p: string) => (p === 'google_presenca' ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] : ['INTEGRATIONS_ENCRYPTION_KEY']).filter((k) => !env[k]),
    require: (p: string) => {
      const faltam = (p === 'google_presenca' ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] : ['INTEGRATIONS_ENCRYPTION_KEY']).filter((k) => !env[k]);
      if (faltam.length) throw new HttpException({ status: 'config_required', provider: p, missing: faltam }, 501);
    },
  } as unknown as ConfigService;
  const crypto = {
    configured: () => true,
    encryptJson: (o: unknown) => `cifrado:${JSON.stringify(o)}`,
    decryptJson: <T>(s: string) => JSON.parse(s.replace(/^cifrado:/, '')) as T,
  } as unknown as CryptoService;
  const tx = {
    integration: {
      findFirst: jest.fn().mockResolvedValue(opts.integ ?? null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'novo' }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = { withTenant: (_t: string, fn: (x: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService;
  const http = { token: jest.fn(), revogar: jest.fn().mockResolvedValue(undefined) };
  const svc = new GoogleConexaoService(prisma, config, crypto, http as unknown as GoogleHttp);
  return { svc, tx, http };
}

const cred = (expira: number): CredencialGoogle => ({ accessToken: 'velho', refreshToken: 'rt', expiresAt: new Date(expira).toISOString(), scopes: ESCOPOS_POR_CAPACIDADE.leitura });

describe('GoogleConexaoService', () => {
  it('sem credencial do Google: 501 config_required nomeando as variáveis', () => {
    const { svc } = montar({ env: { ...ENV, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } });
    try {
      svc.urlConexao(TENANT, null, 'leitura');
      throw new Error('deveria falhar');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(501);
      expect((e as HttpException).getResponse()).toMatchObject({ status: 'config_required', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] });
    }
  });

  it('URL de autorização: offline, consentimento, incremental, escopos só de leitura e state assinado', () => {
    const { svc } = montar();
    const u = new URL(svc.urlConexao(TENANT, 'id-1', 'leitura').url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('include_granted_scopes')).toBe('true');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.exemplo.com/api/integrations/google/callback');
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(ESCOPOS_POR_CAPACIDADE.leitura);
    expect(u.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it('callback grava credencial cifrada e audita', async () => {
    const { svc, tx, http } = montar();
    const state = new URL(svc.urlConexao(TENANT, 'id-1', 'leitura').url).searchParams.get('state')!;
    http.token.mockResolvedValue({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: ESCOPOS_POR_CAPACIDADE.leitura.join(' ') });
    const r = await svc.callback('code', state);
    expect(r.capacidades).toMatchObject({ tagManager: true, searchConsole: true, meuNegocio: true, tagManagerEscrita: false });
    const dados = tx.integration.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({ tenantId: TENANT, provider: 'google_presenca', status: 'connected', connectedBy: 'id-1' });
    expect(dados.credentialsEncrypted).toMatch(/^cifrado:/);
    expect(dados.credentialsEncrypted).not.toBe('rt');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('callback com state adulterado é 400 e não chama o Google', async () => {
    const { svc, http } = montar();
    await expect(svc.callback('code', 'abc.def')).rejects.toMatchObject({ status: 400 });
    expect(http.token).not.toHaveBeenCalled();
  });

  it('token válido não renova; perto de expirar renova e persiste cifrado', async () => {
    const valido = montar({ integ: { id: 'i1', status: 'connected', credentialsEncrypted: `cifrado:${JSON.stringify(cred(Date.now() + 30 * 60_000))}` } });
    expect((await valido.svc.token(TENANT)).accessToken).toBe('velho');
    expect(valido.http.token).not.toHaveBeenCalled();

    const vencendo = montar({ integ: { id: 'i1', status: 'connected', credentialsEncrypted: `cifrado:${JSON.stringify(cred(Date.now() + 10_000))}` } });
    vencendo.http.token.mockResolvedValue({ access_token: 'novo', expires_in: 3599 });
    expect((await vencendo.svc.token(TENANT)).accessToken).toBe('novo');
    expect(vencendo.http.token.mock.calls[0][0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt' });
    const salvo = vencendo.tx.integration.update.mock.calls[0][0].data.credentialsEncrypted as string;
    expect(JSON.parse(salvo.replace(/^cifrado:/, ''))).toMatchObject({ accessToken: 'novo', refreshToken: 'rt' });
  });

  it('refresh revogado marca a integração com erro e devolve 409 (nunca 401)', async () => {
    const { svc, http, tx } = montar({ integ: { id: 'i1', status: 'connected', credentialsEncrypted: `cifrado:${JSON.stringify(cred(0))}` } });
    http.token.mockRejectedValue(new GoogleApiError('Token has been expired or revoked.', 400, 'oauth', 'invalid_grant', 'invalid_grant', false));
    await expect(svc.token(TENANT)).rejects.toMatchObject({ status: 409 });
    expect(tx.integration.update.mock.calls[0][0].data).toMatchObject({ status: 'error', health: 'down' });
  });

  it('sem conexão: 409 google_nao_conectado (a tela mostra o CTA)', async () => {
    const { svc } = montar({ integ: null });
    await expect(svc.token(TENANT)).rejects.toMatchObject({ status: 409, response: { code: 'google_nao_conectado' } });
  });
});
