import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

export const SKIP_AUDIT = 'skipAudit';
/**
 * Marca rotas cujo SERVIÇO já grava um audit log mais rico (com o id e o nome
 * certos). Sem isso, a linha do interceptor viraria duplicata.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT, true);

const VERBO: Record<string, string> = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' };

/**
 * Rede de segurança de auditoria (S0-5): TODA mutação autenticada e bem-sucedida
 * vira uma linha em `audit_logs`, mesmo que o serviço esqueça de auditar.
 * Nunca derruba a request: falha de auditoria é logada, não propagada.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger('Audit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const metodo: string = req.method;

    const mutacao = metodo in VERBO;
    const pulaPorDecorator = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT, [ctx.getHandler(), ctx.getClass()]);
    const tenantId: string | undefined = req.user?.tenantId;
    // rota pública (sem tenant) não tem onde auditar — RLS exige o tenant
    if (!mutacao || pulaPorDecorator || !tenantId) return next.handle();

    const { acao, entidade } = this.nomear(req, metodo);
    const actorId: string | undefined = req.user?.identityId;

    return next.handle().pipe(
      tap((resposta) => {
        const entidadeId = req.params?.id ?? (resposta as { id?: string })?.id ?? null;
        void this.gravar(tenantId, actorId, acao, entidade, entidadeId);
      }),
    );
  }

  /** `/v1/crm/deals/:id/stage` + PATCH -> { entidade: 'deals', acao: 'deals.stage' } */
  private nomear(req: { route?: { path?: string }; path?: string }, metodo: string): { acao: string; entidade: string } {
    const path = req.route?.path ?? req.path ?? '';
    const segs = path.split('/').filter((s) => s && s !== 'v1' && !s.startsWith(':'));
    const entidade = segs[1] ?? segs[0] ?? 'desconhecido';
    const sufixo = segs.slice(2).join('.');
    return { entidade, acao: `${entidade}.${sufixo || VERBO[metodo]}` };
  }

  private async gravar(tenantId: string, actorId: string | undefined, acao: string, entidade: string, entidadeId: string | null): Promise<void> {
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${tenantId}::uuid, 'humano', ${actorId ?? null}, ${acao}, ${entidade}, ${entidadeId})`,
      );
    } catch (e) {
      this.log.warn(`falha ao auditar ${acao}: ${(e as Error).message}`);
    }
  }
}
