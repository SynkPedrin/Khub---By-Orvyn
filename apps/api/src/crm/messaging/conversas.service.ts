import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { CANAIS, condicaoStatus, etiquetasDoContato, whereConversas, type FiltroConversas } from './conversas-filtro';
import { previaLegivel } from './formato-lista-ghl';

/** Teto da lista: a tela pagina por rolagem do lado do cliente; 500 cobre o uso real (405 conversas no maior cliente). */
const LIMITE_LISTA = 500;

export interface ContagensConversas {
  total: number;
  canais: Record<string, number>;
  status: { todas: number; nao_lidas: number; em_atendimento: number; aguardando: number; resolvidas: number };
  etiquetas: { nome: string; cor: string | null; total: number }[];
  /** Redes com conta conectada (WhatsApp via integrations; demais via channel_connections). */
  conectados: string[];
}

/** Rede (channel_connections.rede) → valor de `conversations.canal`. */
export const CANAL_DA_REDE: Record<string, string> = { instagram: 'Instagram', messenger: 'Messenger', youtube: 'YouTube', tiktok: 'TikTok' };

/**
 * Lista filtrada, contagens e "Marcar como" da tela de Conversas (desenho do
 * mockup da LP). Tudo sob `withTenant`: o RLS decide o tenant.
 */
@Injectable()
export class ConversasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  async listar(tenantId: string, f: FiltroConversas) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM conversations c
          LEFT JOIN contacts ct ON ct.id = c.contact_id
         WHERE ${whereConversas(f)}
         ORDER BY c.updated_at DESC
         LIMIT ${LIMITE_LISTA}`;
      if (!ids.length) return [];
      const rows = await tx.conversation.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        orderBy: { updatedAt: 'desc' },
        include: { contact: { select: { id: true, telefone: true, email: true, fotoUrl: true, empresa: true, tag: true, tags: true } } },
      });
      // Quem tem foto durável (1 query na página): a tela só chama /api/fotos
      // para esses — sem flag, cada avatar de contato sem foto gerava um 404.
      const idsContatos = rows.map((r) => r.contact?.id).filter((v): v is string => !!v);
      const comFoto = new Set(
        idsContatos.length
          ? (await tx.contactFoto.findMany({ where: { contactId: { in: idsContatos } }, select: { contactId: true } })).map((f) => f.contactId)
          : [],
      );
      return rows.map((c) => ({
        id: c.id, nome: c.nome, canal: c.canal, tipo: c.tipo, status: c.status,
        ultimaPrevia: c.ultimaPrevia ? previaLegivel(c.ultimaPrevia) : c.ultimaPrevia, naoLidas: c.naoLidas, ultimaHora: c.ultimaHora,
        atendimento: c.atendimento, agentId: c.agentId, assigneeId: c.assigneeId, handoffMotivo: c.handoffMotivo,
        atualizadaEm: c.updatedAt.toISOString(),
        etiquetas: etiquetasDoContato(c.contact),
        contextoExterno: c.contextoExterno ?? null,
        contato: c.contact ? { id: c.contact.id, telefone: c.contact.telefone, email: c.contact.email, fotoUrl: c.contact.fotoUrl, empresa: c.contact.empresa, temFoto: comFoto.has(c.contact.id) } : null,
        mensagens: [] as { id: string; de: string; texto: string; hora: string | null; status: string; agentId: string | null }[],
      }));
    });
  }

  /** Endpoint LEVE: só números (sem linhas), para a coluna Canais/Status/Etiquetas. */
  async contagens(tenantId: string): Promise<ContagensConversas> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [status] = await tx.$queryRaw<ContagensConversas['status'][]>`
        SELECT count(*)::int AS todas,
               count(*) FILTER (WHERE ${condicaoStatus('nao_lidas')})::int AS nao_lidas,
               count(*) FILTER (WHERE ${condicaoStatus('em_atendimento')})::int AS em_atendimento,
               count(*) FILTER (WHERE ${condicaoStatus('aguardando')})::int AS aguardando,
               count(*) FILTER (WHERE ${condicaoStatus('resolvidas')})::int AS resolvidas
          FROM conversations c`;
      const porCanal = await tx.$queryRaw<{ canal: string; total: number }[]>`
        SELECT c.canal, count(*)::int AS total FROM conversations c GROUP BY c.canal`;
      const porEtiqueta = await tx.$queryRaw<{ nome: string; total: number }[]>`
        SELECT min(t) AS nome, count(DISTINCT c.id)::int AS total
          FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          CROSS JOIN LATERAL unnest(array_prepend(ct.tag, ct.tags)) AS t
         WHERE btrim(coalesce(t, '')) <> ''
         GROUP BY lower(t)
         ORDER BY total DESC, nome
         LIMIT 30`;
      const nomes = porEtiqueta.map((e) => e.nome);
      const cores = nomes.length
        ? await tx.crmTag.findMany({ where: { name: { in: nomes, mode: 'insensitive' } }, select: { name: true, color: true } })
        : [];
      const cor = new Map(cores.map((t) => [t.name.toLowerCase(), t.color]));
      const [whats, redes] = await Promise.all([
        tx.integration.count({ where: { provider: { in: ['stevo_api', 'evolution'] }, status: 'connected' } }),
        tx.channelConnection.findMany({ where: { status: 'conectado' }, select: { rede: true }, distinct: ['rede'] }),
      ]);
      const canais: Record<string, number> = Object.fromEntries(CANAIS.map((c) => [c, 0]));
      for (const r of porCanal) canais[r.canal] = r.total;
      return {
        total: status?.todas ?? 0,
        canais,
        status: status ?? { todas: 0, nao_lidas: 0, em_atendimento: 0, aguardando: 0, resolvidas: 0 },
        etiquetas: porEtiqueta.map((e) => ({ nome: e.nome, cor: cor.get(e.nome.toLowerCase()) ?? null, total: e.total })),
        conectados: [...(whats ? ['WhatsApp'] : []), ...redes.map((r) => CANAL_DA_REDE[r.rede]).filter(Boolean)],
      };
    });
  }

  /**
   * "Marcar como": resolvida, aberta (reabrir) ou não lida. Resolver não
   * apaga nada; a próxima mensagem do cliente reabre a conversa
   * (`CanaisIngestaoService` e o fluxo do WhatsApp atualizam `updated_at`;
   * reabrir explícito é por aqui).
   */
  async marcar(tenantId: string, id: string, acao: 'resolvida' | 'aberta' | 'nao_lida', identityId: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id }, select: { id: true, status: true, naoLidas: true } });
      if (!conv) throw new NotFoundException('conversa inexistente');
      const data: Prisma.ConversationUpdateInput =
        acao === 'resolvida' ? { status: 'resolvida', naoLidas: 0 }
        : acao === 'aberta' ? { status: 'aberta' }
        : acao === 'nao_lida' ? { naoLidas: Math.max(conv.naoLidas, 1), status: 'aberta' }
        : (() => { throw new BadRequestException('ação inválida'); })();
      const nova = await tx.conversation.update({ where: { id }, data, select: { id: true, status: true, naoLidas: true } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'conversa.marcada', 'conversation', ${id}, ${JSON.stringify({ acao, antes: conv.status })}::jsonb)`;
      return nova;
    });
    this.eventos.publicar(tenantId, 'conversation.updated', { id: r.id, naoLidas: r.naoLidas });
    return r;
  }
}
