import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TenantId } from '../auth/decorators';
import { CustomFieldsService } from './custom-fields.service';
import { ENTIDADES_CAMPO, TIPOS_CAMPO, ehEntidade, type EntidadeCampo, type TipoCampo } from './custom-fields';

class CriarCampoDto {
  @IsIn(ENTIDADES_CAMPO as unknown as string[]) entidade!: EntidadeCampo;
  @IsString() @MinLength(1) @MaxLength(80) rotulo!: string;
  @IsIn(TIPOS_CAMPO as unknown as string[]) tipo!: TipoCampo;
  @IsOptional() @IsString() @MaxLength(50) chave?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) opcoes?: string[];
  @IsOptional() @IsBoolean() obrigatorio?: boolean;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string | null;
}
class AtualizarCampoDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) rotulo?: string;
  @IsOptional() @IsIn(TIPOS_CAMPO as unknown as string[]) tipo?: TipoCampo;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) opcoes?: string[];
  @IsOptional() @IsBoolean() obrigatorio?: boolean;
  @IsOptional() @IsString() @MaxLength(60) grupo?: string | null;
  /** Atalho: `arquivado: true|false` no PATCH equivale às rotas de arquivar/restaurar. */
  @IsOptional() @IsBoolean() arquivado?: boolean;
}
class ReordenarDto {
  @IsIn(ENTIDADES_CAMPO as unknown as string[]) entidade!: EntidadeCampo;
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[];
}

function entidadeDaQuery(v: string | undefined): EntidadeCampo {
  const e = v ?? 'contact';
  if (!ehEntidade(e)) throw new BadRequestException('entidade inválida: use contact, deal ou company');
  return e;
}

/**
 * Definições de campos personalizados (Q2.3). Rotas em `crm/custom-fields`:
 * leitura para quem lê o CRM; escrita só owner/admin (PermissionsGuard mapeia
 * `custom-fields` + método de escrita → `organization.manage`).
 */
@Controller('crm')
export class CustomFieldsController {
  constructor(private readonly campos: CustomFieldsService) {}

  @Get('custom-fields')
  list(@TenantId() t: string, @Query('entidade') entidade?: string, @Query('arquivados') arquivados?: string) {
    return this.campos.list(t, entidadeDaQuery(entidade), arquivados !== 'false');
  }

  @Post('custom-fields')
  create(@TenantId() t: string, @Body() dto: CriarCampoDto) {
    return this.campos.create(t, dto);
  }

  @Post('custom-fields/reordenar')
  @HttpCode(200)
  reordenar(@TenantId() t: string, @Body() dto: ReordenarDto) {
    return this.campos.reordenar(t, dto.entidade, dto.ids);
  }

  @Patch('custom-fields/:id')
  async update(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCampoDto) {
    const { arquivado, ...resto } = dto;
    const temEdicao = Object.values(resto).some((v) => v !== undefined);
    let r = temEdicao || arquivado === undefined ? await this.campos.update(t, id, resto) : null;
    if (arquivado !== undefined) r = await this.campos.arquivar(t, id, arquivado);
    return r;
  }

  @Post('custom-fields/:id/arquivar')
  @HttpCode(200)
  arquivar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.campos.arquivar(t, id, true);
  }

  @Post('custom-fields/:id/restaurar')
  @HttpCode(200)
  restaurar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.campos.arquivar(t, id, false);
  }

  @Delete('custom-fields/:id')
  remove(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.campos.remove(t, id);
  }
}
