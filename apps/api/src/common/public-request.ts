import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RedisService } from './redis.service';

/**
 * Proteções das rotas PÚBLICAS sem sessão (formulários /f, agendamento /b).
 *
 * Três camadas, todas antes de qualquer escrita:
 *  1. IP real do visitante (`ipDoCliente`): o tráfego chega pelo proxy do web
 *     (Next). Só confiamos no IP repassado quando o proxy prova quem é com o
 *     segredo compartilhado `KHUB_PROXY_SECRET`; sem ele, vale o IP do socket.
 *  2. Rate limit por IP e recurso (`PublicRateLimiter`), janela fixa no Redis.
 *  3. Anti-robô: campo isca (honeypot) e tempo mínimo de preenchimento medido
 *     por um carimbo ASSINADO pelo servidor no GET (o cliente não forja "comecei
 *     há 10 segundos": o horário está dentro do HMAC).
 */

export interface RequisicaoPublica {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function cabecalho(req: RequisicaoPublica, nome: string): string | undefined {
  const v = req.headers[nome];
  return Array.isArray(v) ? v[0] : v;
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** IP do visitante: o repassado pelo proxy autenticado, senão o do socket. */
export function ipDoCliente(req: RequisicaoPublica, segredo = process.env.KHUB_PROXY_SECRET): string {
  const proxy = cabecalho(req, 'x-khub-proxy-secret');
  const repassado = cabecalho(req, 'x-khub-client-ip')?.trim();
  if (segredo && segredo.length >= 16 && proxy && iguais(proxy, segredo) && repassado && IP_RE.test(repassado)) return repassado;
  return req.ip || req.socket?.remoteAddress || 'desconhecido';
}

/** sha256 com sal por tenant: serve para limitar/auditar sem guardar o IP (LGPD). */
export function hashIp(tenantId: string, ip: string): string {
  return createHash('sha256').update(`khub-ip:${tenantId}:${ip}`).digest('hex');
}

/** User-Agent truncado (a coluna aceita até 400). */
export function userAgentDe(req: RequisicaoPublica): string | null {
  const ua = cabecalho(req, 'user-agent')?.trim();
  return ua ? ua.slice(0, 400) : null;
}

function segredoCarimbo(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET ausente');
  return `khub-carimbo:${s}`;
}

/** Carimbo de abertura do formulário: `<ms>.<hmac(escopo, ms)>`. */
export function emitirCarimbo(escopo: string, agora = Date.now()): string {
  const mac = createHmac('sha256', segredoCarimbo()).update(`${escopo}:${agora}`).digest('base64url');
  return `${agora}.${mac}`;
}

export type VeredictoAntiRobo = 'ok' | 'isca' | 'rapido' | 'carimbo_invalido';

/**
 * Honeypot preenchido → `isca` (robô: a resposta finge sucesso e nada é gravado).
 * Carimbo ausente/forjado/expirado → `carimbo_invalido`. Enviado antes de
 * `minimoMs` desde a abertura → `rapido`.
 */
export function avaliarAntiRobo(
  escopo: string,
  entrada: { isca?: unknown; carimbo?: unknown },
  opts: { minimoMs?: number; maximoMs?: number; agora?: number } = {},
): VeredictoAntiRobo {
  if (typeof entrada.isca === 'string' ? entrada.isca.trim() !== '' : entrada.isca != null && entrada.isca !== false) return 'isca';
  const minimo = opts.minimoMs ?? 3000;
  const maximo = opts.maximoMs ?? 24 * 3_600_000;
  const agora = opts.agora ?? Date.now();
  if (typeof entrada.carimbo !== 'string') return 'carimbo_invalido';
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(entrada.carimbo);
  if (!m) return 'carimbo_invalido';
  const emitido = Number(m[1]);
  const esperado = createHmac('sha256', segredoCarimbo()).update(`${escopo}:${emitido}`).digest('base64url');
  if (!iguais(m[2], esperado)) return 'carimbo_invalido';
  const decorrido = agora - emitido;
  if (decorrido < 0 || decorrido > maximo) return 'carimbo_invalido';
  if (decorrido < minimo) return 'rapido';
  return 'ok';
}

/** Token opaco de 256 bits (link de gerenciamento) e o hash que vai ao banco. */
export function novoTokenOpaco(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export const TOKEN_OPACO_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Rate limit das rotas públicas, por IP + recurso. Mais apertado que o global
 * (que só conta requisições): um envio é escrita no CRM do cliente.
 * Fail-open em dev sem Redis; em produção sem Redis, 503 (mesma regra do
 * `RateLimitGuard`).
 */
@Injectable()
export class PublicRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consumir(chave: string, max: number, janelaSec: number): Promise<void> {
    const bucket = Math.floor(Date.now() / 1000 / janelaSec);
    const n = await this.redis.incrWithTtl(`rl:pub:${chave}:${bucket}`, janelaSec);
    if (n === null) {
      if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('proteção de tráfego indisponível');
      return;
    }
    if (n > max) {
      throw new HttpException(
        { title: 'Muitas tentativas', status: 429, detail: 'Você fez muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.', code: 'rate_limited', retryAfter: janelaSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
