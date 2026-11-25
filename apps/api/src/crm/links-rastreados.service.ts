import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StevoApiProvider } from './messaging/stevo-api.provider';
import { EvolutionProvider } from './messaging/evolution.provider';
import { OpenWaProvider } from './messaging/openwa/openwa.provider';
import {
  limparOpcional, montarUrlWhatsapp, slugCodigo, validarCampanha, validarCodigo, validarFonte, validarTextoInicial,
  type FonteLink,
} from './links-rastreados';

const MAX_CODIGO_TENTATIVAS = 20;

export interface LinkRastreadoDto {
  id: string;
  codigo: string;
  campanha: string;
  fonte: string;
  conjunto: string | null;
  criativo: string | null;
  textoInicial: string;
  ativo: boolean;
  /** Contatos cuja atribuição (db/066) veio deste link (sinal + cliqueId). */
  leads: number;
  /** wa.me com o texto inicial; null quando o tenant não tem número conectado. */
  urlWhatsapp: string | null;
  /** Por que `urlWhatsapp` veio null (sem instância conectada, número indisponível…). */
  aviso: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CriarLinkInput {
  campanha: string;
  fonte: string;
  textoInicial: string;
  codigo?: string;
  conjunto?: string | null;
  criativo?: string | null;
}

export interface AtualizarLinkInput {
  campanha?: string;
  fonte?: string;
  textoInicial?: string;
  conjunto?: string | null;
  criativo?: string | null;
  ativo?: boolean;
}

interface LinhaLink {
  id: string;
  codigo: string;
  campanha: string;
  fonte: string;
  conjunto: string | null;
  criativo: string | null;
  textoInicial: string;
  ativo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Links rastreados de WhatsApp por campanha (db/080). O CRUD é só CRUD; a
 * inteligência fica em `links-rastreados.ts` (puras) e o casamento na entrada
 * mora no MessagesService (1 query extra, só para contato novo).
 *
 * Auditoria: o AuditInterceptor já grava toda mutação autenticada
 * (entidade `links-rastreados`) — mesmo padrão do catálogo de motivos (Q2.1).
 */
@Injectable()
export class LinksRastreadosService {
  private readonly log = new Logger('LinksRastreados');

  constructor(
    private readonly prisma: PrismaService,
    // Opcionais para os specs montarem o serviço à mão; no Nest sempre existem.
    @Optional() private readonly stevoApi?: StevoApiProvider,
    @Optional() private readonly evolution?: EvolutionProvider,
    @Optional() private readonly openwa?: OpenWaProvider,
  ) {}

  async listar(tenantId: string): Promise<LinkRastreadoDto[]> {
    const [links, contagens, numero] = await Promise.all([
      this.prisma.withTenant(tenantId, (tx) => tx.linkRastreado.findMany({ orderBy: { createdAt: 'desc' } })),
      this.contagemLeads(tenantId),
      this.numeroDoTenant(tenantId),
    ]);
    return links.map((l) => this.apresentar(l, contagens.get(l.codigo) ?? 0, numero));
  }

  async criar(tenantId: string, input: CriarLinkInput, actorId?: string): Promise<LinkRastreadoDto> {
    const campanha = validarCampanha(input.campanha);
    const fonte = validarFonte(input.fonte);
    const textoInicial = validarTextoInicial(input.textoInicial);
    const conjunto = limparOpcional(input.conjunto);
    const criativo = limparOpcional(input.criativo);
    const base = input.codigo ? validarCodigo(input.codigo) : slugCodigo(campanha);
    const link = await this.prisma.withTenant(tenantId, async (tx) => {
      for (let i = 0; i < MAX_CODIGO_TENTATIVAS; i++) {
        const codigo = i === 0 ? base : `${base.slice(0, 57)}-${i + 1}`;
        const ocupado = await tx.linkRastreado.findFirst({ where: { codigo }, select: { id: true } });
        if (ocupado) continue;
        return tx.linkRastreado.create({
          data: { tenantId, codigo, campanha, fonte, textoInicial, conjunto, criativo, createdBy: actorId ?? null },
        });
      }
      throw new ConflictException(`código "${base}" e variações já estão em uso; informe outro código`);
    });
    const numero = await this.numeroDoTenant(tenantId);
    return this.apresentar(link, 0, numero);
  }

