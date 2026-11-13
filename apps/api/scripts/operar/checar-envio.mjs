#!/usr/bin/env node
/** Checa travas de envio sem imprimir segredos. */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { ConfigService } = require('../../dist/config/config.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const cfg = app.get(ConfigService);
  const mask = (v) => (v ? `${String(v).slice(0, 6)}…(${String(v).length} dígitos)` : null);
  console.log('NODE_ENV:', process.env.NODE_ENV ?? '(vazio)');
  console.log('STEVO_TEST_NUMBER definido:', !!cfg.get('STEVO_TEST_NUMBER'), mask(cfg.get('STEVO_TEST_NUMBER')));
  console.log('stevo_api configurado:', cfg.isConfigured('stevo_api'), '| faltando:', cfg.missingVars('stevo_api'));
  console.log('AI_PROVIDER:', process.env.AI_PROVIDER ?? '(default anthropic)');
  console.log('OPENAI_MODEL_AGENTE:', process.env.OPENAI_MODEL_AGENTE ?? '(default)');
  console.log('OLLAMA_BASE_URL/OPENAI_BASE_URL definida:', !!(process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL));
} finally {
  await app.close();
}
