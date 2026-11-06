import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../../auth/decorators';
import { ConfigService } from '../../config/config.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';

/**
 * `/v1/integrations/whatsapp` — conectar/consultar/desconectar o WhatsApp do
 * tenant autenticado. Autenticado (não `@Public()`): diferente do webhook,
 * que a Evolution chama sem sessão.
 */
@Controller('integrations/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly conexao: WhatsAppConnectionService,
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

  @Post('connect')
  async connect(@TenantId() tenantId: string) {
    return this.conexao.connect(tenantId, this.webhookUrl());
  }

  @Get('status')
  async status(@TenantId() tenantId: string, @Query('qr') qr?: string) {
    return this.conexao.status(tenantId, qr === 'true');
  }

  @Delete('disconnect')
  async disconnect(@TenantId() tenantId: string) {
    await this.conexao.disconnect(tenantId);
    return { ok: true };
  }
}
