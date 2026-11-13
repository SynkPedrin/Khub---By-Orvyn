import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TenantId } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { AvatarContatoService } from './messaging/avatar-contato.service';
import { AtribuicaoService } from './atribuicao.service';
import { lerAtribuicao, ROTULO_FONTE } from './atribuicao';

/**
 * Foto durável do contato e origem do lead (db/066).
 * Rotas sob `crm/contacts…` e `crm/atribuicao…` herdam a matriz de permissões
 * do CRM (leitura = contacts.read; backfill = contacts.write).
 */
@SkipAudit()
@Controller('crm')
export class OrigemFotoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avatares: AvatarContatoService,
    private readonly atribuicao: AtribuicaoService,
  ) {}

  /** Imagem da foto de perfil guardada (bytes). 404 = sem foto: a tela mostra as iniciais. */
  @Get('contacts/:id/foto')
  async foto(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.avatares.obterFoto(t, id);
    if (!f) throw new NotFoundException('contato sem foto');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Last-Modified', f.atualizadaEm.toUTCString());
    res.end(f.bytes);
  }

  /** Origem do lead (primeiro toque, último toque, campanha, criativo, confiança). */
  @Get('contacts/:id/origem')
  async origem(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.withTenant(t, (tx) => tx.contact.findUnique({
      where: { id },
      select: { atribuicao: true, origem: true, adCampaignId: true, adCreativeId: true },
    }));
    if (!c) throw new NotFoundException('contato inexistente');
    const a = lerAtribuicao(c.atribuicao);
    const [campanha, criativo] = await this.prisma.withTenant(t, (tx) => Promise.all([
      c.adCampaignId ? tx.adCampaign.findUnique({ where: { id: c.adCampaignId }, select: { name: true, status: true, objective: true } }) : null,
      c.adCreativeId ? tx.adCreative.findUnique({ where: { id: c.adCreativeId }, select: { name: true, thumbnailUrl: true, body: true } }) : null,
    ]));
    return { atribuicao: a, rotulo: a ? ROTULO_FONTE[a.fonte] : c.origem ?? 'Desconhecida', campanha, criativo };
  }

  /** Leads por fonte e por campanha no período (painel de rastreabilidade). */
  @Get('atribuicao/resumo')
  async resumo(@TenantId() t: string, @Query('dias') dias?: string) {
    const d = Math.max(1, Math.min(365, Number(dias) || 30));
    const [porFonte, porCampanha] = await this.prisma.withTenant(t, (tx) => Promise.all([
      tx.$queryRaw<{ fonte: string; confianca: string; leads: number }[]>`
        SELECT coalesce(atribuicao->>'fonte', 'sem_registro') AS fonte, coalesce(atribuicao->>'confianca', 'desconhecida') AS confianca, count(*)::int AS leads
        FROM contacts WHERE created_at > now() - make_interval(days => ${d}::int) GROUP BY 1, 2 ORDER BY 3 DESC`,
      tx.$queryRaw<{ campanha: string; criativo: string | null; leads: number }[]>`
        SELECT coalesce(atribuicao->>'campanha', atribuicao->>'anuncio', atribuicao->>'adId') AS campanha, atribuicao->>'criativo' AS criativo, count(*)::int AS leads
        FROM contacts WHERE created_at > now() - make_interval(days => ${d}::int) AND atribuicao->>'fonte' = 'meta_ads'
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`,
    ]));
    return { periodoDias: d, porFonte, porCampanha };
  }

  /** Preenche a origem dos contatos antigos pelo que o CRM já sabe (tag, Lead Ads, canal). */
  @Post('atribuicao/backfill')
  @HttpCode(200)
  backfill(@TenantId() t: string) {
    return this.atribuicao.backfill(t);
  }
}
