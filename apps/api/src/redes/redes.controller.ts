import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Equals, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { RedesConexaoService } from './redes-conexao.service';
import { RedesPublicacaoService, PRIVACIDADES_TIKTOK, PRIVACIDADES_YOUTUBE } from './redes-publicacao.service';
import { RedesService } from './redes.service';
import { REDES_SOCIAIS, ehRedeSocial, type RedeSocial } from './redes.tipos';

class CallbackDto {
  @IsString() @MinLength(1) @MaxLength(2048) code!: string;
  @IsString() @MinLength(1) @MaxLength(4096) state!: string;
}

class PublicacaoDto {
  @IsIn(REDES_SOCIAIS as unknown as string[]) rede!: RedeSocial;
  @IsUUID() conexaoId!: string;
  @IsIn(['imagem', 'reels', 'video']) formato!: 'imagem' | 'reels' | 'video';
  @IsString() @MaxLength(5000) legenda!: string;
  @IsOptional() @IsString() @MaxLength(100) titulo?: string;
  @IsString() @MinLength(8) @MaxLength(2048) midiaUrl!: string;
  @IsOptional() @IsIn([...PRIVACIDADES_TIKTOK, ...PRIVACIDADES_YOUTUBE]) privacidade?: string;
  @IsOptional() @IsISO8601() agendarPara?: string;
  /** Confirmação explícita feita na tela (human-in-the-loop). */
  @IsBoolean() @Equals(true) confirmado!: boolean;
  @IsOptional() @IsBoolean() desativarComentarios?: boolean;
}

const rede = (v: string): RedeSocial => {
  if (!ehRedeSocial(v)) throw new BadRequestException('rede desconhecida');
  return v;
};

/**
 * `/v1/redes`: painel e publicação das redes sociais da subconta.
 * Permissão (permissions.guard): leitura `contacts.read`; escrita (publicar,
 * cancelar) `automations.write` (manager+). Módulo: `automacoes`.
 */
@Controller('redes')
export class RedesController {
  constructor(
    private readonly redes: RedesService,
    private readonly publicacoes: RedesPublicacaoService,
  ) {}

  @Get('estado')
  estado(@TenantId() tenantId: string) {
    return this.redes.estado(tenantId);
  }

  @Get('painel/:rede')
  painel(@TenantId() tenantId: string, @Param('rede') r: string, @Query('conexaoId') conexaoId?: string, @Query('dias') dias?: string) {
    if (conexaoId && !/^[0-9a-f-]{36}$/i.test(conexaoId)) throw new BadRequestException('conexaoId inválido');
    return this.redes.painel(tenantId, rede(r), conexaoId, Number(dias ?? 28));
  }

  @Get('tiktok/criador/:conexaoId')
  criador(@TenantId() tenantId: string, @Param('conexaoId', ParseUUIDPipe) conexaoId: string) {
    return this.publicacoes.criadorTiktok(tenantId, conexaoId);
  }

  @Get('publicacoes')
  listar(@TenantId() tenantId: string, @Query('rede') r?: string) {
    return this.publicacoes.listar(tenantId, r ? rede(r) : undefined);
  }

  /** O serviço audita (`rede.publicacao.confirmada`). */
  @SkipAudit()
  @Post('publicacoes')
  criar(@CurrentUser() user: AuthUser, @Body() dto: PublicacaoDto) {
    return this.publicacoes.criar(user.tenantId, user.identityId, dto);
  }

  @SkipAudit()
  @Post('publicacoes/:id/cancelar')
  cancelar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.publicacoes.cancelar(user.tenantId, user.identityId, id);
  }
}

/**
 * `/v1/integrations/redes`: conectar/desconectar contas. Prefixo
 * `integrations` → `integrations.manage` (owner/admin), igual aos demais
 * conectores. O callback é público: o tenant vem do `state` assinado.
 */
@Controller('integrations/redes')
export class RedesConexaoController {
  constructor(private readonly conexoes: RedesConexaoService) {}

  @Get(':rede/auth-url')
  authUrl(@CurrentUser() user: AuthUser, @Param('rede') r: string) {
    return this.conexoes.urlConexao(user.tenantId, user.identityId, r);
  }

  /** O serviço audita cada conta conectada (`rede.conectada`). */
  @Public()
  @SkipAudit()
  @Post(':rede/callback')
  callback(@Param('rede') r: string, @Body() dto: CallbackDto) {
    return this.conexoes.callback(r, dto.code, dto.state);
  }

  /** O serviço audita (`rede.desconectada`). */
  @SkipAudit()
  @Delete('conexoes/:id')
  desconectar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conexoes.desconectar(user.tenantId, user.identityId, id);
  }
}
