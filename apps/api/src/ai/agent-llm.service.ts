import { Injectable } from '@nestjs/common';
import { AiProviderRegistry } from './provider.registry';
import {
  ErroProvedorIA,
  type AgentLlm,
  type AIProvider,
  type EntradaConversa,
  type RespostaConversa,
} from './provider.contract';

/**
 * Superfície de IA do módulo de agentes (criador, simulador, memória,
 * aprendizado, follow-up, avaliação). Resolve o provedor ativo a cada chamada
 * via registry: trocar `AI_PROVIDER` na env muda o módulo inteiro sem tocar
 * em nenhum serviço de domínio.
 *
 * Antes desta facade, os serviços de agentes injetavam `AnthropicProvider`
 * diretamente — sem `ANTHROPIC_API_KEY` o criador de agentes inteiro ficava
 * inutilizável, mesmo com outro provedor (Ollama) disponível.
 */
@Injectable()
export class AgentLlmService implements AgentLlm {
  constructor(private readonly registry: AiProviderRegistry) {}

  private get p(): AIProvider {
    return this.registry.ativo();
  }

  configured(): boolean {
    return this.p.configured();
  }

  missing(): string[] {
    return this.p.missing();
  }

  provedor(): string {
    return this.p.nome;
  }

  exigirCredencial(): void {
    if (!this.p.configured()) {
      throw new ErroProvedorIA(`falta ${this.p.missing().join(', ')}`, 'credencial', this.p.nome);
    }
  }

  conversar(input: EntradaConversa): Promise<RespostaConversa> {
    const p = this.p;
    if (!p.conversar) {
      throw new ErroProvedorIA(`provedor ${p.nome} não suporta conversa multi-turno com tools`, 'requisicao', p.nome);
    }
    return p.conversar(input);
  }
}
