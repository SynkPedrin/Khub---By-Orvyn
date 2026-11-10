import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Adapter de Redis para o Socket.IO (ADR-0011).
 *
 * Por quê: com 2+ instâncias da API atrás de um load balancer, o socket do
 * usuário está numa instância e o `emit` acontece na outra — sem um barramento
 * comum, o evento simplesmente não chega e o bug só aparece em produção.
 *
 * Sem Redis, degrada para memória (dev/instância única) com aviso — o tempo real
 * continua funcionando localmente em vez de derrubar o boot.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger('RealtimeAdapter');
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(url: string): Promise<boolean> {
    const pub = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    const sub = pub.duplicate();
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.adapterConstructor = createAdapter(pub, sub);
      this.log.log('Socket.IO usando Redis (pronto para múltiplas instâncias)');
      return true;
    } catch (e) {
      this.log.warn(`Redis indisponível (${(e as Error).message}) — Socket.IO em memória: tempo real só funciona nesta instância`);
      pub.disconnect();
      sub.disconnect();
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) (server as { adapter: (a: unknown) => void }).adapter(this.adapterConstructor);
    return server;
  }
}
