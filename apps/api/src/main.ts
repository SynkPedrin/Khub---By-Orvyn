import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { securityHeaders } from './common/security-headers';
import { makeLogger } from './common/json-logger';
import { loadEnv } from './config/env';

/** Origens de CORS: CSV explícito; senão libera em dev e restringe ao WEB_URL em prod. */
function corsOrigins(env: ReturnType<typeof loadEnv>): true | string[] {
  if (env.CORS_ORIGINS) return env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return env.NODE_ENV === 'production' ? [env.WEB_URL] : true;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // rawBody: exigido para validar a assinatura HMAC do webhook da Meta sobre o
  // corpo CRU (o JSON re-serializado não bate com a assinatura original).
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigins(env), credentials: true },
    rawBody: true,
    logger: makeLogger(env.LOG_FORMAT, env.NODE_ENV),
  });
  app.use(securityHeaders(env.NODE_ENV));
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Socket.IO (D2): o prefixo /v1 não vale para o namespace do socket (/rt).
  const io = new RedisIoAdapter(app);
  await io.connectToRedis(env.REDIS_URL ?? 'redis://localhost:6379');
  app.useWebSocketAdapter(io);

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Orvyn API on :${env.PORT} (REST /v1 · socket /rt)`);
}

void bootstrap();
