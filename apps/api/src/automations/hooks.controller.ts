import { Body, Controller, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TriggersService } from './triggers.service';

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
  async receber(@Param('chave') chave: string, @Body() body: Record<string, unknown>) {
    const rota = await this.resolver(chave);
    // 202 mesmo para chave desconhecida: responder 404 aqui viraria um oráculo
    // para descobrir chaves válidas por tentativa.
    if (!rota) {
      this.log.warn('webhook recebido com chave inválida');
      return { recebido: true };
    }

    const r = await this.triggers
      .processarWebhook(rota.tenant_id, rota.workflow_id, body ?? {})
      .catch((e: Error) => {
        this.log.error(`falha ao processar webhook: ${e.message}`);
        return { ok: false, motivo: 'erro interno' };
      });

    // 202 sempre: quem chama não precisa (nem deve) saber do fluxo interno.
    return { recebido: true, ...(r.ok ? { runId: (r as { runId?: string }).runId } : { ignorado: r.motivo }) };
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
