import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgentsService } from './agents.service';

/** Valores aceitos no formato; a allowlist (modelo, ferramentas…) é do serviço. */
class AgenteDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) nome?: string;
  @IsOptional() @IsString() @MaxLength(300) descricao?: string;
  @IsOptional() @IsString() @MaxLength(80) modelo?: string;
  @IsOptional() @IsString() @MaxLength(8000) instrucoes?: string;
  @IsOptional() @IsString() @MaxLength(40) tom?: string;
  @IsOptional() @IsString() @MaxLength(1000) personalidade?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) ferramentas?: string[];
  @IsOptional() @IsBoolean() conhecimentoAtivo?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) conhecimentoEscopos?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(200) maxRespostasConversa?: number;
  @IsOptional() @IsInt() @Min(80) @Max(2000) maxCaracteres?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) canais?: string[];
  @IsOptional() @IsBoolean() padrao?: boolean;
}

class StatusDto {
  @IsIn(['ativo', 'pausado', 'arquivado']) status!: 'ativo' | 'pausado' | 'arquivado';
}

class MensagemTesteDto {
  @IsIn(['contato', 'ia']) de!: 'contato' | 'ia';
  @IsString() @MinLength(1) @MaxLength(2000) texto!: string;
}

class TestarDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MensagemTesteDto) mensagens!: MensagemTesteDto[];
  @IsOptional() @ValidateNested() @Type(() => AgenteDto) rascunho?: AgenteDto;
}

/** Agent Manager (RV-03.2 · ADR-0030). Tenant SEMPRE do JWT. */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentes: AgentsService) {}

  @Get('catalogo')
  catalogo() {
    return this.agentes.catalogo();
  }

  @Get()
  listar(@TenantId() tenantId: string) {
    return this.agentes.listar(tenantId);
  }

  @Get(':id')
  obter(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agentes.obter(tenantId, id);
  }

  /** O serviço grava a auditoria com o id do agente — sem linha genérica. */
  @SkipAudit()
  @Post()
  criar(@CurrentUser() u: AuthUser, @Body() dto: AgenteDto) {
    return this.agentes.criar(u.tenantId, u, dto);
  }

  @SkipAudit()
  @Patch(':id')
  atualizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgenteDto) {
    return this.agentes.atualizar(u.tenantId, u, id, dto);
  }

  @SkipAudit()
  @Post(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.agentes.mudarStatus(u.tenantId, u, id, dto.status);
  }

  /** Playground: nada é gravado nem enviado. 501 `config_required` sem chave. */
  @SkipAudit()
  @Post(':id/testar')
  testar(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestarDto) {
    return this.agentes.testar(tenantId, id, dto.rascunho, dto.mensagens);
  }
}
