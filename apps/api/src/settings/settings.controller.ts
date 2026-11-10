import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { SettingsService } from './settings.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsOptional() @IsIn(['pt-BR','en-US','es-ES']) idioma?: string;
  @IsOptional() @IsObject() prefs?: Record<string, unknown>;
}
class UpdateBusinessDto {
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MaxLength(240) endereco?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(160) website?: string;
  @IsOptional() @IsIn(['pt-BR','en-US','es-ES']) idioma?: string;
  @IsOptional() @IsString() @MaxLength(40) nicho?: string;
}
class InviteDto {
  @IsEmail() email!: string;
  @IsOptional() @IsIn(['owner', 'admin', 'manager', 'member', 'viewer']) role?: string;
}
class RoleDto {
  @IsIn(['owner', 'admin', 'manager', 'member', 'viewer']) role!: string;
}

/** Cada método do SettingsService já grava seu próprio audit log (mais rico
 *  que o genérico do interceptor) — por isso a classe inteira o dispensa. */
@SkipAudit()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('profile')
  profile(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.settings.profile(t, u.identityId);
  }
  @Patch('profile')
  updateProfile(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.settings.updateProfile(t, u.identityId, dto);
  }

  @Get('business')
  business(@TenantId() t: string) {
    return this.settings.business(t);
  }
  @Patch('business')
  updateBusiness(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: UpdateBusinessDto) {
    return this.settings.updateBusiness(t, u.identityId, dto);
  }

  @Get('email-status')
  emailStatus() { return this.settings.emailStatus(); }

  @Get('members')
  members(@TenantId() t: string) {
    return this.settings.members(t);
  }
  @Post('invites')
  invite(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: InviteDto) {
    return this.settings.createInvite(t, u.identityId, dto.email, dto.role ?? 'member');
  }
  @Delete('invites/:id')
  revoke(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.settings.revokeInvite(t, u.identityId, id);
  }
  @Patch('members/:identityId/role')
  role(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('identityId') target: string, @Body() dto: RoleDto) {
    return this.settings.changeRole(t, u.identityId, target, dto.role);
  }

  /** Remove o membro: acesso cai na hora e as sessões do tenant são revogadas (SEC-01). */
  @Delete('members/:identityId')
  removeMember(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('identityId', ParseUUIDPipe) target: string) {
    return this.settings.removeMember(t, u.identityId, target);
  }
  /** Sair de todos os dispositivos (revoga todas as sessões da identidade). */
  @Post('sessions/revoke-all')
  @HttpCode(200)
  revokeSessions(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.settings.revokeMySessions(t, u.identityId);
  }

  @Get('audit')
  audit(@TenantId() t: string, @Query('limit') limit?: string) {
    return this.settings.auditLogs(t, Number(limit) || 100);
  }

  /** Sino: derivado do estado real (não lidas + integrações quebradas). */
  @Get('notifications')
  notifications(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.settings.notifications(t, u.identityId);
  }
  @Post('notifications/read')
  @HttpCode(200)
  readNotifications(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.settings.markNotificationsRead(t, u.identityId);
  }
}
