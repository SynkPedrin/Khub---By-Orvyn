import { BadRequestException, Body, Controller, Headers, HttpCode, Logger, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TriggersService } from './triggers.service';
import { Prisma } from '@prisma/client';

/** Janela de dedupe quando o remetente não manda `Idempotency-Key` (W5). */
export const JANELA_DEDUPE_MS = 10 * 60_000;

/** JSON canônico: chaves ordenadas em todo nível — `{b,a}` e `{a,b}` são o mesmo evento. */
export function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Confere `X-KHUB-Signature: sha256=<hex>` contra HMAC-SHA256(segredo, corpo cru).
 * Comparação em tempo constante; formato errado ou tamanho diferente = inválida.
 */
export function assinaturaValida(segredo: string, corpoCru: Buffer, header: string | undefined): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? '');
  if (!m) return false;
  const esperado = createHmac('sha256', segredo).update(corpoCru).digest();
  const recebido = Buffer.from(m[1], 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/**
 * Entrada pública de webhook por workflow (`gatilho.webhook`).
 *
 * A URL é a credencial: `/v1/hooks/:chave`, com chave aleatória de 24 bytes e
 * revogável (regerar troca a URL). Mesmo padrão de roteamento das migrations
 * 008/009 — a função SECURITY DEFINER devolve só (tenant, workflow); o corpo do
 * request **nunca** escolhe tenant.
 *
 * W5 (Q1.4):
 *  - `Idempotency-Key` é OPCIONAL. Sem ela, a chave de dedupe é
 *    sha256(workflowId + corpo canônico) numa janela de 10 min — reenvio
 *    automático do Zapier/n8n/formulário não abre duas execuções.
 *  - Se o fluxo tem segredo (`workflows.webhook_segredo`), exige
 *    `X-KHUB-Signature: sha256=<hmac do corpo cru>`; inválida → 401 sem abrir run.
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
  async receber(
    @Param('chave') chave: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { rawBody?: Buffer },
    @Headers('idempotency-key') eventId?: string,
    @Headers('x-khub-signature') assinatura?: string,
  ) {
    const rota = await this.resolver(chave);
    // 202 mesmo para chave desconhecida: responder 404 aqui viraria um oráculo
    // para descobrir chaves válidas por tentativa.
    if (!rota) {
      this.log.warn('webhook recebido com chave inválida');
      return { recebido: true };
    }

    const tenantId = rota.tenant_id;
    const workflowId = rota.workflow_id;

    // Assinatura ANTES de qualquer escrita: chamada forjada não deixa rastro no outbox.
    const wf = await this.prisma.withTenant(tenantId, (tx) => tx.workflow.findUnique({ where: { id: workflowId }, select: { webhookSegredo: true } }));
    if (wf?.webhookSegredo) {
      if (!req.rawBody || !assinaturaValida(wf.webhookSegredo, req.rawBody, assinatura)) {
        this.log.warn(`webhook do workflow ${workflowId} recusado: assinatura ausente ou inválida`);
        throw new UnauthorizedException('assinatura X-KHUB-Signature ausente ou inválida');
      }
    }

    const chaveRemetente = eventId?.trim();
    if (chaveRemetente && chaveRemetente.length > 200) throw new BadRequestException('Idempotency-Key longo demais (máx. 200)');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('payload inválido');

    const payload = { workflowId, body } as Prisma.InputJsonObject;
    if (chaveRemetente) {
      const dedupeKey = `hook:${workflowId}:${chaveRemetente}`;
      await this.prisma.withTenant(tenantId, (tx) => tx.outboxEvent.upsert({ where: { tenantId_dedupeKey: { tenantId, dedupeKey } }, create: { tenantId, kind: 'workflow.hook', dedupeKey, payload }, update: {} }));
      return { recebido: true };
    }

    // Sem chave do remetente: dedupe por conteúdo em janela de 10 min. A chave
    // leva o "balde" de 10 min (unique do outbox = atômico dentro do balde) e o
    // balde anterior é consultado pela idade real — janela deslizante de fato.
    const hash = createHash('sha256').update(`${workflowId}\n${jsonCanonico(body)}`).digest('hex');
    const agora = Date.now();
    const balde = Math.floor(agora / JANELA_DEDUPE_MS);
    const chaveDe = (b: number) => `hook:${workflowId}:auto:${hash}:${b}`;
    const duplicado = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.outboxEvent.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: chaveDe(balde) } }, select: { createdAt: true } });
      if (atual) return true;
      const anterior = await tx.outboxEvent.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: chaveDe(balde - 1) } }, select: { createdAt: true } });
      if (anterior && agora - anterior.createdAt.getTime() < JANELA_DEDUPE_MS) return true;
      await tx.outboxEvent.upsert({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: chaveDe(balde) } }, create: { tenantId, kind: 'workflow.hook', dedupeKey: chaveDe(balde), payload }, update: {} });
      return false;
    });
    return duplicado ? { recebido: true, duplicado: true } : { recebido: true };
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
