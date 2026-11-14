import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventsService } from '../../../events/domain-events.service';
import type { Rede } from './canais.tipos';
import type { EventoCanal } from './meta-canais.parse';
import type { CredencialCanal } from './canais.tipos';
import { Logger } from '@nestjs/common';
import { CryptoService } from '../../../integrations/crypto.service';
import { AtribuicaoService } from '../../atribuicao.service';
import { toqueDeReferralMeta } from '../../atribuicao';
import { AvatarContatoService } from '../avatar-contato.service';
import { horaCurta } from '../../../common/hora';

/** Entrada já normalizada (DM ou comentário), de qualquer rede. */
export interface EntradaCanal {
  tenantId: string;
  rede: Rede;
  /** Valor de `conversations.canal`. */
  canal: string;
  tipo: 'dm' | 'comentario';
  conexaoId: string | null;
  autorId: string;
  autorNome?: string;
  texto: string;
  /** Id único do evento na rede (mid / comment id): idempotência. */
  idExterno: string;
  /** Comentário: id do comentário raiz (agrupa respostas no mesmo fio). */
  fioId?: string;
  origem?: Record<string, string | undefined>;
  recebidoEm?: Date;
}

export type ResultadoEntrada = { duplicada: true } | { duplicada: false; conversationId: string; messageId: string; contatoNovo: boolean };

/** Chave da conversa na rede: DM é por pessoa; comentário é por fio. Prefixo evita colisão entre os dois. */
export function chaveConversa(e: Pick<EntradaCanal, 'tipo' | 'autorId' | 'fioId' | 'idExterno'>): string {
  return e.tipo === 'dm' ? `dm:${e.autorId}` : `c:${e.fioId ?? e.idExterno}`;
}

function nomePadrao(e: Pick<EntradaCanal, 'canal' | 'autorId' | 'autorNome'>): string {
  const n = e.autorNome?.trim();
  if (n) return n.slice(0, 160);
  return `Contato do ${e.canal} ${e.autorId.slice(-4)}`;
}

/**
 * Entrada de DM e comentário (Instagram, Messenger, Facebook, YouTube) no
 * MESMO `conversations`/`messages` do WhatsApp, com o canal certo.
 *
 * Idempotente: `webhook_events (provider='canal:<rede>', event_id='<tenant>:<id>')`
 * é reservado ANTES de qualquer escrita, na mesma transação. Reentrega do
 * webhook ou sincronização repetida do YouTube devolvem `duplicada` sem tocar
 * em nada. A conversa é única por (tenant, canal, externo_id) no banco
 * (db/063), e o lock por chave impede duas criações concorrentes.
 *
 * Conversa nova nasce com atendimento HUMANO: o runtime dos agentes de IA só
 * responde pelo WhatsApp hoje; ligar a IA aqui seria prometer resposta que não sai.
 */
@Injectable()
export class CanaisIngestaoService {
  private readonly log = new Logger('CanaisIngestao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
    private readonly atribuicao?: AtribuicaoService,
    private readonly avatares?: AvatarContatoService,
    private readonly crypto?: CryptoService,
  ) {}

