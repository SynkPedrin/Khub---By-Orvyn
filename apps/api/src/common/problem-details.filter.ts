import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@orvyn/types';

/** Erros padronizados RFC 7807 + correlation-id (APIs.md §4). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const title = isHttp ? exception.message : 'Erro interno';
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? cryptoRandom();

    if (status >= 500) {
      this.log.error(`${req.method} ${req.url} -> ${status}: ${String(exception)}`);
    }

    const body: ProblemDetails = {
      type: `https://orvyn.dev/errors/${status}`,
      title,
      status,
      instance: req.url,
      correlationId,
    };
    res.setHeader('x-correlation-id', correlationId);
    res.status(status).type('application/problem+json').send(body);
  }
}

function cryptoRandom(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:crypto').randomUUID();
}
