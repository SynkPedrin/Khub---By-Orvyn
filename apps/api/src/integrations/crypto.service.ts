import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigService } from '../config/config.service';

/**
 * Cifra credenciais OAuth por tenant em repouso (AES-256-GCM).
 * Chave: INTEGRATIONS_ENCRYPTION_KEY (32 bytes em base64). Nunca em log/código.
 */
@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return this.config.isConfigured('integrations_crypto');
  }

  private key(): Buffer {
    const k = this.config.get('INTEGRATIONS_ENCRYPTION_KEY');
    if (!k) throw new Error('INTEGRATIONS_ENCRYPTION_KEY ausente: necessária para conectar integrações.');
    const buf = Buffer.from(k, 'base64');
    if (buf.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY deve ter 32 bytes (base64).');
    return buf;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }

  encryptJson(obj: unknown): string {
    return this.encrypt(JSON.stringify(obj));
  }
  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
