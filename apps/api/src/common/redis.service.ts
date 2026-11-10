import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Cliente Redis compartilhado (rate limit, contadores). Conexão preguiçosa e
 * TOLERANTE: se o Redis cair, `incrWithTtl` devolve null e quem chama decide —
 * o rate limiter, por exemplo, libera a requisição (fail-open) em vez de derrubar
 * o tráfego. Redis é para proteção, não para bloquear o produto inteiro se sumir.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('RedisService');
  private client: Redis | null = null;
  private avisou = false;

  private conn(): Redis | null {
    if (this.client) return this.client;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    this.client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false });
    this.client.on('error', (e) => {
      if (!this.avisou) { this.log.warn(`Redis indisponível (${e.message}) — rate limit em modo fail-open`); this.avisou = true; }
    });
    return this.client;
  }

  /** INCR atômico com TTL na primeira ocorrência da janela. null se Redis off. */
  async incrWithTtl(key: string, ttlSec: number): Promise<number | null> {
    const c = this.conn();
    if (!c) return null;
    try {
      return Number(await c.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n", 1, key, ttlSec));
    } catch {
      return null; // fail-open
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
