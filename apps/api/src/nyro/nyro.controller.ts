import { Body, Controller, Get, HttpCode, HttpException, Logger, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ErroProvedorIA } from '../ai/provider.contract';
import { NyroService } from './nyro.service';
import { NicoInsightsService } from './insights.service';
import { NicoAnalisesService } from './analises.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { CATALOGO_PUBLICO } from './tools-publicas';
import { MAX_ANEXOS } from './anexos';

/** O que dizer ao usuário quando o provedor de IA falha (o detalhe técnico vai só para o log). */
const MENSAGEM_PROVEDOR: Record<ErroProvedorIA['causa'], string> = {
  credencial: 'A chave da IA foi recusada pelo provedor. Quem administra precisa conferir a ANTHROPIC_API_KEY no servidor.',
  limite: 'A IA está com limite de uso no momento. Tente de novo em instantes.',
  indisponivel: 'A IA está fora do ar agora. Tente de novo em instantes.',
  requisicao: 'A IA recusou o pedido (erro de configuração do servidor). O detalhe está no log da API.',
  desconhecida: 'Não consegui falar com a NICO agora.',
};
class AnexoDto {
  @IsString() @MinLength(1) @MaxLength(160) nome!: string;
  /** Arquivo em base64 (até 10 MB binários ≈ 14 MB de texto). */
  @IsString() @MinLength(1) @MaxLength(14_500_000) base64!: string;
}
class ChatDto {
  @IsString() @MinLength(1) @MaxLength(2000) texto!: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ANEXOS) @ValidateNested({ each: true }) @Type(() => AnexoDto) anexos?: AnexoDto[];
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
  private readonly log = new Logger('Nyro');
  constructor(private readonly nyro: NyroService, private readonly insights: NicoInsightsService, private readonly analises: NicoAnalisesService) {}

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
    return this.nyro.conversar({ tenantId: t, identityId: u.identityId }, dto.texto, dto.conversationId, dto.anexos);
  }

  /**
   * Chat com streaming (SSE): passos, plano e texto chegam enquanto a NICO
   * trabalha. Eventos: conversa | passo | plano | texto | limpar | final | erro.
   */
  @Post('chat/stream')
  async chatStream(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: ChatDto, @Res() res: Response) {
    this.nyro.exigirPronta();
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let aberto = true;
    res.on('close', () => { aberto = false; });
    const enviar = (e: unknown) => { if (aberto) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    const batida = setInterval(() => { if (aberto) res.write(': ping\n\n'); }, 15_000);
    try {
      await this.nyro.conversar({ tenantId: t, identityId: u.identityId }, dto.texto, dto.conversationId, dto.anexos, { emitir: enviar });
    } catch (e) {
      // 4xx (ex.: anexo inválido) tem mensagem própria; erro do provedor de IA diz a causa de forma útil;
      // o resto não vaza detalhe interno. O detalhe técnico completo vai para o log.
      let status = e instanceof HttpException ? e.getStatus() : 500;
      let mensagem = status < 500 && e instanceof HttpException ? e.message : 'Não consegui falar com a NICO agora.';
      if (e instanceof ErroProvedorIA) {
        status = 502;
        mensagem = MENSAGEM_PROVEDOR[e.causa];
      }
      if (status >= 500) this.log.error(`chat/stream falhou: ${(e as Error).message}`);
      enviar({ tipo: 'erro', status, mensagem });
    } finally {
      clearInterval(batida);
      res.end();
    }
  }

  /** Alertas que a NICO notou sozinha (regras, sem LLM): campanhas, cobranças, automações, conversas paradas. */
  @Get('insights')
  insightsDaConta(@TenantId() t: string) {
    return this.insights.listar(t);
  }

  /** Relatórios que a NICO gerou (chat e rotinas): lista, leitura e, no front, download .md/PDF. */
  @Get('relatorios')
  relatorios(@TenantId() t: string) {
    return this.analises.listarRelatorios(t);
  }

  @Get('relatorios/:id')
  relatorio(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.analises.obterRelatorio(t, id);
  }

  /** Rotinas agendadas da NICO (o que ela faz sozinha). */
  @Get('rotinas')
  rotinas(@TenantId() t: string) {
    return this.analises.listarAgendamentos(t);
  }

  @Post('rotinas/:id/pausar')
  @HttpCode(200)
  pausarRotina(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.analises.cancelarAgendamento(t, id);
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
