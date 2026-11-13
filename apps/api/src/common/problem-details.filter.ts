import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@khub/types';
import { correlationId as currentCorrelationId } from './request-context';
import { ErrorReporter } from './error-reporter.service';
import { urlSegura } from './url-segura';

/** Erros padronizados RFC 7807 + correlation-id (APIs.md §4). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  // Sem DI (instanciado com `new` no main.ts); o reporter não tem dependências.
  private readonly reporter = new ErrorReporter();

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const title = isHttp ? exception.message : 'Erro interno';
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? currentCorrelationId();

    if (status >= 500) {
      // Estruturado + correlation-id, e pronto para o Sentry (SENTRY_DSN).
      // URL redigida: rotas de webhook carregam o segredo no path/query (doc 18).
      this.reporter.capture(exception, { method: req.method, url: urlSegura(req.url), status });
    }

    const body: ProblemDetails & Record<string, unknown> = {
      type: `urn:khub:error:${status}`,
      title,
      status,
      instance: urlSegura(req.url),
      correlationId,
    };

    // RFC 7807 permite **campos de extensão**: o que o serviço colocou no corpo
    // da exceção (ex.: `problemas` da validação de workflow, `missing` do gating)
    // viaja junto. Sem isto, a UI recebe "Bad Request Exception" pelado e não tem
    // como dizer ao usuário O QUE corrigir.
    if (isHttp) {
      const payload = exception.getResponse();
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        for (const [k, v] of Object.entries(p)) {
          // `statusCode`/`error` são ruído do Nest; `status` é reservado pela RFC
          // para o código HTTP numérico e não pode ser sobrescrito.
          if (k === 'statusCode' || k === 'error' || k === 'status') continue;
          if (k === 'message') {
            if (Array.isArray(v)) body.errors = v; // erros do class-validator
            else if (typeof v === 'string') body.title = v;
            continue;
          }
          body[k] = v;
        }
        // Gating por credencial (Brief §2 / ADR-0008): o marcador vem como
        // `status:'config_required'` na exceção e vai para `code` na resposta.
        if (p.status === 'config_required') body.code = 'config_required';
      }
    }
    res.setHeader('x-correlation-id', correlationId);
    res.status(status).type('application/problem+json').send(body);
  }
}
