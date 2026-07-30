import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { runWithContext } from './request-context';

/**
 * Abre um contexto por requisição com o correlation-id (reaproveita o header de
 * entrada ou gera um) e o devolve no header da resposta. Tudo o que roda dentro
 * do request — logs, filtro de erro — enxerga o mesmo id, amarrando a trilha.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string | undefined)?.trim() || randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    runWithContext({ correlationId }, () => next());
  }
}
