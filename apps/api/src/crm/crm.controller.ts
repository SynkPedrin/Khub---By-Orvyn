import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrmService } from './crm.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CreateContactDto {
  @IsString() @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(160) empresa?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsNumber() @Min(0) valorEstimado?: number;
}
class CreateDealDto {
  @IsString() @MaxLength(200) titulo!: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsUUID() stageId!: string;
  @IsOptional() @IsNumber() @Min(0) valor?: number;
  @IsOptional() @IsString() @MaxLength(80) origem?: string;
}
class MoveDealDto {
  @IsUUID() stageId!: string;
}

/**
 * CRM Core. `x-tenant-id` é a ponte de DEV (o front proxya com o tenant da
 * sessão). Em produção vem do JWT do módulo `auth` (F0-11). Todo acesso passa
 * por CrmService -> withTenant -> RLS.
 */
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  private tenant(id: string | undefined): string {
    if (!id || !UUID_RE.test(id)) throw new BadRequestException('x-tenant-id (UUID) obrigatório');
    return id;
  }

  @Get('overview')
  overview(@Headers('x-tenant-id') t?: string) {
    return this.crm.overview(this.tenant(t));
  }

  @Get('contacts')
  contacts(@Headers('x-tenant-id') t?: string, @Query('q') q?: string) {
    return this.crm.listContacts(this.tenant(t), q);
  }

  @Post('contacts')
  createContact(@Headers('x-tenant-id') t: string | undefined, @Body() dto: CreateContactDto) {
    return this.crm.createContact(this.tenant(t), dto);
  }

  @Get('pipeline')
  pipeline(@Headers('x-tenant-id') t?: string) {
    return this.crm.pipeline(this.tenant(t));
  }

  @Post('deals')
  createDeal(@Headers('x-tenant-id') t: string | undefined, @Body() dto: CreateDealDto) {
    return this.crm.createDeal(this.tenant(t), dto);
  }

  @Patch('deals/:id/stage')
  moveDeal(@Headers('x-tenant-id') t: string | undefined, @Param('id') id: string, @Body() dto: MoveDealDto) {
    return this.crm.moveDeal(this.tenant(t), id, dto.stageId);
  }

  @Get('conversations')
  conversations(@Headers('x-tenant-id') t?: string) {
    return this.crm.listConversations(this.tenant(t));
  }
}
