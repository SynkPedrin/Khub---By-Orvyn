import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { IsEmail, IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../../auth/decorators';
import { AvecAgendaService } from './avec-agenda.service';

class ConectarAvecDto {
  @IsEmail() @MaxLength(200) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) senha!: string;
  /** Usuário do Cognito do Avec (UUID do SSO da conta). */
  @Matches(/^[0-9a-f-]{36}$/i) ssoId!: string;
  @IsInt() @Min(1) salaoId!: number;
  @Matches(/^[a-z0-9-]{2,80}$/i) slug!: string;
}

/** Avec (agenda do salão) — ADR-0052. Senha só entra; nunca volta na resposta. */
@Controller('integrations/avec')
export class AvecController {
  constructor(private readonly avec: AvecAgendaService) {}

  @Get()
  estado(@TenantId() tenantId: string) {
    return this.avec.estado(tenantId);
  }

  @Put()
  conectar(@TenantId() tenantId: string, @CurrentUser() u: AuthUser, @Body() dto: ConectarAvecDto) {
    return this.avec.conectar(tenantId, { identityId: u.identityId, role: u.role }, dto);
  }

  /** Sincroniza agora (hoje + 60 dias) e devolve o resumo. */
  @Post('sincronizar')
  @HttpCode(200)
  async sincronizar(@TenantId() tenantId: string) {
    return (await this.avec.sincronizarJanela(tenantId)) ?? { conectado: false };
  }
}
