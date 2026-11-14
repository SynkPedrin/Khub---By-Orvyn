import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'body-parser';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { securityHeaders } from './common/security-headers';
import { makeLogger } from './common/json-logger';
import { loadEnv } from './config/env';

// Precisa rodar ANTES de qualquer outra coisa (inclusive `loadEnv()`) pra
// capturar erro de boot também — não só erro depois que a API já subiu.
// Sem SENTRY_DSN: no-op total, zero custo (achado real: código já estava
// escrito em error-reporter.service.ts, só faltava chamar `Sentry.init`).
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development', tracesSampleRate: 0 });
}

/** Rotas com corpo grande (ver o parser por rota em `bootstrap`). Exportadas para teste. */
export const ROTAS_WEBHOOK = /^\/v1\/(webhooks|hooks)\//;
export const ROTAS_UPLOAD = /^\/v1\/(agents\/[0-9a-f-]{36}\/conhecimento|crm\/import\/contacts|nyro\/chat|nyro\/chat\/stream|crm\/conversations\/[0-9a-f-]{36}\/midia|ads\/simulador\/analisar)$/;

/** Origens de CORS: CSV explícito; senão libera em dev e restringe ao WEB_URL em prod. */
function corsOrigins(env: ReturnType<typeof loadEnv>): true | string[] {
  if (env.CORS_ORIGINS) return env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return env.NODE_ENV === 'production' ? [env.WEB_URL] : true;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // Body parsing 100% manual (bodyParser: false): o parser global do Nest
  // (100 kb) é registrado ANTES dos app.use daqui e matava todo webhook de
  // mensageria com mídia em base64 (PayloadTooLargeError) — mensagens
  // recebidas nunca chegavam ao Inbox. O rawBody é capturado no `verify` de
  // cada parser: os webhooks da Meta (HMAC) e do Stripe precisam do corpo cru.
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigins(env), credentials: true },
    bodyParser: false,
    logger: makeLogger(env.LOG_FORMAT, env.NODE_ENV),
  });
  app.use(securityHeaders(env.NODE_ENV));
  const capturaRaw = (req: unknown, _res: unknown, buf: Buffer) => {
    (req as { rawBody?: Buffer }).rawBody = buf;
  };
  // Ordem importa: específicos primeiro (body-parser pula corpo já lido).
  // O caminho é testado DENTRO do middleware: `app.use(/regex/, fn)` não casa
  // no Express 4.22 e o corpo caía no parser padrão de 100 kb — webhook do
  // WhatsApp com mídia dava 500 PayloadTooLargeError em produção (2026-11-14).
  type Parser = ReturnType<typeof json>;
  const quando = (rota: RegExp, parser: Parser) =>
    function parserPorRota(req: Parameters<Parser>[0], res: Parameters<Parser>[1], next: Parameters<Parser>[2]) {
      if (rota.test((req as { path?: string }).path ?? req.url ?? '')) return parser(req, res, next);
      next();
    };
  // 1) Webhooks de mensageria (Stevo/Evolution/Meta): mídia em base64 e
  //    histórico de sync — limite alto. (Produção: mover mídia p/ storage.)
  const parserWebhook = json({ limit: '100mb', verify: capturaRaw });
  app.use(quando(ROTAS_WEBHOOK, parserWebhook));
  // 2) Upload de fonte de conhecimento (PDF/DOCX em base64, até 15 MB), anexos do chat da NICO,
  //    lote de importação de contatos (até 500 linhas por chamada), mídia de saída do Inbox (Q2.5)
  //    e imagem/frames do simulador de anúncios.
  const parserUpload = json({ limit: '22mb', verify: capturaRaw });
  app.use(quando(ROTAS_UPLOAD, parserUpload));
  // 3) Resto da API: limites padrão do Express, com rawBody preservado.
  //    urlencoded TAMBÉM precisa do limite alto: a Evolution/Stevo posta o
  //    webhook como form-urlencoded, e o default (100 kb) derrubava cada
  //    mensagem com mídia (achado real: requests de ~170 kb falhavam mesmo
  //    com o parser de webhook em 100 mb, porque caíam NESTE parser).
  app.use(json({ verify: capturaRaw }));
  app.use(urlencoded({ extended: true, limit: '100mb', verify: capturaRaw }));
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Socket.IO (D2): o prefixo /v1 não vale para o namespace do socket (/rt).
  const io = new RedisIoAdapter(app);
  await io.connectToRedis(env.REDIS_URL ?? 'redis://localhost:6379');
  app.useWebSocketAdapter(io);

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`KHUB API on :${env.PORT} (REST /v1 · socket /rt)`);
}

void bootstrap();
