// Reproduz o caminho inbound isolado (contexto Nest real, DB QA) e imprime o erro completo.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule: WorkerModule } = require('../../dist/app.module.js');
const { MessagesService } = require('../../dist/crm/messaging/messages.service.js');
const tenantId = process.argv[2];
const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
try {
  const r = await app.get(MessagesService).receiveInbound({ tenantId, fromNumber: '5511988887777', fromName: 'Repro', text: 'repro inbound', providerMessageId: 'REPRO-' + Date.now() });
  console.log('OK', JSON.stringify(r));
} catch (e) { console.log('ERRO', e.constructor.name, e.code, e.meta ? JSON.stringify(e.meta) : '', '\n', String(e.message).slice(0, 1200)); }
await app.close(); process.exit(0);
