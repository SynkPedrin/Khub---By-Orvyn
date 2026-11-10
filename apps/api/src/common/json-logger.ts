import { ConsoleLogger, LoggerService } from '@nestjs/common';
import { correlationId } from './request-context';

/**
 * Logger de produção: uma linha JSON por evento (level, time, context, msg,
 * correlationId) — legível por Loki/CloudWatch/Datadog. Em dev, use o
 * ConsoleLogger colorido. Nunca loga valores de segredo (só nomes de var).
 */
export class JsonLogger implements LoggerService {
  private emit(level: string, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    const line = {
      time: new Date().toISOString(),
      level,
      context: context ?? undefined,
      correlationId: correlationId(),
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      ...extra,
    };
    const out = JSON.stringify(line);
    if (level === 'error') process.stderr.write(out + '\n');
    else process.stdout.write(out + '\n');
  }

  log(message: unknown, context?: string): void { this.emit('info', message, context); }
  error(message: unknown, stackOrContext?: string, context?: string): void {
    this.emit('error', message, context ?? stackOrContext, stackOrContext && context ? { stack: stackOrContext } : undefined);
  }
  warn(message: unknown, context?: string): void { this.emit('warn', message, context); }
  debug(message: unknown, context?: string): void { this.emit('debug', message, context); }
  verbose(message: unknown, context?: string): void { this.emit('verbose', message, context); }
}

/** Escolhe o logger pelo ambiente/flag. */
export function makeLogger(format: 'json' | 'pretty' | undefined, nodeEnv: string): LoggerService {
  const fmt = format ?? (nodeEnv === 'production' ? 'json' : 'pretty');
  return fmt === 'json' ? new JsonLogger() : new ConsoleLogger();
}
