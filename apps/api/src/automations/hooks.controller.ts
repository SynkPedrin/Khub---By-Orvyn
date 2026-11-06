import { BadRequestException, Body, Controller, Headers, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TriggersService } from './triggers.service';
import { Prisma } from '@prisma/client';

/**
 * Entrada pública de webhook por workflow (`gatilho.webhook`).
 *
 * A URL é a credencial: `/v1/hooks/:chave`, com chave aleatória de 24 bytes e
 * revogável (regerar troca a URL). Mesmo padrão de roteamento das migrations
 * 008/009 — a função SECURITY DEFINER devolve só (tenant, workflow); o corpo do
 * request **nunca** escolhe tenant.
 */
@Public()
@Controller('hooks')
export class HooksController {
  private readonly log = new Logger('WorkflowHooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly triggers: TriggersService,
  ) {}

  @Post(':chave')
  @HttpCode(202)
  async receber(@Param('chave') chave: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') eventId?: string) {
    const rota = await this.resolver(chave);
    // 202 mesmo para chave desconhecida: responder 404 aqui viraria um oráculo
    // para descobrir chaves válidas por tentativa.
    if (!rota) {
      this.log.warn('webhook recebido com chave inválida');
      return { recebido: true };
    }

    if(!eventId || eventId.length>200) throw new BadRequestException('Idempotency-Key obrigatório');
    if(!body || typeof body!=='object' || Array.isArray(body)) throw new BadRequestException('payload inválido');
    const tenantId=rota.tenant_id;
    const dedupeKey=`hook:${rota.workflow_id}:${eventId}`;
    await this.prisma.withTenant(tenantId,tx=>tx.outboxEvent.upsert({where:{tenantId_dedupeKey:{tenantId,dedupeKey}},create:{tenantId,kind:'workflow.hook',dedupeKey,payload:{workflowId:rota.workflow_id,body} as Prisma.InputJsonObject},update:{}}));
    return {recebido:true};
  }

  private async resolver(chave: string): Promise<{ tenant_id: string; workflow_id: string } | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ tenant_id: string; workflow_id: string }[]>`
        SELECT * FROM resolve_workflow_by_webhook_key(${chave})`;
      return rows[0]?.tenant_id ? rows[0] : null;
    } catch (e) {
      this.log.warn(`resolução da chave falhou: ${(e as Error).message}`);
      return null;
    }
  }
}
