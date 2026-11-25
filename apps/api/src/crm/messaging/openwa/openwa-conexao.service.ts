import { ConflictException, GoneException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '../../../config/config.service';
import { PublicRateLimiter } from '../../../common/public-request';
import { OpenWaProvider, GatewayError, sessaoDoTenant, type EstadoGateway } from './openwa.provider';
import { OpenWaHistoricoService } from './openwa-historico.service';

export const VALIDADE_LINK_DIAS = 7;
const MAX_LINKS_ATIVOS = 10;

const hashDoToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Número mascarado para a página pública (quem tem o link não precisa ver o número inteiro). */
export const mascarar = (n?: string | null) => (n && n.length > 6 ? `${n.slice(0, 4)}••••${n.slice(-4)}` : n ?? null);

export interface LinkConexao {
  id: string;
  expiraEm: string;
  criadoEm: string;
  conectadoEm: string | null;
  numero: string | null;
  revogadoEm: string | null;
  acessos: number;
  situacao: 'ativo' | 'expirado' | 'revogado';
}

/**
 * WhatsApp por QR Code próprio (open-wa, ADR-0058): conectar pelo painel,
 * link público de 7 dias para o cliente conectar sozinho, desconectar e
 * pedir o histórico. O estado é SEMPRE o do gateway (nunca só o do banco).
 */
@Injectable()
export class OpenWaConexaoService {
  private readonly log = new Logger('OpenWaConexao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: OpenWaProvider,
    private readonly historico: OpenWaHistoricoService,
    private readonly config: ConfigService,
    private readonly limite: PublicRateLimiter,
  ) {}

  private gatewayIndisponivel(e: unknown): never {
    if (e instanceof GatewayError && e.status === 409) throw new ConflictException('O WhatsApp não está conectado no servidor. Conecte de novo e tente outra vez.');
    if (e instanceof GatewayError && e.status === 429) throw new ServiceUnavailableException('O servidor de WhatsApp chegou ao limite de números conectados. Fale com o suporte.');
    this.log.warn(`gateway open-wa: ${(e as Error).message.slice(0, 120)}`);
    throw new ServiceUnavailableException('O servidor de WhatsApp não respondeu. Tente de novo em instantes.');
  }

  /** Garante a integração `openwa` do tenant (uma sessão por tenant). */
  private async garantirIntegracao(tenantId: string, identityId: string | null) {
    const sessao = sessaoDoTenant(tenantId);
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.upsert({
        where: { tenantId_provider_externalBusinessId: { tenantId, provider: 'openwa', externalBusinessId: sessao } },
        create: { tenantId, provider: 'openwa', externalBusinessId: sessao, status: 'connecting', health: 'unknown', connectedBy: identityId },
        update: { status: 'connecting', erro: null, updatedAt: new Date() },
      }),
    );
    return sessao;
  }

  private async integracao(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.integration.findFirst({ where: { tenantId, provider: 'openwa', status: { not: 'revoked' } }, select: { externalBusinessId: true, status: true, lastSyncAt: true, connectedAt: true, erro: true } }));
  }

  /** Painel de Integrações: configuração, estado real, QR (se aguardando), histórico e links. */
  async painel(tenantId: string) {
    const configurado = this.provider.configured();
    const integ = await this.integracao(tenantId);
    let gw: EstadoGateway | null = null;
    let gatewayOk = true;
    if (configurado && integ?.externalBusinessId) {
      try {
        gw = await this.provider.estado(integ.externalBusinessId);
      } catch {
        gatewayOk = false;
      }
    }
    const [historico, links] = await Promise.all([this.historico.resumo(tenantId), this.listarLinks(tenantId)]);
    return {
      configurado,
      faltando: configurado ? [] : this.provider.missing(),
      gatewayOk,
      vinculado: !!integ,
      estado: gw?.estado ?? (integ ? 'desconectado' : 'nao_conectado'),
      qr: gw?.estado === 'aguardando_qr' ? gw.qr ?? null : null,
      numero: gw?.numero ?? null,
      nome: gw?.nome ?? null,
      fotoUrl: gw?.fotoUrl ?? null,
      conectadoDesde: integ?.connectedAt?.toISOString() ?? null,
      historico: { ...historico, sincronizadoEm: integ?.lastSyncAt?.toISOString() ?? null },
      links,
    };
  }

  async conectar(tenantId: string, identityId: string) {
    this.config.require('openwa');
    const sessao = await this.garantirIntegracao(tenantId, identityId);
    try {
      const gw = await this.provider.iniciar(sessao);
      await this.audit(tenantId, identityId, 'whatsapp_qr.conectar', sessao);
      return gw;
    } catch (e) {
      this.gatewayIndisponivel(e);
    }
  }

  async desconectar(tenantId: string, identityId: string) {
    const integ = await this.integracao(tenantId);
    if (!integ?.externalBusinessId) throw new NotFoundException('WhatsApp por QR Code não está conectado');
    try {
      await this.provider.encerrar(integ.externalBusinessId);
    } catch (e) {
      // Mesmo com o gateway fora, o vínculo é desfeito aqui: nada mais sai por ele.
      this.log.warn(`encerrar sessão falhou: ${(e as Error).message.slice(0, 120)}`);
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.integration.updateMany({ where: { tenantId, provider: 'openwa', status: { not: 'revoked' } }, data: { status: 'revoked', health: 'unknown', updatedAt: new Date() } });
      await tx.$executeRaw`UPDATE whatsapp_links_conexao SET revogado_em = now() WHERE revogado_em IS NULL AND expira_em > now()`;
    });
    await this.audit(tenantId, identityId, 'whatsapp_qr.desconectar', integ.externalBusinessId);
    return { ok: true };
  }

  async sincronizarHistorico(tenantId: string, identityId: string, dias = 90) {
    const integ = await this.integracao(tenantId);
    if (!integ?.externalBusinessId || integ.status !== 'connected') throw new NotFoundException('Conecte o WhatsApp antes de importar o histórico');
    try {
      const r = await this.provider.pedirHistorico(integ.externalBusinessId, { dias: Math.min(365, Math.max(1, Math.round(dias))) });
      await this.audit(tenantId, identityId, 'whatsapp_qr.historico', integ.externalBusinessId, { dias });
      return r;
    } catch (e) {
      this.gatewayIndisponivel(e);
    }
  }

  // ------------------------------------------------------------------ links

  /** O token só existe nesta resposta; o banco guarda o sha256. */
  async criarLink(tenantId: string, identityId: string) {
    this.config.require('openwa');
    await this.garantirIntegracaoSeAusente(tenantId, identityId);
    const token = randomBytes(32).toString('base64url');
    const expira = new Date(Date.now() + VALIDADE_LINK_DIAS * 24 * 3600_000);
    const id = await this.prisma.withTenant(tenantId, async (tx) => {
      const [{ ativos }] = await tx.$queryRaw<{ ativos: bigint }[]>`SELECT count(*)::bigint AS ativos FROM whatsapp_links_conexao WHERE revogado_em IS NULL AND expira_em > now()`;
      if (Number(ativos) >= MAX_LINKS_ATIVOS) throw new GoneException(`Já existem ${MAX_LINKS_ATIVOS} links ativos. Revogue um antes de criar outro.`);
      const [r] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO whatsapp_links_conexao (tenant_id, token_hash, criado_por, expira_em)
        VALUES (${tenantId}::uuid, ${hashDoToken(token)}, ${identityId}::uuid, ${expira}) RETURNING id`;
      return r.id;
    });
    await this.audit(tenantId, identityId, 'whatsapp_qr.link_criado', id, { expiraEm: expira.toISOString() });
    const web = (this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/+$/, '');
    return { id, url: `${web}/w/${token}`, expiraEm: expira.toISOString() };
  }

  /** Link criado antes de conectar: a integração já existe (o webhook do gateway só é aceito com ela). */
  private async garantirIntegracaoSeAusente(tenantId: string, identityId: string) {
    const integ = await this.integracao(tenantId);
    if (!integ) await this.garantirIntegracao(tenantId, identityId);
  }

  async listarLinks(tenantId: string): Promise<LinkConexao[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<{ id: string; expira_em: Date; created_at: Date; conectado_em: Date | null; numero: string | null; revogado_em: Date | null; acessos: number }[]>`
        SELECT id, expira_em, created_at, conectado_em, numero, revogado_em, acessos FROM whatsapp_links_conexao
        ORDER BY created_at DESC LIMIT 20`,
    );
    const agora = Date.now();
    return rows.map((r) => ({
      id: r.id,
      expiraEm: r.expira_em.toISOString(),
      criadoEm: r.created_at.toISOString(),
      conectadoEm: r.conectado_em?.toISOString() ?? null,
      numero: r.numero,
      revogadoEm: r.revogado_em?.toISOString() ?? null,
      acessos: r.acessos,
      situacao: r.revogado_em ? 'revogado' : r.expira_em.getTime() <= agora ? 'expirado' : 'ativo',
    }));
  }

  async revogarLink(tenantId: string, identityId: string, id: string) {
    const n = await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`UPDATE whatsapp_links_conexao SET revogado_em = now() WHERE id = ${id}::uuid AND revogado_em IS NULL`);
    if (!n) throw new NotFoundException('link inexistente ou já revogado');
    await this.audit(tenantId, identityId, 'whatsapp_qr.link_revogado', id);
    return { ok: true };
  }

  // -------------------------------------------------------- página pública

  private async resolver(token: string) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException('Link inválido');
    const [l] = await this.prisma.$queryRaw<{ tenant_id: string; link_id: string; tenant_nome: string; expira_em: Date; revogado_em: Date | null; conectado_em: Date | null }[]>`
      SELECT * FROM resolve_whatsapp_link(${hashDoToken(token)})`;
    if (!l) throw new NotFoundException('Link inválido');
    if (l.revogado_em) throw new GoneException('Este link foi cancelado. Peça um novo para quem enviou.');
    if (l.expira_em.getTime() <= Date.now()) throw new GoneException('Este link expirou. Peça um novo para quem enviou.');
    return l;
  }

  /** Estado para quem abriu o link. Primeiro acesso inicia a sessão (o QR aparece sozinho). */
  async verLink(token: string, ip: string) {
    await this.limite.consumir(`wa-link:${ip}`, 90, 60);
    const l = await this.resolver(token);
    const sessao = sessaoDoTenant(l.tenant_id);
    await this.prisma.withTenant(l.tenant_id, (tx) =>
      tx.$executeRaw`UPDATE whatsapp_links_conexao SET acessos = acessos + 1, ultimo_acesso_em = now()
        WHERE id = ${l.link_id}::uuid AND (ultimo_acesso_em IS NULL OR ultimo_acesso_em < now() - interval '5 minutes')`,
    );
    let gw: EstadoGateway | null;
    try {
      gw = await this.provider.estado(sessao);
      if (!gw || gw.estado === 'desconectado') {
        await this.garantirIntegracao(l.tenant_id, null);
        gw = await this.provider.iniciar(sessao);
      }
    } catch (e) {
      this.gatewayIndisponivel(e);
    }
    return {
      empresa: l.tenant_nome,
      expiraEm: l.expira_em.toISOString(),
      estado: gw.estado,
      qr: gw.estado === 'aguardando_qr' ? gw.qr ?? null : null,
      numero: gw.estado === 'conectado' ? mascarar(gw.numero) : null,
    };
  }

  /** "Gerar novo QR" na página pública (o anterior expirou ou a sessão caiu). */
  async reiniciarPeloLink(token: string, ip: string) {
    await this.limite.consumir(`wa-link-start:${ip}`, 10, 600);
    const l = await this.resolver(token);
    await this.garantirIntegracao(l.tenant_id, null);
    try {
      const gw = await this.provider.iniciar(sessaoDoTenant(l.tenant_id));
      return { estado: gw.estado, qr: gw.estado === 'aguardando_qr' ? gw.qr ?? null : null };
    } catch (e) {
      this.gatewayIndisponivel(e);
    }
  }

  private async audit(tenantId: string, identityId: string | null, acao: string, entidadeId: string, payload: Record<string, unknown> = {}) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${acao}, 'integration', ${entidadeId}, ${JSON.stringify(payload)}::jsonb)`,
    );
  }
}
