import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrmService } from './crm.service';
import { MessagesService } from './messaging/messages.service';
import { TenantId } from '../auth/decorators';

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
class SendMessageDto {
  @IsString() @MaxLength(4000) texto!: string;
}

/** CRM Core. O tenant vem SEMPRE do JWT (@TenantId) — nunca de header do browser. */
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService, private readonly messages: MessagesService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return this.crm.overview(tenantId);
  }

  @Get('contacts')
  contacts(@TenantId() tenantId: string, @Query('q') q?: string) {
    return this.crm.listContacts(tenantId, q);
  }

  @Post('contacts')
  createContact(@TenantId() tenantId: string, @Body() dto: CreateContactDto) {
    return this.crm.createContact(tenantId, dto);
  }

  @Get('pipeline')
  pipeline(@TenantId() tenantId: string) {
    return this.crm.pipeline(tenantId);
  }

  @Post('deals')
  createDeal(@TenantId() tenantId: string, @Body() dto: CreateDealDto) {
    return this.crm.createDeal(tenantId, dto);
  }

  @Patch('deals/:id/stage')
  moveDeal(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: MoveDealDto) {
    return this.crm.moveDeal(tenantId, id, dto.stageId);
  }

  @Get('conversations')
  conversations(@TenantId() tenantId: string) {
    return this.crm.listConversations(tenantId);
  }

  @Post('conversations/:id/messages')
  sendMessage(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messages.send(tenantId, id, dto.texto);
  }
}
