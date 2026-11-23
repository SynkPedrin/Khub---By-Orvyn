import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Equals, IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public, TenantId, type AuthUser } from '../../auth/decorators';
import { SkipAudit } from '../../common/audit.interceptor';
import { GennaConexaoService } from './genna-conexao.service';
import { GennaService } from './genna.service';

class CallbackDto {
  @IsString() @MinLength(1) @MaxLength(4096) code!: string;
  @IsString() @MinLength(1) @MaxLength(8192) state!: string;
}

class ConsultaDto {
  @IsOptional() @IsObject() argumentos?: Record<string, unknown>;
}

/** Criar/editar/publicar no Genna exige `confirmar: true`: a tela só manda depois do diálogo. */
class ExecucaoDto {
  @IsOptional() @IsObject() argumentos?: Record<string, unknown>;
  @IsBoolean() @Equals(true) confirmar!: boolean;
}

const NOME_FERRAMENTA = /^[A-Za-z0-9_.-]{1,120}$/;

/**
 * Genna (Instagram: métricas, conteúdos, radar do nicho, criação e
 * publicação) por subconta: `/v1/genna/*` (ADR-0053).
 * Permissões (permissions.guard.ts): status, ferramentas e consultas de
 * leitura = quem vê a tela; conectar, desconectar e executar = owner/admin.
 * Publicação vira pedido em NICO > Aprovações.
 */
@Controller('genna')
export class GennaController {
  constructor(
    private readonly conexao: GennaConexaoService,
    private readonly genna: GennaService,
  ) {}

  @Get('status')
  status(@TenantId() tenantId: string) {
    return this.conexao.status(tenantId);
  }

  @Get('auth-url')
  authUrl(@TenantId() tenantId: string, @CurrentUser() user: AuthUser) {
    return this.conexao.urlConexao(tenantId, user.identityId ?? null);
  }

  /** Público: o web recebe o redirect do Genna e repassa code + state (o state assinado carrega o tenant). */
  @Public()
  @Post('callback')
  @HttpCode(200)
  callback(@Body() dto: CallbackDto) {
    return this.conexao.callback(dto.code, dto.state);
  }

  @SkipAudit()
  @Delete('conexao')
  desconectar(@TenantId() tenantId: string, @CurrentUser() user: AuthUser) {
    return this.conexao.desconectar(tenantId, user.identityId ?? null);
  }

  @Get('ferramentas')
  ferramentas(@TenantId() tenantId: string, @Query('renovar') renovar?: string) {
    return this.genna.ferramentas(tenantId, renovar === '1');
  }

  /** POST porque leva argumentos; só aceita ferramenta de leitura (o serviço confere). */
  @SkipAudit()
  @Post('consultar/:nome')
  @HttpCode(200)
  consultar(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Param('nome') nome: string, @Body() dto: ConsultaDto) {
    return this.genna.consultar(tenantId, user.identityId ?? null, validarNome(nome), dto.argumentos ?? {});
  }

  @SkipAudit()
  @Post('executar/:nome')
  @HttpCode(200)
  executar(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Param('nome') nome: string, @Body() dto: ExecucaoDto) {
    return this.genna.executar(tenantId, user.identityId ?? null, validarNome(nome), dto.argumentos ?? {});
  }
}

function validarNome(nome: string): string {
  if (!NOME_FERRAMENTA.test(nome)) throw new BadRequestException('nome de ferramenta inválido');
  return nome;
}
