import { Global, Module } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { AiService } from './ai.service';

/**
 * Camada de IA compartilhada (ADR-0019). `@Global`: tanto o motor de automações
 * quanto a Nyro injetam o provider/serviço sem re-importar nem duplicar código.
 * É a fronteira limpa — `ai` é infra de baixo nível; ninguém importa o interno.
 */
@Global()
@Module({
  providers: [AnthropicProvider, AiService],
  exports: [AnthropicProvider, AiService],
})
export class AiModule {}
