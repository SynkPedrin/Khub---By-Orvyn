import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { correlationId } from './request-context';

/**
 * Seam de observabilidade de erros. Sem `SENTRY_DSN`, só loga estruturado
 * (correlation-id junto). Com a chave, `Sentry.init()` já rodou no bootstrap
 * (main.ts) e esta classe também reporta pro Sentry — o resto do código
 * sempre chamou `capture()` sem saber o destino, então nenhum call site
 * precisou mudar pra ligar isto. "Só faltava plugar o DSN."
 */
@Injectable()
export class ErrorReporter {
  private readonly log = new Logger('ErrorReporter');
  private readonly dsn = process.env.SENTRY_DSN;

  get enabled(): boolean {
    return !!this.dsn;
  }

  capture(error: unknown, contexto?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Estruturado com correlation-id — a trilha some junta com o log da requisição.
    this.log.error(
      `${err.name}: ${err.message}${this.dsn ? ' [sentry]' : ''} · cid=${correlationId()}${contexto ? ' · ' + JSON.stringify(contexto) : ''}`,
      err.stack,
    );
    if (this.dsn) {
      Sentry.captureException(err, { tags: { correlationId: correlationId() }, extra: contexto });
    }
  }
}
