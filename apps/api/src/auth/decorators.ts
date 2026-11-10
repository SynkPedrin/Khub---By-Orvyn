import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marca uma rota como pública (sem JWT). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser {
  identityId: string;
  tenantId: string;
  role: string;
  email: string;
  scopes?: string[];
}

/** Injeta o usuário autenticado (setado pelo JwtAuthGuard a partir do JWT). */
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Injeta o tenant_id vindo do JWT (nunca de header do browser). */
export const TenantId = createParamDecorator((_d, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().user?.tenantId;
});
