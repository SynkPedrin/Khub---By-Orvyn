#!/usr/bin/env node
/**
 * Checa Anthropic vs Ollama e o mapeamento de modelo — sem imprimir segredo.
 *   node --env-file=.env scripts/operar/checar-ia.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { ConfigService } = require('../../dist/config/config.service');
const { AnthropicProvider } = require('../../dist/ai/anthropic.provider');
const { AiProviderRegistry } = require('../../dist/ai/provider.registry');
const mod = require('../../dist/ai/provider.contract');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const cfg = app.get(ConfigService);
  const ant = app.get(AnthropicProvider);
  const reg = app.get(AiProviderRegistry);
  console.log('provedor ativo (AGENT_LLM):', reg.nomeAtivo);
  console.log('anthropic configurada:', cfg.isConfigured('anthropic'), '| faltando:', cfg.missingVars('anthropic'));
  console.log('ollama base url definida:', !!process.env.OLLAMA_BASE_URL || !!process.env.OPENAI_BASE_URL);
  const core = app.get(require('../../dist/agents/intelligence/intelligence-core.service').IntelligenceCoreService);
  console.log('IA disponível p/ agentes:', core.iaDisponivel());
  // Modelo efetivo da Ritinha sob o provedor ativo
  const llm = app.get(mod.AGENT_LLM);
  console.log('AGENT_LLM provider:', llm.nome ?? '(sem nome)');
  const modelos = await (app.get(AnthropicProvider).modelos?.() ?? Promise.resolve(null)).catch(() => null);
  if (Array.isArray(modelos)) console.log('modelos anthropic:', modelos.map((m) => m.id).join(', '));
} finally {
  await app.close();
}
