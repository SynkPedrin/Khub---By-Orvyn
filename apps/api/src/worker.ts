import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env';
async function start(): Promise<void> {
  process.env.KHUB_PROCESS_ROLE = 'worker';
  loadEnv();
  // Import after selecting process role: the API does not register processors.
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
}
void start().catch(() => { process.stderr.write('Worker failed to start; check configuration and dependency health.\n'); process.exitCode = 1; });