  /**
   * Evento do webhook da Meta (chega sem tenant): `resolve_tenant_by_canal`
   * (SECURITY DEFINER, db/063) acha o dono pela conta que recebeu. Conta não
   * conectada em nenhum tenant = `sem_tenant` (descartado, sem escrita).
   */
  async receberDaMeta(ev: EventoCanal): Promise<ResultadoEntrada | { semTenant: true }> {
    const rows = await this.prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_by_canal(${ev.rede}, ${ev.contaId}) AS tenant_id`;
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) return { semTenant: true };
    const conexao = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findFirst({ where: { rede: ev.rede, externalId: ev.contaId }, select: { id: true } }));
    const r = await this.receber({
      tenantId, rede: ev.rede, canal: ev.canal, tipo: ev.tipo, conexaoId: conexao?.id ?? null,
      autorId: ev.autorId, autorNome: ev.autorNome, texto: ev.texto, idExterno: ev.idExterno, fioId: ev.fioId,
      origem: ev.origem, recebidoEm: ev.recebidoEm,
    });
    if (!r.duplicada) {
      // Depois do lead já estar na tela: origem (anúncio ou direto) e foto/nome do perfil.
      void this.depoisDaEntrada(tenantId, r.conversationId, ev, conexao?.id ?? null).catch((e: Error) => this.log.warn(`pós-entrada (${ev.canal}) falhou: ${e.message.slice(0, 160)}`));
    }
    return r;
  }

  private async depoisDaEntrada(tenantId: string, conversationId: string, ev: EventoCanal, conexaoId: string | null) {
    const alvo = await this.prisma.withTenant(tenantId, (tx) => tx.conversation.findUnique({ where: { id: conversationId }, select: { contact: { select: { id: true, nome: true, fotoUrl: true, fotoEm: true } } } }));
    const contato = alvo?.contact;
    if (!contato) return;
    if (ev.canal !== 'Facebook') await this.atribuicao?.registrar(tenantId, contato.id, toqueDeReferralMeta(ev.canal, ev.anuncio, ev.recebidoEm));
    // Foto e nome do Instagram: rota oficial do perfil por IGSID (Messenger Platform,
    // "Instagram User Profile": GET /{IGSID}?fields=name,username,profile_pic, token da página).
    // A URL da foto expira em poucos dias: guardamos a IMAGEM (db/066).
    if (ev.rede !== 'instagram' || ev.tipo !== 'dm' || !conexaoId || !this.crypto || !this.avatares) return;
    if (contato.fotoUrl?.startsWith('/api/fotos/') && contato.fotoEm && Date.now() - contato.fotoEm.getTime() < 3 * 86400_000) return;
    const cred = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id: conexaoId }, select: { credentialsEncrypted: true } }));
    if (!cred?.credentialsEncrypted) return;
    const token = this.crypto.decryptJson<CredencialCanal>(cred.credentialsEncrypted).accessToken;
    const url = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v21.0'}/${encodeURIComponent(ev.autorId)}`);
    url.searchParams.set('fields', 'name,username,profile_pic');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const p = (await res.json().catch(() => ({}))) as { name?: string; username?: string; profile_pic?: string; error?: { message?: string } };
    if (!res.ok || p.error) { this.log.warn(`perfil do Instagram indisponível: ${p.error?.message ?? res.status}`); return; }
    if (p.profile_pic) await this.avatares.guardarDeUrl(tenantId, contato.id, p.profile_pic, 'instagram');
    const nome = p.name?.trim() || (p.username ? `@${p.username}` : '');
    // Só troca o nome provisório ("Contato do Instagram 1234"), nunca um nome que a equipe já editou.
    if (nome && /^Contato do (Instagram|Messenger)/.test(contato.nome)) {
      await this.prisma.withTenant(tenantId, (tx) => tx.contact.update({ where: { id: contato.id }, data: { nome: nome.slice(0, 160) } }));
    }
  }

  async receber(e: EntradaCanal): Promise<ResultadoEntrada> {
    const externo = chaveConversa(e);
    const previa = e.texto.slice(0, 140);
    const r = await this.prisma.withTenant(e.tenantId, async (tx) => {
      const nova = await tx.$executeRaw`INSERT INTO webhook_events (tenant_id, provider, event_id, payload, processed_at)
        VALUES (${e.tenantId}::uuid, ${'canal:' + e.rede}, ${e.tenantId + ':' + e.idExterno}, '{}', now())
        ON CONFLICT (provider, event_id) DO NOTHING`;
      if (!nova) return { duplicada: true as const };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${e.tenantId + ':' + e.canal + ':' + externo}, 0))`;
      // Hora REAL do evento na rede (comentário antigo do YouTube, DM que a Meta
      // reentrega): é ela que a tela mostra. Data no futuro (relógio torto) cai para agora.
      const quando = e.recebidoEm && e.recebidoEm.getTime() <= Date.now() + 60_000 ? e.recebidoEm : new Date();
      const hora = horaCurta(quando);
      let conv = await tx.conversation.findFirst({ where: { canal: e.canal, externoId: externo }, select: { id: true, contactId: true, naoLidas: true } });
      let contatoNovo = false;
      let contato: { id: string; nome: string } | null = null;
      if (!conv) {
        contato = await tx.contact.create({
          data: { tenantId: e.tenantId, nome: nomePadrao(e), tag: 'Lead', origem: e.canal, ultimoContatoAt: new Date(), lastInboundAt: new Date() },
          select: { id: true, nome: true },
        });
        contatoNovo = true;
        conv = await tx.conversation.create({
          data: {
            tenantId: e.tenantId, contactId: contato.id, nome: contato.nome, canal: e.canal, tipo: e.tipo, externoId: externo,
            canalConexaoId: e.conexaoId, ...(e.origem ? { contextoExterno: e.origem as Prisma.InputJsonValue } : {}),
            ultimaPrevia: previa, ultimaHora: hora, naoLidas: 1, atendimento: 'humano',
          },
          select: { id: true, contactId: true, naoLidas: true },
        });
      } else {
        // Mensagem nova reabre conversa resolvida.
        conv = await tx.conversation.update({
          where: { id: conv.id },
          data: { ultimaPrevia: previa, ultimaHora: hora, naoLidas: { increment: 1 }, status: 'aberta', updatedAt: new Date() },
          select: { id: true, contactId: true, naoLidas: true },
        });
        if (conv.contactId) await tx.contact.update({ where: { id: conv.contactId }, data: { lastInboundAt: new Date(), ultimoContatoAt: new Date() } });
      }
      const msg = await tx.message.create({
        data: { tenantId: e.tenantId, conversationId: conv.id, autorTipo: 'contato', corpo: e.texto, hora, providerId: e.idExterno, createdAt: quando },
        select: { id: true },
      });
      return { duplicada: false as const, conversationId: conv.id, messageId: msg.id, contatoNovo, contato, hora, naoLidas: conv.naoLidas };
    });
    if (r.duplicada) return r;
    this.eventos.publicar(e.tenantId, 'message.created', { conversationId: r.conversationId, id: r.messageId, de: 'contato', texto: e.texto, hora: r.hora });
    this.eventos.publicar(e.tenantId, 'conversation.updated', { id: r.conversationId, ultimaPrevia: previa, ultimaHora: r.hora, naoLidas: r.naoLidas });
    if (r.contatoNovo && r.contato) this.eventos.publicar(e.tenantId, 'contact.created', { id: r.contato.id, nome: r.contato.nome, origem: e.canal });
    return { duplicada: false, conversationId: r.conversationId, messageId: r.messageId, contatoNovo: r.contatoNovo };
  }
}
