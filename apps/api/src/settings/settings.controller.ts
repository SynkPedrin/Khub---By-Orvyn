import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { MODULOS } from '../auth/modulos';
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
  /** Personalização (ADR-0042): nome de quem recebe, recado e WhatsApp dele. */
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(600) mensagem?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  /** Acesso por módulo (ADR-0045). Ausente = sem restrição. Ignorado para owner/admin. */
  @IsOptional() @IsArray() @ArrayMaxSize(MODULOS.length) @IsIn([...MODULOS], { each: true }) modulos?: string[];
}
class ModulosDto {
  /** `null` tira a restrição (vê tudo o que o papel permite). */
  @ValidateIf((_o, v) => v !== null) @IsArray() @ArrayMaxSize(MODULOS.length) @IsIn([...MODULOS], { each: true }) modulos!: string[] | null;
}
class ResendInviteDto {
  @IsOptional() @IsString() @MaxLength(120) nome?: string;
  @IsOptional() @IsString() @MaxLength(600) mensagem?: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
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
    return this.settings.createInvite(t, u.identityId, dto.email, dto.role ?? 'member', { nome: dto.nome, mensagem: dto.mensagem, telefone: dto.telefone, modulos: dto.modulos });
  }
  /** Novo link (o anterior deixa de valer) + reenvio do e-mail + texto de WhatsApp. */
  @Post('invites/:id/resend')
  @HttpCode(200)
  resendInvite(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResendInviteDto) {
    return this.settings.resendInvite(t, u.identityId, id, dto);
  }
  @Delete('invites/:id')
  revoke(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.settings.revokeInvite(t, u.identityId, id);
  }
  /** Acesso por módulo de um membro (ADR-0045): vale na próxima requisição dele. */
  @Patch('members/:identityId/modulos')
  modulos(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('identityId', ParseUUIDPipe) target: string, @Body() dto: ModulosDto) {
    return this.settings.changeModulos(t, u.identityId, target, dto.modulos);
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
  /** Ler uma notificação não é ação de negócio — sem linha de auditoria. */
  @SkipAudit()
  @Post('notifications/:id/read')
  @HttpCode(200)
  readNotification(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.settings.markNotificationRead(t, u.identityId, id);
  }
}
