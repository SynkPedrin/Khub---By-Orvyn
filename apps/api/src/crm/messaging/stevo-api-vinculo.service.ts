import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StevoApiProvider } from './stevo-api.provider';
import { type ConexaoWhatsApp, type EstadoWhatsApp } from './whatsapp-connection.service';

/**
 * Vínculo instância Stevo ⇄ subconta (tenant) — RV-06 / doc 18 §12.3.
 *
 * Duas pontas, nesta ordem:
 *  1. `external_ref` da instância na Stevo = tenantId (o webhook confere: evento
 *     com external_ref divergente é descartado);
 *  2. linha em `integrations` (provider `stevo_api`) no tenant — é ela que o
 *     roteamento (db/032) e o envio por tenant usam.
 * O índice único de db/032 impede a mesma instância ativa em dois tenants.
 */
@Injectable()
export class StevoApiVinculoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stevo: StevoApiProvider,
  ) {}

  async vincular(tenantId: string, instanciaId: string, actorIdentityId: string) {
    const inst = await this.stevo.obterInstancia(instanciaId);
    if (inst.external_ref && inst.external_ref !== tenantId) {
      throw new ConflictException('instância já vinculada a outra subconta na Stevo (external_ref) — desvincule lá primeiro');
    }
    const ja = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_by_stevo_api_instance(${instanciaId}) AS tenant_id`;
    if (ja[0]?.tenant_id && ja[0].tenant_id !== tenantId) throw new ConflictException('instância já vinculada a outra subconta no KHUB');

    const conexao = await this.stevo.conexao(instanciaId);
    if (inst.external_ref !== tenantId) await this.stevo.definirExternalRef(instanciaId, tenantId);

    // `connected` = instância ligada ao servidor; `logged_in` = WhatsApp PAREADO.
    // Só os dois juntos enviam e recebem (instância sem login respondia connected:true).
    const pareada = conexao.connected && conexao.logged_in;
    const status = pareada ? 'connected' : 'disconnected';
    const integ = await this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.integration.upsert({
        where: { tenantId_provider_externalBusinessId: { tenantId, provider: 'stevo_api', externalBusinessId: instanciaId } },
        create: { tenantId, provider: 'stevo_api', externalBusinessId: instanciaId, status, health: pareada ? 'ok' : 'error', scopes: [], connectedBy: actorIdentityId, connectedAt: new Date(), lastSyncAt: new Date() },
        update: { status, health: pareada ? 'ok' : 'error', erro: pareada ? null : 'WhatsApp não pareado (logged_in=false)', lastSyncAt: new Date(), updatedAt: new Date() },
        select: { id: true, status: true },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${actorIdentityId}, 'integracao.stevo_api.vinculada', 'integration', ${r.id}, ${JSON.stringify({ instanciaId, nome: inst.name, pareada })}::jsonb)`;
      return r;
    });
    return { integracaoId: integ.id, status: integ.status, instancia: { id: inst.id, nome: inst.name, perfil: inst.profile_name } };
  }

  /** Instância Stevo vinculada a este tenant (não revogada), ou `null` se nenhuma. */
  private async instancia(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { tenantId, provider: 'stevo_api', status: { not: 'revoked' } } }),
    );
  }

  /**
   * Estado real do WhatsApp via Stevo — mesmo contrato de `WhatsAppConnectionService`
   * (Evolution), para o front usar os dois providers de forma transparente.
   * Sempre pergunta à Stevo (nunca confia só no `status` persistido).
   */
  async status(tenantId: string, incluirQr = false): Promise<ConexaoWhatsApp> {
    const integ = await this.instancia(tenantId);
    if (!integ?.externalBusinessId) return { estado: 'desconectado', atualizadoEm: new Date().toISOString() };

    const conexao = await this.stevo.conexao(integ.externalBusinessId);
    const pareada = conexao.connected && conexao.logged_in;
    const estado: EstadoWhatsApp = pareada ? 'conectado' : 'desconectado';

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({
        where: { tenantId, provider: 'stevo_api', externalBusinessId: integ.externalBusinessId },
        data: { status: pareada ? 'connected' : 'disconnected', health: pareada ? 'ok' : 'error', erro: pareada ? null : 'WhatsApp não pareado (logged_in=false)', lastSyncAt: new Date() },
      }),
    );

    const qr = incluirQr && !pareada ? await this.qrNormalizado(integ.externalBusinessId) : undefined;
    return { estado: qr ? 'aguardando_qr' : estado, numero: conexao.phone_number ?? undefined, qr, atualizadoEm: new Date().toISOString() };
  }

  /** "Conectar": busca o QR atual da instância já vinculada; força um novo se não houver. */
  async conectar(tenantId: string): Promise<ConexaoWhatsApp> {
    const integ = await this.instancia(tenantId);
    if (!integ?.externalBusinessId) throw new BadRequestException('nenhuma instância Stevo vinculada a esta subconta — vincule uma instância primeiro');

    let qr = await this.qrNormalizado(integ.externalBusinessId);
    if (!qr) {
      const r = await this.stevo.atualizarQrCode(integ.externalBusinessId);
      if (r.qr) qr = { qrImageDataUrl: r.qr, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    }
    if (!qr) return this.status(tenantId); // sem QR novo: já pode ter pareado nesse meio tempo
    return { estado: 'aguardando_qr', qr, atualizadoEm: new Date().toISOString() };
  }

  private async qrNormalizado(instanciaId: string) {
    const r = await this.stevo.obterQrCode(instanciaId);
    return r.qr ? { qrImageDataUrl: r.qr, expiresAt: new Date(Date.now() + 60_000).toISOString() } : undefined;
  }

  async desvincular(tenantId: string, instanciaId: string, actorIdentityId: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.integration.updateMany({ where: { provider: 'stevo_api', externalBusinessId: instanciaId, status: { not: 'revoked' } }, data: { status: 'revoked', updatedAt: new Date() } });
      if (!u.count) throw new BadRequestException('instância não está vinculada a esta subconta');
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${actorIdentityId}, 'integracao.stevo_api.desvinculada', 'integration', ${instanciaId}, '{}'::jsonb)`;
      return u.count;
    });
    await this.stevo.definirExternalRef(instanciaId, null);
    return { desvinculadas: r };
  }
}
