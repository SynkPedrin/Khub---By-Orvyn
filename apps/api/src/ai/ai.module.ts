import { Global, Module } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import { AiProviderRegistry } from './provider.registry';
import { AI_PROVIDER, type AIProvider } from './provider.contract';
import { AiService } from './ai.service';

/**
 * Camada de IA compartilhada (ADR-0019). `@Global`: tanto o motor de automações
 * quanto o Copiloto injetam o provider/serviço sem re-importar nem duplicar
 * código. É a fronteira limpa — `ai` é infra de baixo nível; ninguém importa o
 * interno.
 *
 * O token `AI_PROVIDER` é o que o domínio deve injetar. `AnthropicProvider`
 * segue exportado para os consumidores que ainda não migraram (NyroService),
 * mas código novo usa o token — é ele que mantém o produto independente de
 * fornecedor.
 */
@Global()
@Module({
  providers: [
    AnthropicProvider,
    OpenAiProvider,
    AiProviderRegistry,
    {
      provide: AI_PROVIDER,
      inject: [AiProviderRegistry],
      useFactory: (registry: AiProviderRegistry): AIProvider => registry.ativo(),
    },
    AiService,
  ],
  exports: [AI_PROVIDER, AiProviderRegistry, AiService, AnthropicProvider],
})
export class AiModule {}
