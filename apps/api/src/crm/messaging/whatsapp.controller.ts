import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../../auth/decorators';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { StevoApiVinculoService } from './stevo-api-vinculo.service';

/**
 * `/v1/integrations/whatsapp` — conectar/consultar/desconectar o WhatsApp do
 * tenant autenticado. Autenticado (não `@Public()`): diferente do webhook,
 * que a Evolution/Stevo chamam sem sessão.
 *
 * Provedor por tenant (ADR-0032): se a subconta já tem uma instância Stevo
 * vinculada (`integrations.provider = 'stevo_api'`), o fluxo inteiro (QR,
 * status) vem da Stevo; senão cai no provedor antigo (Evolution/QR própria).
 * O front não sabe disso — fala sempre com este único endpoint.
 */
@Controller('integrations/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly conexao: WhatsAppConnectionService,
    private readonly stevoVinculo: StevoApiVinculoService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private webhookUrl(): string {
    const token = this.config.get('EVOLUTION_WEBHOOK_TOKEN');
    // `EVOLUTION_WEBHOOK_URL` é a base pública que a Evolution consegue
    // alcançar — em dev, o container Docker enxerga o host via
    // `host.docker.internal`, nunca `localhost` (que dentro do container
    // apontaria para o próprio container).
    const base = this.config.get('EVOLUTION_WEBHOOK_URL') ?? 'http://host.docker.internal:3333';
    return `${base.replace(/\/+$/, '')}/v1/hooks/evolution/${token}`;
  }

  private async usaStevo(tenantId: string): Promise<boolean> {
    const integ = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'stevo_api', status: { not: 'revoked' } }, select: { id: true } }),
    );
    return !!integ;
  }

  @Post('connect')
  async connect(@TenantId() tenantId: string) {
    if (await this.usaStevo(tenantId)) return this.stevoVinculo.conectar(tenantId);
    return this.conexao.connect(tenantId, this.webhookUrl());
  }

  @Get('status')
  async status(@TenantId() tenantId: string, @Query('qr') qr?: string) {
    if (await this.usaStevo(tenantId)) return this.stevoVinculo.status(tenantId, qr === 'true');
    return this.conexao.status(tenantId, qr === 'true');
  }

  @Delete('disconnect')
  async disconnect(@TenantId() tenantId: string) {
    await this.conexao.disconnect(tenantId);
    return { ok: true };
  }
}
