import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TenantId } from '../auth/decorators';
import { LostReasonsService, MAX_MOTIVOS } from './lost-reasons.service';

class CriarMotivoDto {
  @IsString() @MaxLength(60) nome!: string;
}
class AtualizarMotivoDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class OrdemMotivosDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_MOTIVOS) @IsUUID('all', { each: true }) ids!: string[];
}

/**
 * Motivos de perda (Q2.1) em `crm/lost-reasons`. Leitura: `pipeline.read`;
 * escrita: `pipeline.configure` (PermissionsGuard). A primeira leitura semeia
 * os motivos padrão do tenant.
 */
@Controller('crm')
export class LostReasonsController {
  constructor(private readonly motivos: LostReasonsService) {}

  @Get('lost-reasons')
  listar(@TenantId() t: string, @Query('ativos') ativos?: string) {
    return this.motivos.listar(t, ativos === 'true');
  }

  @Post('lost-reasons')
  criar(@TenantId() t: string, @Body() dto: CriarMotivoDto) {
    return this.motivos.criar(t, dto);
  }

  @Post('lost-reasons/ordem')
  @HttpCode(200)
  reordenar(@TenantId() t: string, @Body() dto: OrdemMotivosDto) {
    return this.motivos.reordenar(t, dto.ids);
  }

  @Patch('lost-reasons/:id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarMotivoDto) {
    return this.motivos.atualizar(t, id, dto);
  }

  @Delete('lost-reasons/:id')
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.motivos.remover(t, id);
  }
}
