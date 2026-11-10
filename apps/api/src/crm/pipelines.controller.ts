import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { TenantId } from '../auth/decorators';
import { PipelinesService } from './pipelines.service';

class CriarFunilDto {
  @IsString() @MaxLength(80) nome!: string;
  @IsOptional() @IsString() @MaxLength(40) tipo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true }) etapas?: string[];
}
class AtualizarFunilDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(40) tipo?: string;
}
class CriarEtapaDto {
  @IsString() @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(7) cor?: string;
  @IsOptional() @IsInt() @Min(0) posicao?: number;
}
class AtualizarEtapaDto {
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  @IsOptional() @IsString() @MaxLength(7) cor?: string;
}
class OrdemDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('4', { each: true }) ids!: string[];
}

/**
 * Estrutura do funil (ADR-0042). Escrita exige `pipeline.configure`
 * (owner/admin/manager) — mover negócio entre etapas continua `pipeline.write`.
 */
@Controller('crm')
export class PipelinesController {
  constructor(private readonly funis: PipelinesService) {}

  @Get('pipelines')
  listar(@TenantId() t: string) {
    return this.funis.listar(t);
  }

  @Post('pipelines')
  criar(@TenantId() t: string, @Body() dto: CriarFunilDto) {
    return this.funis.criarFunil(t, dto);
  }

  @Patch('pipelines/:id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarFunilDto) {
    return this.funis.renomearFunil(t, id, dto);
  }

  /** `?moverPara=<stageId de outro funil>` obrigatório se o funil tiver negócios. */
  @Delete('pipelines/:id')
  apagar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('moverPara') moverPara?: string) {
    return this.funis.apagarFunil(t, id, uuidOuNada(moverPara));
  }

  @Post('pipelines/:id/stages')
  criarEtapa(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CriarEtapaDto) {
    return this.funis.criarEtapa(t, id, dto);
  }

  @Post('pipelines/:id/stages/order')
  @HttpCode(200)
  reordenar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrdemDto) {
    return this.funis.reordenar(t, id, dto.ids);
  }

  @Patch('stages/:id')
  atualizarEtapa(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarEtapaDto) {
    return this.funis.atualizarEtapa(t, id, dto);
  }

  /** `?moverPara=<stageId do mesmo funil>` obrigatório se a etapa tiver negócios. */
  @Delete('stages/:id')
  apagarEtapa(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('moverPara') moverPara?: string) {
    return this.funis.apagarEtapa(t, id, uuidOuNada(moverPara));
  }
}

function uuidOuNada(v?: string): string | undefined {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : undefined;
}
