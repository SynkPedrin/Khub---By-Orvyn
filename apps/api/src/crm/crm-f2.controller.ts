import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CompaniesService } from './companies.service';
import { TasksService, type TaskFilter } from './tasks.service';
import { NotesService } from './notes.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';

class CompanyDto {
  @IsString() @MinLength(1) @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(160) dominio?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(240) endereco?: string;
  @IsOptional() @IsString() @MaxLength(80) segmento?: string;
  @IsOptional() @IsIn(['1-10', '11-50', '51-200', '200+']) tamanho?: string;
  @IsOptional() @IsString() @MaxLength(200) site?: string;
  /** Campos personalizados `{ chave: valor }` validados pelas definições (Q2.3). */
  @IsOptional() @IsObject() camposCustom?: Record<string, unknown>;
}
class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MaxLength(160) dominio?: string;
  @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @IsOptional() @IsString() @MaxLength(240) endereco?: string;
  @IsOptional() @IsString() @MaxLength(80) segmento?: string;
  @IsOptional() @IsIn(['1-10', '11-50', '51-200', '200+']) tamanho?: string;
  @IsOptional() @IsString() @MaxLength(200) site?: string;
  /** Campos personalizados `{ chave: valor }` validados pelas definições (Q2.3). */
  @IsOptional() @IsObject() camposCustom?: Record<string, unknown>;
}

class TaskDto {
  @IsString() @MinLength(1) @MaxLength(200) titulo!: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  @IsOptional() @IsIn(['baixa', 'media', 'alta']) prioridade?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
}
class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) titulo?: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  @IsOptional() @IsIn(['baixa', 'media', 'alta']) prioridade?: string;
  @IsOptional() @IsIn(['aberta', 'concluida']) status?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
}

class NoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) corpo!: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() companyId?: string;
}
class UpdateNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) corpo!: string;
}

/** CRM F2 (D1): empresas, tarefas e notas. Tenant sempre do JWT. */
@Controller('crm')
export class CrmF2Controller {
  constructor(
    private readonly companies: CompaniesService,
    private readonly tasks: TasksService,
    private readonly notes: NotesService,
  ) {}

  // ---------------- Empresas ----------------
  @Get('companies')
  listCompanies(@TenantId() t: string, @Query('q') q?: string) {
    return this.companies.list(t, q);
  }
  @Get('companies/:id')
  getCompany(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(t, id);
  }
  @Post('companies')
  createCompany(@TenantId() t: string, @Body() dto: CompanyDto) {
    return this.companies.create(t, dto);
  }
  @Patch('companies/:id')
  updateCompany(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(t, id, dto);
  }
  @Delete('companies/:id')
  removeCompany(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.remove(t, id);
  }

  // ---------------- Tarefas ----------------
  @Get('tasks')
  listTasks(@TenantId() t: string, @Query('filtro') filtro?: string) {
    const f: TaskFilter = ['todas', 'abertas', 'concluidas', 'hoje', 'atrasadas'].includes(filtro ?? '') ? (filtro as TaskFilter) : 'abertas';
    return this.tasks.list(t, f);
  }
  @Post('tasks')
  createTask(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: TaskDto) {
    return this.tasks.create(t, u.identityId, dto);
  }
  @Patch('tasks/:id')
  updateTask(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(t, id, dto);
  }
  @Post('tasks/:id/toggle')
  toggleTask(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.toggle(t, id);
  }
  @Delete('tasks/:id')
  removeTask(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(t, id);
  }

  // ---------------- Notas ----------------
  @Post('notes')
  createNote(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: NoteDto) {
    return this.notes.create(t, u.identityId, dto);
  }
  @Patch('notes/:id')
  updateNote(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(t, u.identityId, id, dto.corpo);
  }
  @Delete('notes/:id')
  removeNote(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.remove(t, u.identityId, id);
  }
}
