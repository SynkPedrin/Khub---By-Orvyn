import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { BlueprintService } from './blueprint.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';

@Controller('blueprints')
export class BlueprintController {
  constructor(private readonly blueprints: BlueprintService) {}

  @Get()
  listar() {
    return this.blueprints.listar();
  }

  /** Sugestão pelo nicho do tenant (para o onboarding). */
  @Get('sugerido')
  sugerido(@TenantId() t: string) {
    return this.blueprints.sugerir(t);
  }

  @Get(':key')
  obter(@Param('key') key: string) {
    return this.blueprints.obter(key);
  }

  /** Provisiona o CRM do tenant a partir do blueprint. */
  @Post(':key/aplicar')
  @HttpCode(200)
  aplicar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('key') key: string) {
    return this.blueprints.aplicar(t, u.identityId, key);
  }
}
