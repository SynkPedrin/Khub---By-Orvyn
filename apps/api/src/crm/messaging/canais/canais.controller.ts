import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public, TenantId, type AuthUser } from '../../../auth/decorators';
import { SkipAudit } from '../../../common/audit.interceptor';
import { CanaisService } from './canais.service';

class CallbackDto {
  @IsString() @MinLength(1) @MaxLength(2048) code!: string;
  @IsString() @MinLength(1) @MaxLength(2048) state!: string;
}

/**
 * `/v1/integrations/canais`: canais conectados de Conversas (db/063). Prefixo
 * `integrations` → permissão `integrations.manage` (owner/admin), igual ao
 * WhatsApp. Tenant SEMPRE do JWT; o callback é público e o tenant vem do
 * `state` assinado.
 */
@Controller('integrations/canais')
export class CanaisController {
  constructor(private readonly canais: CanaisService) {}

  @Get()
  cartoes(@TenantId() tenantId: string) {
    return this.canais.cartoes(tenantId);
  }

  @Get(':provedor/auth-url')
  authUrl(@CurrentUser() user: AuthUser, @Param('provedor') provedor: string) {
    return this.canais.urlConexao(user.tenantId, user.identityId, provedor);
  }

  /** O serviço audita cada conta conectada (`canal.conectado`). */
  @Public()
  @SkipAudit()
  @Post(':provedor/callback')
  callback(@Param('provedor') provedor: string, @Body() dto: CallbackDto) {
    return this.canais.callback(provedor, dto.code, dto.state);
  }

  /** O serviço audita (`canal.desconectado`). */
  @SkipAudit()
  @Delete('conexoes/:id')
  desconectar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.canais.desconectar(user.tenantId, user.identityId, id);
  }

  @Post('conexoes/:id/sincronizar')
  sincronizar(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.canais.sincronizarYoutube(tenantId, id);
  }
}
