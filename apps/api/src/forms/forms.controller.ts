import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { FormsService } from './forms.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Formulários (Q4.1), área autenticada. Corpo validado por Zod no serviço
 * (`CriarFormSchema`/`AtualizarFormSchema`): `campos`/`estilo` são jsonb
 * aninhados que DTO de classe não descreve bem.
 * Permissão (PermissionsGuard): leitura `contacts.read`, escrita `organization.manage`.
 */
@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  listar(@TenantId() t: string) {
    return this.forms.listar(t);
  }

  @Post()
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.forms.criar(t, u.identityId, body);
  }

  @Get(':id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.obter(t, id);
  }

  @Patch(':id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.forms.atualizar(t, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.remover(t, id);
  }

  @Get(':id/respostas')
  respostas(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string, @Query('limite') limite?: string) {
    if (cursor && !UUID_RE.test(cursor)) throw new BadRequestException('cursor inválido');
    const n = limite === undefined ? undefined : Number(limite);
    if (n !== undefined && !Number.isInteger(n)) throw new BadRequestException('limite inválido');
    return this.forms.respostas(t, id, { cursor, limite: n });
  }

  @Get(':id/respostas/csv')
  @Header('Cache-Control', 'no-store')
  async csv(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { nome, conteudo } = await this.forms.csv(t, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="respostas-${nome}.csv"`);
    res.send(conteudo);
  }
}
