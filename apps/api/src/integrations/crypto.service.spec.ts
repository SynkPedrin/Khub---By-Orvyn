import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service';
import { ConfigService } from '../config/config.service';

describe('CryptoService (AES-256-GCM)', () => {
  const svc = new CryptoService(new ConfigService());
  beforeAll(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('faz roundtrip de string', () => {
    const enc = svc.encrypt('token-secreto-123');
    expect(enc).not.toContain('token-secreto');
    expect(svc.decrypt(enc)).toBe('token-secreto-123');
  });

  it('faz roundtrip de JSON', () => {
    const cred = { accessToken: 'abc', scopes: ['ads_read'] };
    expect(svc.decryptJson(svc.encryptJson(cred))).toEqual(cred);
  });

  it('detecta adulteração (GCM auth tag)', () => {
    const enc = svc.encrypt('x');
    const raw = Buffer.from(enc, 'base64');
    raw[raw.length - 1] ^= 0xff; // corrompe o ciphertext
    expect(() => svc.decrypt(raw.toString('base64'))).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(10).toString('base64');
    expect(() => svc.encrypt('x')).toThrow(/32 bytes/);
    process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
});
