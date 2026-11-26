import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { PushService } from './push.service';

class ChavesDto {
  @IsString() @MaxLength(300) p256dh!: string;
  @IsString() @MaxLength(100) auth!: string;
}
class InscreverDto {
  @IsString() @MaxLength(2000) @Matches(/^https:\/\//) endpoint!: string;
  @ValidateNested() @Type(() => ChavesDto) keys!: ChavesDto;
}
class CancelarDto {
  @IsString() @MaxLength(2000) endpoint!: string;
}

/** Notificações no celular (PWA). Cada pessoa gerencia só os próprios aparelhos. */
@SkipAudit()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  async config(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return { ligado: this.push.ligado(), chavePublica: this.push.chavePublica(), aparelhos: this.push.ligado() ? await this.push.quantosAparelhos(t, u.identityId) : 0 };
  }

  @Post('inscrever')
  @HttpCode(200)
  async inscrever(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: InscreverDto, @Headers('user-agent') ua?: string) {
    await this.push.inscrever(t, u.identityId, b, ua);
    return { ok: true };
  }

  @Post('cancelar')
  @HttpCode(200)
  async cancelar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: CancelarDto) {
    await this.push.cancelar(t, u.identityId, b.endpoint);
    return { ok: true };
  }

  /** Manda um aviso de teste só para os aparelhos de quem pediu. */
  @Post('teste')
  @HttpCode(200)
  async teste(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    const enviados = await this.push.enviar(t, [u.identityId], { titulo: 'KHUB', corpo: 'Notificações ativadas. Você será avisada quando houver algo para aprovar.', url: '/m', tag: 'teste' });
    return { enviados };
  }
}
