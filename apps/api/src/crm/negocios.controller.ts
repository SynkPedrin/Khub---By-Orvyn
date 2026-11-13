import { Body, Controller, ForbiddenException, HttpCode, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { hasPermission } from '../auth/permissions.guard';
import { SkipAudit } from '../common/audit.interceptor';
import { ACOES_MASSA_NEGOCIOS, LIMITE_MASSA_NEGOCIOS, NegociosMassaService, type AcaoMassaNegocios } from './negocios-massa.service';

class BulkNegociosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(LIMITE_MASSA_NEGOCIOS) @IsUUID('all', { each: true }) ids!: string[];
  @IsIn(ACOES_MASSA_NEGOCIOS as unknown as string[]) acao!: AcaoMassaNegocios;
  /** etapa `{stageId}` · dono `{ownerId|null}` · perdido `{motivoPerdaId?, motivoPerdaObs?}` · ganho/excluir `{}`. */
  @IsOptional() @IsObject() params?: Record<string, unknown>;
}

/**
 * Ações em massa de negócios (Q2.1, visão Lista do Pipeline). Permissão base
 * `pipeline.write` (PermissionsGuard: rota `deals/...`). Excluir em massa
 * apaga registros: exige `pipeline.configure` (manager+), como a estrutura do funil.
 */
@Controller('crm')
export class NegociosController {
  constructor(private readonly massa: NegociosMassaService) {}

  /** O serviço grava UMA auditoria rica (`deals.bulk.<acao>` com os ids). */
  @SkipAudit()
  @Post('deals/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkNegociosDto) {
    if (dto.acao === 'excluir' && !hasPermission(u, 'pipeline.configure')) throw new ForbiddenException('excluir em massa exige perfil gerente ou superior');
    return this.massa.executar(u.tenantId, u.identityId, { ids: dto.ids, acao: dto.acao, params: dto.params });
  }
}