  async atualizar(tenantId: string, id: string, input: AtualizarLinkInput): Promise<LinkRastreadoDto> {
    const link = await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.linkRastreado.findUnique({ where: { id }, select: { id: true } });
      if (!atual) throw new NotFoundException('link rastreado inexistente');
      // Código é imutável: ele já circula impresso nos anúncios. Outro código = outro link.
      return tx.linkRastreado.update({
        where: { id },
        data: {
          ...(input.campanha !== undefined ? { campanha: validarCampanha(input.campanha) } : {}),
          ...(input.fonte !== undefined ? { fonte: validarFonte(input.fonte) } : {}),
          ...(input.textoInicial !== undefined ? { textoInicial: validarTextoInicial(input.textoInicial) } : {}),
          ...(input.conjunto !== undefined ? { conjunto: limparOpcional(input.conjunto) } : {}),
          ...(input.criativo !== undefined ? { criativo: limparOpcional(input.criativo) } : {}),
          ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
          updatedAt: new Date(),
        },
      });
    });
    const [leads, numero] = await Promise.all([this.contagemLeads(tenantId), this.numeroDoTenant(tenantId)]);
    return this.apresentar(link, leads.get(link.codigo) ?? 0, numero);
  }

  async remover(tenantId: string, id: string) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.linkRastreado.findUnique({ where: { id }, select: { id: true } });
      if (!atual) throw new NotFoundException('link rastreado inexistente');
      // A atribuição dos leads que já entraram fica gravada no contato (db/066);
      // apagar o link não apaga o histórico — só para de casar daqui pra frente.
      await tx.linkRastreado.delete({ where: { id } });
    });
    return { ok: true };
  }

  /** leads por código: sinal 'link_rastreado' + cliqueId = codigo (db/066 × db/080). */
  private async contagemLeads(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{ codigo: string; total: number }[]>`
      SELECT atribuicao->>'cliqueId' AS codigo, count(*)::int AS total
      FROM contacts
      WHERE atribuicao->>'sinal' = 'link_rastreado'
      GROUP BY 1`);
    return new Map(rows.map((r) => [r.codigo, r.total]));
  }

  /**
   * Número do WhatsApp conectado do tenant (mesma régua do envio: instância
   * Stevo vinculada vence; senão Evolution). Nunca lança: sem número, o link
   * ainda existe — só a URL wa.me fica null com o motivo em `aviso`.
   */
  private async numeroDoTenant(tenantId: string): Promise<{ numero: string | null; aviso: string | null }> {
    try {
      const integ = await this.prisma.withTenant(tenantId, async (tx) => {
        // Mesma ordem do envio (ADR-0058): open-wa conectado → Stevo → Evolution.
        const openwa = await tx.integration.findFirst({ where: { provider: 'openwa', status: 'connected' }, select: { provider: true, externalBusinessId: true } });
        if (openwa) return openwa;
        const stevo = await tx.integration.findFirst({ where: { provider: 'stevo_api', status: 'connected' }, select: { provider: true, externalBusinessId: true } });
        return stevo ?? tx.integration.findFirst({ where: { provider: 'evolution', status: 'connected' }, select: { provider: true, externalBusinessId: true } });
      });
      if (!integ?.externalBusinessId) {
        return { numero: null, aviso: 'nenhum WhatsApp conectado nesta subconta — conecte uma instância para o link wa.me ser montado' };
      }
      const numero = integ.provider === 'openwa'
        ? (await this.openwa?.estado(integ.externalBusinessId))?.numero ?? null
        : integ.provider === 'stevo_api'
        ? (await this.stevoApi?.conexao(integ.externalBusinessId))?.phone_number ?? null
        : (await this.evolution?.getConnectionState(integ.externalBusinessId))?.numero ?? null;
      return numero
        ? { numero, aviso: null }
        : { numero: null, aviso: 'a instância conectada não informou o número agora; tente recarregar em instantes' };
    } catch (e) {
      this.log.warn(`número do WhatsApp do tenant não resolvido: ${(e as Error).message.slice(0, 160)}`);
      return { numero: null, aviso: 'não foi possível consultar o número da instância agora; tente recarregar em instantes' };
    }
  }

  private apresentar(link: LinhaLink, leads: number, numero: { numero: string | null; aviso: string | null }): LinkRastreadoDto {
    const url = numero.numero ? montarUrlWhatsapp(numero.numero, link.textoInicial) : null;
    return {
      id: link.id,
      codigo: link.codigo,
      campanha: link.campanha,
      fonte: link.fonte as FonteLink,
      conjunto: link.conjunto,
      criativo: link.criativo,
      textoInicial: link.textoInicial,
      ativo: link.ativo,
      leads,
      urlWhatsapp: url,
      aviso: url ? null : numero.aviso ?? 'número da instância indisponível para montar o link wa.me',
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}
