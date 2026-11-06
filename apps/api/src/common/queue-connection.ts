export function queueConnection() {
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
export const isWorker = () => process.env.ORVYN_PROCESS_ROLE === 'worker';
