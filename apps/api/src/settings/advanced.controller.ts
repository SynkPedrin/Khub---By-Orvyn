import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { TagsService } from './tags.service';
import { ApiKeysService } from './api-keys.service';

class CreateTagDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(160) descricao?: string;
}
class UpdateTagDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(160) descricao?: string;
}
class CreateKeyDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayUnique()
  @IsIn(['contacts.read','contacts.write','pipeline.read','pipeline.write','conversations.read','conversations.reply','automations.read','automations.write','integrations.manage'], { each: true })
  scopes?: string[];
}

/** Configurações avançadas: tags do CRM e Private Integrations (API keys).
 *  Cada serviço grava seu próprio audit log → a classe dispensa o interceptor. */
@SkipAudit()
@Controller('settings')
export class AdvancedSettingsController {
  constructor(
    private readonly tags: TagsService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  // ---- Tags ----
  @Get('tags')
  listTags(@TenantId() t: string) {
    return this.tags.listar(t);
  }
  @Post('tags')
  createTag(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CreateTagDto) {
    return this.tags.criar(t, u.identityId, dto);
  }
  @Patch('tags/:id')
  updateTag(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.atualizar(t, u.identityId, id, dto);
  }
  @Delete('tags/:id')
  @HttpCode(200)
  deleteTag(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.tags.remover(t, u.identityId, id);
  }

  // ---- Private Integrations (API keys) ----
  @Get('api-keys')
  listKeys(@TenantId() t: string) {
    return this.apiKeys.listar(t);
  }
  @Post('api-keys')
  createKey(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CreateKeyDto) {
    return this.apiKeys.criar(t, u.identityId, dto.name, dto.scopes);
  }
  @Delete('api-keys/:id')
  @HttpCode(200)
  revokeKey(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.apiKeys.revogar(t, u.identityId, id);
  }
}
