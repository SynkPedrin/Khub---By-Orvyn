import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { hasPermission } from '../auth/permissions.guard';
import { SkipAudit } from '../common/audit.interceptor';
import { AprovacoesService, MIMES_ARQUIVO, RESPOSTAS, STATUS_APROVACAO, TIPOS_APROVACAO, type Resposta, type StatusAprovacao, type TipoAprovacao } from './aprovacoes.service';

const opcional = (_o: unknown, v: unknown) => v !== null && v !== undefined;

class CriarDto {
  @IsIn([...TIPOS_APROVACAO]) tipo!: TipoAprovacao;
  @IsString() @MaxLength(200) titulo!: string;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(2000) descricao?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(20000) conteudo?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(5000) legenda?: string | null;
  @IsOptional() @ValidateIf((_o, v) => typeof v === 'string' && v.trim() !== '') @IsString() @MaxLength(1000) @Matches(/^https:\/\//, { message: 'O link precisa começar com https://' }) linkExterno?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(60) canal?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsISO8601() publicarEm?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsISO8601() prazoEm?: string | null;
}
class AtualizarDto {
  @IsOptional() @IsIn([...TIPOS_APROVACAO]) tipo?: TipoAprovacao;
  @IsOptional() @IsString() @MaxLength(200) titulo?: string;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(2000) descricao?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(20000) conteudo?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(5000) legenda?: string | null;
  @IsOptional() @ValidateIf((_o, v) => typeof v === 'string' && v.trim() !== '') @IsString() @MaxLength(1000) @Matches(/^https:\/\//, { message: 'O link precisa começar com https://' }) linkExterno?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsString() @MaxLength(60) canal?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsISO8601() publicarEm?: string | null;
  @IsOptional() @ValidateIf(opcional) @IsISO8601() prazoEm?: string | null;
}
class ArquivoDto {
  @IsString() @MaxLength(200) nome!: string;
  @IsIn([...MIMES_ARQUIVO]) mime!: string;
  /** ~4 MB em base64 (+ prefixo data:). */
  @IsString() @MaxLength(5_700_000) base64!: string;
}
class EnviarDto {
  @IsOptional() @IsString() @MaxLength(2000) mensagem?: string;
}
class ResponderDto {
  @IsIn([...RESPOSTAS]) acao!: Resposta;
  @IsOptional() @IsString() @MaxLength(2000) comentario?: string;
}
class ComentarDto {
  @IsString() @MaxLength(2000) texto!: string;
}

/** Quem monta e envia peças (equipe/agência) também enxerga os rascunhos. */
const equipe = (u: AuthUser) => hasPermission(u, 'automations.write');

function statusDaQuery(q?: string): StatusAprovacao[] | undefined {
  if (!q) return undefined;
  const lista = q.split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.some((s) => !(STATUS_APROVACAO as readonly string[]).includes(s))) throw new BadRequestException('status inválido');
  return lista as StatusAprovacao[];
}

@SkipAudit()
@Controller('aprovacoes')
export class AprovacoesController {
  constructor(private readonly svc: AprovacoesService) {}

  @Get()
  listar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('tipo') tipo?: string, @Query('busca') busca?: string, @Query('visao') visao?: string) {
    if (tipo && !(TIPOS_APROVACAO as readonly string[]).includes(tipo)) throw new BadRequestException('tipo inválido');
    // `visao=cliente` (app mobile): só o que já foi enviado, mesmo para quem também é da equipe.
    return this.svc.listar(t, { status: statusDaQuery(status), tipo: tipo as TipoAprovacao | undefined, incluirRascunhos: visao !== 'cliente' && equipe(u), busca: busca?.slice(0, 100) });
  }

  @Get('resumo')
  async resumo(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('visao') visao?: string) {
    const eq = visao !== 'cliente' && equipe(u);
    return { ...(await this.svc.resumo(t, eq)), equipe: equipe(u) };
  }

  @Get(':id')
  detalhe(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detalhe(t, id, equipe(u));
  }

  /** Binário da arte/PDF. Cache privado curto: é dado do cliente. */
  @Get(':id/arquivos/:arquivoId')
  async arquivo(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('arquivoId', ParseUUIDPipe) arquivoId: string, @Res() res: Response) {
    const a = await this.svc.arquivo(t, id, arquivoId, equipe(u));
    res.setHeader('content-type', a.mime);
    res.setHeader('content-length', String(a.dados.length));
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    res.end(a.dados);
  }

  @Post()
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: CriarDto) {
    return this.svc.criar(t, u.identityId, b);
  }

  @Patch(':id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: AtualizarDto) {
    return this.svc.atualizar(t, id, b);
  }

  @Delete(':id')
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remover(t, id);
  }

  @Post(':id/arquivos')
  adicionarArquivo(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: ArquivoDto) {
    return this.svc.adicionarArquivo(t, id, b);
  }

  @Delete(':id/arquivos/:arquivoId')
  removerArquivo(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('arquivoId', ParseUUIDPipe) arquivoId: string) {
    return this.svc.removerArquivo(t, id, arquivoId);
  }

  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: EnviarDto) {
    return this.svc.enviar(t, u.identityId, id, b.mensagem);
  }

  @Post(':id/responder')
  @HttpCode(200)
  responder(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ResponderDto) {
    return this.svc.responder(t, u.identityId, id, b.acao, b.comentario);
  }

  @Post(':id/comentarios')
  @HttpCode(200)
  comentar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ComentarDto) {
    return this.svc.comentar(t, u.identityId, id, b.texto, equipe(u));
  }
}
