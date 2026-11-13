import { EventEmitter } from 'node:events';
import { RedisService } from './redis.service';

/** Cliente falso: começa conectando e só aceita comando depois do `ready`. */
class ClienteFalso extends EventEmitter {
  status = 'connecting';
  async eval(): Promise<number> {
    if (this.status !== 'ready') throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    return 1;
  }
  disconnect(): void {
    this.status = 'end';
  }
}

function servico(c: ClienteFalso): RedisService {
  const s = new RedisService();
  (s as unknown as { client: ClienteFalso }).client = c;
  return s;
}

describe('RedisService.incrWithTtl', () => {
  it('a requisição que acorda a API espera o Redis ficar pronto (antes dava 503 no login)', async () => {
    const c = new ClienteFalso();
    const p = servico(c).incrWithTtl('k', 60);
    setTimeout(() => {
      c.status = 'ready';
      c.emit('ready');
    }, 20);
    await expect(p).resolves.toBe(1);
  });

  it('Redis que nunca fica pronto devolve null (quem chama decide), sem travar para sempre', async () => {
    jest.useFakeTimers();
    const p = servico(new ClienteFalso()).incrWithTtl('k', 60);
    jest.advanceTimersByTime(3001);
    await expect(p).resolves.toBeNull();
    jest.useRealTimers();
  });

  it('conexão encerrada não espera', async () => {
    const c = new ClienteFalso();
    c.status = 'end';
    await expect(servico(c).incrWithTtl('k', 60)).resolves.toBeNull();
  });
});
