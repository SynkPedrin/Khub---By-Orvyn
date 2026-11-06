import { BadRequestException, Body, Controller, ForbiddenException, Headers, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrmService } from './crm.service';
import { MessagesService } from './messaging/messages.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { AtendimentoService } from './messaging/atendimento.service';
import { SkipAudit } from '../common/audit.interceptor';

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
class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(160) empresa?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsNumber() @Min(0) valorEstimado?: number;
  @IsOptional() @IsUUID() companyId?: string;
}
class ConsentimentoDto {
  @IsIn(['consentimento', 'execucao_contrato', 'obrigacao_legal', 'legitimo_interesse', 'protecao_credito']) baseLegal!: string;
  @IsOptional() @IsString() @MaxLength(200) origem?: string;
}
class UpdateDealDto {
  @IsOptional() @IsString() @MaxLength(200) titulo?: string;
  @IsOptional() @IsNumber() @Min(0) valor?: number;
  @IsOptional() @IsString() @MaxLength(80) origem?: string;
  @IsOptional() @IsIn(['aberto', 'ganho', 'perdido']) status?: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @IsUUID() contactId?: string;
}
class SendMessageDto {
  @IsString() @MaxLength(4000) texto!: string;
}
class AtendimentoDto {
  @IsIn(['assumir', 'devolver_ia', 'atribuir']) acao!: 'assumir' | 'devolver_ia' | 'atribuir';
  @IsOptional() @IsUUID() agentId?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
}

/** CRM Core. O tenant vem SEMPRE do JWT (@TenantId) — nunca de header do browser. */
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService, private readonly messages: MessagesService, private readonly atendimento: AtendimentoService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return this.crm.overview(tenantId);
  }

  /** Lista paginada por cursor: `{ items, nextCursor }` (D1). */
  @Get('contacts')
  contacts(@TenantId() tenantId: string, @Query('q') q?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.crm.listContacts(tenantId, { q, cursor, limit: limit ? Number(limit) : undefined });
  }

  /** Perfil 360 do contato. */
  @Get('contacts/:id')
  contact(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getContact(tenantId, id);
  }

  @Patch('contacts/:id')
  updateContact(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.crm.updateContact(tenantId, id, dto);
  }

  @Delete('contacts/:id')
  deleteContact(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteContact(tenantId, id);
  }

  /** LGPD (RegrasNegocio §5) — serviço já grava o audit log detalhado com o valor registrado. */
  @SkipAudit()
  @Post('contacts/:id/consentimento')
  registrarConsentimento(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsentimentoDto) {
    return this.crm.registrarConsentimento(tenantId, id, dto);
  }

  /** LGPD — direito de acesso/portabilidade. Export, não mutação: sem audit genérico. */
  @SkipAudit()
  @Get('contacts/:id/export')
  exportContact(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.exportarDadosContato(tenantId, id);
  }

  /** Busca global (Cmd+K): contatos + negócios + conversas do tenant da sessão. */
  @Get('search')
  search(@TenantId() tenantId: string, @Query('q') q?: string) {
    return this.crm.search(tenantId, q ?? '');
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
  moveDeal(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDealDto) {
    return this.crm.moveDeal(tenantId, id, dto.stageId);
  }

  @Get('deals/:id')
  deal(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getDeal(tenantId, id);
  }

  @Patch('deals/:id')
  updateDeal(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.crm.updateDeal(tenantId, id, dto);
  }

  @Delete('deals/:id')
  deleteDeal(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.deleteDeal(tenantId, id);
  }

  @Get('conversations')
  conversations(@TenantId() tenantId: string) {
    return this.crm.listConversations(tenantId);
  }

  /** MessagesService já audita o envio com o id da mensagem — sem linha genérica. */
  @SkipAudit()
  @Post('conversations/:id/messages')
  sendMessage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Headers('idempotency-key') key?: string) {
    if (!key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new BadRequestException('Idempotency-Key obrigatório (16–128 caracteres)');
    // identityId = humano digitando no Inbox: se a conversa estava com a IA, ele assume.
    return this.messages.send(user.tenantId, id, dto.texto, key, undefined, { tipo: 'humano', identityId: user.identityId });
  }

  /** Atendimento da conversa (RV-06.2): assumir, devolver para a IA ou atribuir. */
  @SkipAudit()
  @Patch('conversations/:id/atendimento')
  mudarAtendimento(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtendimentoDto) {
    if (user.role === 'viewer') throw new ForbiddenException('perfil somente leitura');
    if (dto.acao === 'assumir') return this.atendimento.assumir(user.tenantId, id, user.identityId);
    if (dto.acao === 'devolver_ia') return this.atendimento.devolverParaIa(user.tenantId, id, user.identityId, dto.agentId);
    if (!dto.assigneeId) throw new BadRequestException('assigneeId obrigatório para atribuir');
    return this.atendimento.atribuir(user.tenantId, id, dto.assigneeId, user.identityId);
  }

  /** Atendentes da conta com a carga atual (seletor de responsável). */
  @Get('atendentes')
  atendentes(@TenantId() tenantId: string) {
    return this.atendimento.atendentes(tenantId);
  }
}
