import { Injectable } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { ErroProvedorIA, type AIProvider, type EntradaConversa, type EntradaGeracao, type PapelModelo, type ToolIA } from './provider.contract';

/** Adaptador nativo: não consome credenciais de provedores pagos. */
@Injectable()
export class OllamaProvider implements AIProvider {
  readonly nome = 'ollama';
  constructor(private readonly transporte: AnthropicProvider) {}
  configured(): boolean { return !!process.env.OLLAMA_BASE_URL?.trim(); }
  missing(): string[] { return this.configured() ? [] : ['OLLAMA_BASE_URL']; }
  modeloPara(papel: PapelModelo): string {
    return papel === 'roteador'
      ? process.env.OLLAMA_MODEL_ROTEADOR || process.env.OPENAI_MODEL_ROTEADOR || 'qwen3.5:4b'
      : process.env.OLLAMA_MODEL_AGENTE || process.env.OPENAI_MODEL_AGENTE || 'qwen3.5:9b';
  }
  async conversar(input: EntradaConversa) {
    if (!this.configured()) throw new ErroProvedorIA('OLLAMA_BASE_URL ausente', 'credencial', this.nome);
    return this.transporte.conversarOllama(input);
  }
  async generate(input: EntradaGeracao) {
    const resposta = await this.conversar({ ...input, modelo: this.modeloPara(input.papel) });
    return { ...resposta, provedor: this.nome };
  }
  toolCall(input: EntradaGeracao & { tools: ToolIA[] }) { return this.generate(input); }
  async modelosDisponiveis() {
    return [...new Set([this.modeloPara('agente'), this.modeloPara('roteador')])].map((id) => ({ id, nome: id, descricao: 'Modelo configurado no servidor Ollama', entradaUsdPorMilhao: 0, saidaUsdPorMilhao: 0 }));
  }
}
