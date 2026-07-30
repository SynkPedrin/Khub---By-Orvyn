import { Controller, Get } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../common/rate-limit.guard';

@Public()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    // `ok` só quando o banco responde; Redis ausente degrada (rate limit fail-open,
    // socket em memória) mas não derruba a saúde — reportamos como `degraded`.
    const status = db ? (redis ? 'ok' : 'degraded') : 'down';
    return { status, service: 'orvyn-api', db, redis, ts: new Date().toISOString() };
  }

  private async checkDb(): Promise<boolean> {
    try { await this.prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
  }

  private async checkRedis(): Promise<boolean> {
    const url = process.env.REDIS_URL;
    if (!url) return false;
    const c = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false, connectTimeout: 1500 });
    try {
      await c.connect();
      return (await c.ping()) === 'PONG';
    } catch {
      return false;
    } finally {
      c.disconnect();
    }
  }
}
