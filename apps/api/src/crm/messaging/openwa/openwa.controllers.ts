import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../../auth/decorators';
import { SkipRateLimit } from '../../../common/rate-limit.guard';
import { SkipAudit } from '../../../common/audit.interceptor';
import { ConfigService } from '../../../config/config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { registrarNoOutbox } from '../../../common/outbox';
import { ipDoCliente, type RequisicaoPublica } from '../../../common/public-request';
import { verificarAssinaturaStevo } from '../stevo-assinatura';
import { tenantDaSessao } from './openwa.provider';
import { OpenWaEventosService, type EventoOpenWa } from './openwa-eventos.service';
import { OpenWaConexaoService } from './openwa-conexao.service';

class HistoricoDto {
  @IsOptional() @IsInt() @Min(1) @Max(365) dias?: number;
}

/** Eventos que o KHUB processa; `sessao.qr` é aceito e descartado (o QR é lido do gateway na hora). */
export const EVENTOS_OPENWA = ['sessao.estado', 'mensagem', 'mensagem.status', 'historico.lote', 'contato.foto'] as const;

const envelopeSchema = z.object({
  eventId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(60),
  tipo: z.string().min(1).max(40),
  criadoEm: z.string().optional(),
  dados: z.record(z.unknown()).default({}),
});

/**
 * Webhook do wa-gateway (CONTRATO.md §2). Mesma garantia do webhook da Stevo:
 * assinatura HMAC com anti-replay, tenant pela sessão (`khub-<tenantId>`) +
 * integração `openwa` ativa, outbox com dedupe por `eventId` e processamento
 * imediato (o worker reprocessa se falhar).
 */
@Public()
@SkipRateLimit()
@SkipAudit()
@Controller('webhooks/openwa')
export class OpenWaWebhookController {
  private readonly log = new Logger('OpenWaWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventos: OpenWaEventosService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(@Req() req: Request) {
    const h = (nome: string) => {
      const v = req.headers[nome];
      return Array.isArray(v) ? v[0] : v;
    };
    const verif = verificarAssinaturaStevo({
      corpoCru: (req as Request & { rawBody?: Buffer }).rawBody,
      timestamp: h('x-khub-timestamp'),
      assinaturas: [h('x-khub-signature')],
      segredos: [this.config.get('OPENWA_WEBHOOK_SECRET')],
    });
    if (!verif.ok) {
      this.log.warn(`webhook recusado: ${verif.motivo}`);
      throw new UnauthorizedException(`assinatura recusada: ${verif.motivo}`);
    }
    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success) return { ignorado: 'envelope_invalido' };
    const ev = parsed.data as EventoOpenWa;
    if (!(EVENTOS_OPENWA as readonly string[]).includes(ev.tipo)) return { ignorado: 'evento_nao_usado' };
    const tenantId = tenantDaSessao(ev.sessionId);
    if (!tenantId) return { ignorado: 'sessao_invalida' };

    // Só entrega em tenant com a integração ativa para ESTA sessão.
    const ativa = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'openwa', externalBusinessId: ev.sessionId, status: { not: 'revoked' } }, select: { id: true } }),
    ).catch(() => null);
    if (!ativa) {
      this.log.log(`evento ${ev.tipo} de sessão sem vínculo ativo ignorado`);
      return { ignorado: 'sessao_sem_vinculo' };
    }

    const linha = await this.prisma.withTenant(tenantId, (tx) => registrarNoOutbox(tx, { tenantId, kind: 'openwa.event', dedupeKey: `openwa-${ev.eventId}`, payload: ev }));
    if (linha.status === 'pending') {
      try {
        await this.eventos.processar(tenantId, ev);
        await this.prisma.withTenant(tenantId, (tx) => tx.outboxEvent.updateMany({ where: { id: linha.id, status: 'pending' }, data: { status: 'processed', processedAt: new Date() } }));
      } catch (e) {
        this.log.warn(`processamento imediato falhou (${ev.tipo}); o worker reprocessa: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    return { ok: true };
  }
}

/**
 * Painel "WhatsApp por QR Code" em Integrações (ADR-0058). Rota sob
 * `integrations/…` → `integrations.manage` (owner/admin) no PermissionsGuard.
 */
@Controller('integrations/whatsapp-qr')
export class OpenWaController {
  constructor(private readonly conexao: OpenWaConexaoService) {}

  @Get()
  painel(@CurrentUser() user: AuthUser) {
    return this.conexao.painel(user.tenantId);
  }

  @SkipAudit()
  @Post('conectar')
  @HttpCode(200)
  conectar(@CurrentUser() user: AuthUser) {
    return this.conexao.conectar(user.tenantId, user.identityId);
  }

  @SkipAudit()
  @Post('desconectar')
  @HttpCode(200)
  desconectar(@CurrentUser() user: AuthUser) {
    return this.conexao.desconectar(user.tenantId, user.identityId);
  }

  @SkipAudit()
  @Post('historico')
  @HttpCode(202)
  historico(@CurrentUser() user: AuthUser, @Body() dto: HistoricoDto) {
    return this.conexao.sincronizarHistorico(user.tenantId, user.identityId, dto.dias ?? 90);
  }

  @SkipAudit()
  @Post('links')
  criarLink(@CurrentUser() user: AuthUser) {
    return this.conexao.criarLink(user.tenantId, user.identityId);
  }

  @SkipAudit()
  @Delete('links/:id')
  revogarLink(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.conexao.revogarLink(user.tenantId, user.identityId, id);
  }
}

/**
 * Página pública do link de conexão (`/w/<token>`). O token (256 bits, só o
 * sha256 no banco, vale 7 dias) é a credencial. Limite por IP real no serviço.
 */
@Public()
@SkipRateLimit()
@SkipAudit()
@Controller('public/whatsapp')
export class PublicOpenWaController {
  constructor(private readonly conexao: OpenWaConexaoService) {}

  @Get(':token')
  ver(@Param('token') token: string, @Req() req: RequisicaoPublica) {
    return this.conexao.verLink(token, ipDoCliente(req));
  }

  @Post(':token/novo-qr')
  @HttpCode(200)
  novoQr(@Param('token') token: string, @Req() req: RequisicaoPublica) {
    return this.conexao.reiniciarPeloLink(token, ipDoCliente(req));
  }
}
