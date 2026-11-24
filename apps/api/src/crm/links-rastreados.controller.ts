import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { FONTES_LINK } from './links-rastreados';
import { LinksRastreadosService } from './links-rastreados.service';

class CriarLinkDto {
  @IsString() @MaxLength(160) campanha!: string;
  @IsIn([...FONTES_LINK]) fonte!: string;
  @IsString() @MaxLength(400) textoInicial!: string;
  @IsOptional() @IsString() @MaxLength(60) codigo?: string;
  @IsOptional() @IsString() @MaxLength(160) conjunto?: string | null;
  @IsOptional() @IsString() @MaxLength(160) criativo?: string | null;
}

class AtualizarLinkDto {
  @IsOptional() @IsString() @MaxLength(160) campanha?: string;
  @IsOptional() @IsIn([...FONTES_LINK]) fonte?: string;
  @IsOptional() @IsString() @MaxLength(400) textoInicial?: string;
  @IsOptional() @IsString() @MaxLength(160) conjunto?: string | null;
  @IsOptional() @IsString() @MaxLength(160) criativo?: string | null;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/**
 * Links rastreados de WhatsApp por campanha (db/080) em
 * `crm/links-rastreados`. Permissão padrão do módulo (leitura contacts.read,
 * escrita contacts.write); auditoria pelo AuditInterceptor — como os motivos
 * de perda (Q2.1), o serviço não duplica a linha.
 */
@Controller('crm/links-rastreados')
export class LinksRastreadosController {
  constructor(private readonly links: LinksRastreadosService) {}

  @Get()
  listar(@TenantId() t: string) {
    return this.links.listar(t);
  }

  @Post()
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarLinkDto) {
    return this.links.criar(t, dto, u.identityId);
  }

  @Patch(':id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarLinkDto) {
    return this.links.atualizar(t, id, dto);
  }

  @Delete(':id')
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.links.remover(t, id);
  }
}
