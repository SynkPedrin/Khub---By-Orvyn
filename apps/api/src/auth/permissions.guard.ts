import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthUser, IS_PUBLIC } from './decorators';
import { moduloLiberado, modulosDaRota } from './modulos';

export function permissionFor(controller: string, route: string, method: string): string {
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (controller === 'auth') return 'profile.read';
  if (controller === 'settings') {
    if (/^(profile|notifications|sessions)/.test(route)) return 'profile.read';
    if (/^(members|invites)/.test(route)) return 'users.manage';
    if (/^(business|api-keys|integrations|audit|email-status)/.test(route)) return 'organization.manage';
  }
  if (controller.includes('integration') || controller.includes('ads')) return 'integrations.manage';
  if (controller === 'operations') return 'organization.manage';
  // Marcar/remarcar compromisso é operação de atendente, não configuração da
  // conta (ADR-0045). Antes caía no padrão `organization.manage` e o member
  // não conseguia agendar. Páginas de agendamento (booking-pages) seguem admin.
  if (controller === 'agenda') return read ? 'contacts.read' : 'agenda.write';
  // Página pessoal (CAL-PESSOAL): cada colaborador configura o próprio link —
  // o serviço impõe responsáveis = ele mesmo. As páginas da equipe seguem admin.
  if (controller === 'booking-pages' && route.startsWith('minha')) return read ? 'contacts.read' : 'agenda.write';
  if (controller === 'crm') {
    // Estrutura do funil (criar/renomear/apagar funil e etapa) é configuração,
    // não operação: manager+ (ADR-0042). Mover negócio segue `pipeline.write`.
    if (!read && /^(pipelines|stages)/.test(route)) return 'pipeline.configure';
    // Importação em massa mexe na base inteira: manager+.
    if (!read && route.startsWith('import')) return 'contacts.import';
    // Definições de campos personalizados mudam o formulário da conta inteira: só owner/admin (Q2.3).
    if (route.startsWith('custom-fields')) return read ? 'contacts.read' : 'organization.manage';
    // Motivos de perda (Q2.1) são configuração do funil: manager+ escreve, quem lê o pipeline lê.
    if (route.startsWith('lost-reasons')) return read ? 'pipeline.read' : 'pipeline.configure';
    const domain = /^(pipeline|stages|deals|proposals)/.test(route) ? 'pipeline' : route.startsWith('conversations') ? 'conversations' : 'contacts';
    return `${domain}.${read ? 'read' : domain === 'conversations' ? 'reply' : 'write'}`;
  }
  if (controller === 'automations' || controller === 'marketplace' || controller === 'blueprints') return `automations.${read ? 'read' : 'write'}`;
  if (controller === 'nyro') return read ? 'contacts.read' : 'automations.write';
  // Disparo em massa (Q4.3): montar é de manager+; aprovar/rejeitar é de owner/admin (RegrasNegocio §2).
  if (controller === 'disparos') return read ? 'contacts.read' : /(^|\/)(aprovar|rejeitar)$/.test(route) ? 'organization.manage' : 'automations.write';
  // Avaliações (Q4.4): pedir avaliação é ação no contato; configurar é da conta.
  if (controller === 'avaliacoes') return read ? 'contacts.read' : route.startsWith('pedidos') ? 'contacts.write' : 'organization.manage';
  return read ? 'contacts.read' : 'organization.manage';
}

const member = new Set(['profile.read', 'contacts.read', 'contacts.write', 'pipeline.read', 'pipeline.write', 'conversations.read', 'conversations.reply', 'automations.read', 'agenda.write']);
export function hasPermission(user: AuthUser, permission: string): boolean {
  if (user.role === 'api') return !['users.manage', 'organization.manage'].includes(permission) && !!user.scopes?.some(s => s === '*' || s === permission);
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'manager') return member.has(permission) || ['automations.write', 'pipeline.configure', 'contacts.import'].includes(permission);
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
    if (!moduloLiberado(req.user.modulos, modulosDaRota(controller, route, req.method))) throw new ForbiddenException('você não tem acesso a este módulo');
    return true;
  }
}
