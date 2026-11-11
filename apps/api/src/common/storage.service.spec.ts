import { assinarPut, encodeRfc3986, nomeSeguro, preAssinarUrl, StorageService } from './storage.service';
import { ConfigService, ConfigRequiredException } from '../config/config.service';

/** Vetor oficial da AWS ("Authenticating Requests: Using Query Parameters", exemplo de GET pré-assinado). */
const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1' };

describe('SigV4 (storage S3-compatible)', () => {
  it('URL pré-assinada bate com o vetor oficial da AWS', () => {
    const url = preAssinarUrl(AWS, {
      metodo: 'GET',
      origem: 'https://examplebucket.s3.amazonaws.com',
      caminho: '/test.txt',
      expiraEmS: 86400,
      agora: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });

  it('PUT assinado: cabeçalhos completos, hash do corpo e assinatura determinística', () => {
    const corpo = Buffer.from('conteúdo');
    const req = { origem: 'https://conta.r2.cloudflarestorage.com', caminho: '/bucket/inbox/t/a b.pdf', corpo, contentType: 'application/pdf', agora: new Date('2026-11-10T12:00:00Z') };
    const h1 = assinarPut(AWS, req);
    const h2 = assinarPut(AWS, req);
    expect(h1).toEqual(h2);
    expect(h1['x-amz-date']).toBe('20261110T120000Z');
    expect(h1['x-amz-content-sha256']).toHaveLength(64);
    expect(h1.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261110\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(assinarPut(AWS, { ...req, corpo: Buffer.from('outro') }).authorization).not.toBe(h1.authorization);
  });

  it('codificação RFC 3986 estrita e nome de arquivo seguro', () => {
    expect(encodeRfc3986("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
    expect(nomeSeguro('Proposta Comercial (v2) — São Paulo.pdf')).toBe('Proposta-Comercial-v2-Sao-Paulo.pdf');
    expect(nomeSeguro('../../etc/passwd')).not.toContain('/');
  });
});

describe('StorageService — gating', () => {
  const VARS = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'];
  const guardado: Record<string, string | undefined> = {};
  beforeEach(() => VARS.forEach((v) => { guardado[v] = process.env[v]; delete process.env[v]; }));
  afterEach(() => VARS.forEach((v) => { if (guardado[v] === undefined) delete process.env[v]; else process.env[v] = guardado[v]; }));

  it('sem as variáveis: enviar lança 501 config_required nomeando o que falta; leitura devolve null', async () => {
    const s = new StorageService(new ConfigService());
    expect(s.configurado()).toBe(false);
    await expect(s.enviar('k', Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(ConfigRequiredException);
    expect(s.faltando()).toEqual(['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
    expect(s.urlLeitura('k')).toBeNull();
  });

  it('configurado: URL assinada path-style; com base pública, usa a CDN', () => {
    Object.assign(process.env, { S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com', S3_BUCKET: 'khub', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'segredo' });
    const s = new StorageService(new ConfigService());
    const url = s.urlLeitura('inbox/t/c/k-a.pdf', 3600)!;
    expect(url.startsWith('https://conta.r2.cloudflarestorage.com/khub/inbox/t/c/k-a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256')).toBe(true);
    expect(url).toContain('X-Amz-Expires=3600');
    process.env.S3_PUBLIC_BASE_URL = 'https://arquivos.khub.app/';
    expect(s.urlLeitura('inbox/t/c/k-a.pdf')).toBe('https://arquivos.khub.app/inbox/t/c/k-a.pdf');
  });
});
