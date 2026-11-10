import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { AgentStudioService } from './agent-studio.service';

class TestarWhatsAppDto {
  @IsUUID() contactId!: string;
}

class AssistentePromptDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsString() @MinLength(3) @MaxLength(60) foco!: string;
  @IsString() @MinLength(10) @MaxLength(2000) descricao!: string;
  @IsOptional() @IsString() @MaxLength(8000) instrucoesAtuais?: string;
}

class AnalisarPromptDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(60) foco?: string;
  @IsString() @MinLength(10) @MaxLength(8000) instrucoes!: string;
  @IsOptional() @IsString() @MaxLength(40) tom?: string;
  @IsOptional() @IsIn([true, false]) conhecimentoAtivo?: boolean;
}

/**
 * Studio do agente (cockpit "ver funcionando na prática"). Rotas FIXAS antes
 * das `:id` — o controller é registrado antes do AgentsController no módulo
 * pela mesma razão.
 */
@Controller('agents')
export class AgentStudioController {
  constructor(private readonly studio: AgentStudioService) {}

  @Post('studio/assistente-prompt')
  assistentePrompt(@TenantId() tenantId: string, @Body() dto: AssistentePromptDto) {
    return this.studio.assistenteDePrompt(tenantId, dto);
  }

  @Post('studio/analisar')
  analisar(@TenantId() tenantId: string, @Body() dto: AnalisarPromptDto) {
    return this.studio.analisarPrompt(tenantId, dto);
  }

  @Get(':id/studio/conversas')
  conversas(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.conversasDoAgente(tenantId, id);
  }

  @Post(':id/studio/analisar')
  analisarAgente(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.studio.analisarAgente(tenantId, id);
  }

  @Get(':id/studio/atividade')
  atividade(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query('limite') limite?: string) {
    const n = Math.min(Math.max(Number(limite) || 15, 1), 50);
    return this.studio.atividadeDoAgente(tenantId, id, n);
  }

  @Post(':id/studio/testar-whatsapp')
  testarWhatsApp(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestarWhatsAppDto) {
    return this.studio.testarNoWhatsapp(tenantId, id, dto.contactId, user.identityId);
  }
}
