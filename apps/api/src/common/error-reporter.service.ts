import { Injectable, Logger } from '@nestjs/common';
import { correlationId } from './request-context';

/**
 * Seam de observabilidade de erros. Hoje registra o erro com correlation-id de
 * forma estruturada; quando `SENTRY_DSN` estiver setado e o pacote `@sentry/node`
 * instalado, é AQUI (e só aqui) que o `Sentry.captureException` entra — o resto
 * do código já chama `capture()` sem saber o destino. "Só falta plugar o DSN."
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
      `${err.name}: ${err.message}${this.dsn ? ' [sentry-ready]' : ''} · cid=${correlationId()}${contexto ? ' · ' + JSON.stringify(contexto) : ''}`,
      err.stack,
    );
    // Quando o pacote/DSN estiverem presentes:
    //   Sentry.captureException(err, { tags: { correlationId: correlationId() }, extra: contexto });
  }
}
