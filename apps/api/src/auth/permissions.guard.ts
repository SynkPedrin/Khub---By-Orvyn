import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthUser, IS_PUBLIC } from './decorators';

export function permissionFor(controller: string, route: string, method: string): string {
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (controller === 'auth') return 'profile.read';
  if (controller === 'settings') {
    if (/^(profile|notifications)/.test(route)) return 'profile.read';
    if (/^(members|invites)/.test(route)) return 'users.manage';
    if (/^(business|api-keys|integrations|audit|email-status)/.test(route)) return 'organization.manage';
  }
  if (controller.includes('integration') || controller.includes('ads')) return 'integrations.manage';
  if (controller === 'operations') return 'organization.manage';
  if (controller === 'crm') {
    const domain = /^(pipeline|stages|deals)/.test(route) ? 'pipeline' : route.startsWith('conversations') ? 'conversations' : 'contacts';
    return `${domain}.${read ? 'read' : domain === 'conversations' ? 'reply' : 'write'}`;
  }
  if (controller === 'automations' || controller === 'marketplace' || controller === 'blueprints') return `automations.${read ? 'read' : 'write'}`;
  if (controller === 'nyro') return read ? 'contacts.read' : 'automations.write';
  return read ? 'contacts.read' : 'organization.manage';
}

const member = new Set(['profile.read', 'contacts.read', 'contacts.write', 'pipeline.read', 'pipeline.write', 'conversations.read', 'conversations.reply', 'automations.read']);
export function hasPermission(user: AuthUser, permission: string): boolean {
  if (user.role === 'api') return !['users.manage', 'organization.manage'].includes(permission) && !!user.scopes?.some(s => s === '*' || s === permission);
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'manager') return member.has(permission) || permission === 'automations.write';
  if (user.role === 'member') return member.has(permission);
  if (user.role === 'viewer') return permission.endsWith('.read');
  return false;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http' || this.reflector.getAllAndOverride(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<{ method: string; user: AuthUser }>();
    const controller = this.reflector.get<string>(PATH_METADATA, ctx.getClass()) ?? '';
    const route = this.reflector.get<string>(PATH_METADATA, ctx.getHandler()) ?? '';
    if (!req.user || !hasPermission(req.user, permissionFor(controller, route, req.method))) throw new ForbiddenException('permissão insuficiente');
    return true;
  }
}
