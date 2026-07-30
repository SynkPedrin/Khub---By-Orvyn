import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NyroService } from './nyro.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { CATALOGO_PUBLICO } from './tools-publicas';

class ChatDto {
  @IsString() @MinLength(1) @MaxLength(2000) texto!: string;
  @IsOptional() @IsUUID() conversationId?: string;
}
class DecisaoDto {
  @IsBoolean() aprovar!: boolean;
}

/**
 * Nyro IA (Sprint F). Tudo **gated** em `ANTHROPIC_API_KEY`: sem a chave, o chat
 * responde 501 `config_required` — nunca uma resposta simulada (ADR-0008).
 */
@Controller('nyro')
export class NyroController {
  constructor(private readonly nyro: NyroService) {}

  /** Estado da Nyro para a UI decidir entre chat e "Conectar Claude". */
  @Get('status')
  status() {
    return {
      configurada: this.nyro.configurada(),
      missing: this.nyro.missing(),
      capacidades: CATALOGO_PUBLICO,
    };
  }

  @Post('chat')
  @HttpCode(200)
  chat(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ChatDto) {
    return this.nyro.conversar({ tenantId: t, identityId: u.identityId }, dto.texto, dto.conversationId);
  }

  @Get('conversas')
  conversas(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.nyro.listarConversas(t, u.identityId);
  }

  @Get('conversas/:id')
  conversa(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.nyro.verConversa(t, id);
  }

  /** Human-in-the-loop: a ação sensível só acontece depois deste POST. */
  @Post('acoes/:id')
  @HttpCode(200)
  decidir(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisaoDto) {
    return this.nyro.decidirAcao({ tenantId: t, identityId: u.identityId }, id, dto.aprovar);
  }

  @Get('acoes')
  acoesPendentes(@TenantId() t: string) {
    return this.nyro.pendentes(t);
  }

  /** Consumo/custo de IA do tenant. */
  @Get('uso')
  uso(@TenantId() t: string) {
    return this.nyro.uso(t);
  }
}
