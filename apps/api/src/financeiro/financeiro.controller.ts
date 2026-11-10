import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { FinanceiroService } from './financeiro.service';

class CriarCobrancaDto {
  @IsString() @MaxLength(200) descricao!: string;
  @IsInt() @Min(0) valorCentavos!: number;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() dealId?: string;
  @IsOptional() @IsString() vencimento?: string;
  @IsOptional() @IsString() @MaxLength(3) moeda?: string;
  @IsOptional() enviar?: boolean;
}
class StatusDto {
  @IsIn(['enviada', 'paga', 'cancelada']) status!: 'enviada' | 'paga' | 'cancelada';
}

@SkipAudit()
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly financeiro: FinanceiroService) {}

  @Get('cobrancas')
  listar(@TenantId() t: string, @Query('status') status?: string) {
    return this.financeiro.listar(t, status ? { status } : undefined);
  }
  @Get('resumo')
  resumo(@TenantId() t: string) {
    return this.financeiro.resumo(t);
  }
  @Post('cobrancas')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarCobrancaDto) {
    return this.financeiro.criar(t, u.identityId, dto);
  }
  @Post('cobrancas/:id/status')
  status(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.financeiro.atualizarStatus(t, u.identityId, id, dto.status);
  }
  @Post('cobrancas/:id/link-pagamento')
  link(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.financeiro.gerarLinkPagamento(t, u.identityId, id);
  }
  @Delete('cobrancas/:id')
  @HttpCode(200)
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.financeiro.remover(t, u.identityId, id);
  }
}
