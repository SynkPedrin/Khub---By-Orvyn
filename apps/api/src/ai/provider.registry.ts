import { Injectable, Logger } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenAiProvider } from './openai.provider';
import type { AIProvider } from './provider.contract';

/**
 * Registry de provedores de IA.
 *
 * Um único lugar decide qual adapter atende o produto. A escolha vem de
 * `AI_PROVIDER` (env); o padrão é `anthropic`, que é o provedor de produção.
 *
 * Deliberadamente **não** faz failover automático entre provedores. Trocar de
 * fornecedor no meio de uma execução mudaria custo, latência e comportamento
 * de tools sem que ninguém tivesse pedido — e esconderia a falha real. A
 * indisponibilidade sobe como `ErroProvedorIA` retentável e o circuit breaker
 * de cada adapter cuida do resto.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly log = new Logger('AiProviderRegistry');
  private readonly porNome: Map<string, AIProvider>;

  constructor(anthropic: AnthropicProvider, openai: OpenAiProvider, ollama: OllamaProvider) {
    this.porNome = new Map<string, AIProvider>([
      [anthropic.nome, anthropic],
      [openai.nome, openai],
      // A API nativa permite desativar thinking e preserva o schema estruturado.
      ['ollama', ollama],
    ]);
  }

  /** Nome do provedor ativo, conforme env (default: anthropic). */
  get nomeAtivo(): string {
    return (process.env.AI_PROVIDER || 'anthropic').toLowerCase().trim();
  }

  /**
   * Provedor ativo. Nome desconhecido cai no padrão com aviso — derrubar a
   * aplicação inteira por um typo em variável de ambiente seria pior.
   */
  ativo(): AIProvider {
    const escolhido = this.porNome.get(this.nomeAtivo);
    if (escolhido) return escolhido;

    this.log.warn(
      `AI_PROVIDER="${this.nomeAtivo}" não é um provedor conhecido (${[...this.porNome.keys()].join(', ')}); usando anthropic`,
    );
    return this.porNome.get('anthropic')!;
  }

  /** Provedor específico por nome — para testes e rotas de diagnóstico. */
  porChave(nome: string): AIProvider | undefined {
    return this.porNome.get(nome.toLowerCase().trim());
  }

  /** Diagnóstico exibido em Configurações › IA. */
  listar(): { nome: string; ativo: boolean; configurado: boolean; faltando: string[] }[] {
    const ativo = this.ativo().nome;
    return [...this.porNome.values()].map((p) => ({
      nome: p.nome,
      ativo: p.nome === ativo,
      configurado: p.configured(),
      faltando: p.missing(),
    }));
  }
}
