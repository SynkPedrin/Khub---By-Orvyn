import { Logger } from '@nestjs/common';

type Estado = 'fechado' | 'aberto' | 'meio-aberto';

export interface CircuitOptions {
  /** Falhas seguidas para abrir o circuito. */
  limiteFalhas?: number;
  /** Tempo (ms) que o circuito fica aberto antes de testar de novo. */
  cooldownMs?: number;
  nome?: string;
}

/**
 * Circuit breaker leve (sem dependência). Envolve uma chamada externa (IA,
 * embeddings, Graph): depois de N falhas seguidas, "abre" e falha rápido por um
 * cooldown — em vez de martelar um serviço caído e derrubar a latência de todos.
 * Um sucesso no estado meio-aberto fecha de novo. Fail-fast é a proteção.
 */
export class CircuitBreaker {
  private readonly log = new Logger('CircuitBreaker');
  private readonly limiteFalhas: number;
  private readonly cooldownMs: number;
  private readonly nome: string;
  private estado: Estado = 'fechado';
  private falhas = 0;
  private abertoAte = 0;

  constructor(opts: CircuitOptions = {}) {
    this.limiteFalhas = opts.limiteFalhas ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.nome = opts.nome ?? 'circuito';
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.estado === 'aberto') {
      if (Date.now() < this.abertoAte) {
        throw new Error(`${this.nome} indisponível (circuito aberto) — tentando de novo em ${Math.ceil((this.abertoAte - Date.now()) / 1000)}s`);
      }
      this.estado = 'meio-aberto'; // deixa UMA tentativa passar
    }
    try {
      const r = await fn();
      this.aoSucesso();
      return r;
    } catch (e) {
      this.aoFalhar();
      throw e;
    }
  }

  private aoSucesso(): void {
    this.falhas = 0;
    if (this.estado !== 'fechado') {
      this.estado = 'fechado';
      this.log.log(`${this.nome}: circuito fechado (recuperado)`);
    }
  }

  private aoFalhar(): void {
    this.falhas++;
    if (this.falhas >= this.limiteFalhas && this.estado !== 'aberto') {
      this.estado = 'aberto';
      this.abertoAte = Date.now() + this.cooldownMs;
      this.log.warn(`${this.nome}: circuito ABERTO após ${this.falhas} falhas — fail-fast por ${this.cooldownMs / 1000}s`);
    }
  }
}
