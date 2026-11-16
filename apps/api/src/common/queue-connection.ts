import { Redis, type RedisOptions } from 'ioredis';

/** Opções de conexão a partir do REDIS_URL (TLS quando `rediss:`). */
export function opcoesRedisFila(): RedisOptions {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname, port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

let compartilhada: Redis | null = null;

/**
 * UMA conexão por processo para todas as filas do BullMQ (2026-11-14).
 * Antes cada fila abria a própria: 11 filas na API + 11 filas e 11 workers
 * (2 conexões cada) no worker ≈ 50 conexões — o teto do Redis gratuito do
 * Render. Passou disso, o Redis derrubava conexões (ECONNRESET), o /ready
 * falhava e a API saía do ar. Com a instância compartilhada, filas reusam
 * esta conexão e cada worker só duplica a sua conexão de espera (bloqueante).
 */
export function queueConnection(): Redis {
  compartilhada ??= new Redis({ ...opcoesRedisFila(), connectionName: `khub-filas-${isWorker() ? 'worker' : 'api'}` });
  return compartilhada;
}
// ORVYN_PROCESS_ROLE: nome legado (ADR-0041), aceito até os ambientes migrarem.
export const isWorker = () => (process.env.KHUB_PROCESS_ROLE ?? process.env.ORVYN_PROCESS_ROLE) === 'worker';
