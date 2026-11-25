import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RealtimeService } from '../../../realtime/realtime.service';
import { MessagesService } from '../messages.service';
import { StevoApiEventosService } from '../stevo-api-eventos.service';
import { AvatarContatoService } from '../avatar-contato.service';
import { acharContatoPorTelefone } from '../../telefone';
import type { MidiaEntrada, TipoEntrada } from '../midia-entrada';
import { OpenWaProvider, sessaoDoTenant, type EstadoSessaoWa } from './openwa.provider';
import { OpenWaHistoricoService, corpoDaMensagem, type ChatHistorico } from './openwa-historico.service';

/** Evento do gateway já validado (envelope do CONTRATO.md §2). */
export interface EventoOpenWa {
  eventId: string;
  sessionId: string;
  tipo: string;
  dados: Record<string, unknown>;
}

const TIPOS_MIDIA: TipoEntrada[] = ['imagem', 'audio', 'video', 'documento', 'figurinha'];
const STATUS_ENTREGA: Record<string, 'sent' | 'delivered' | 'read'> = { enviado: 'sent', entregue: 'delivered', lido: 'read' };
const ORDEM: Record<string, number> = { sending: 1, pending: 1, unknown: 1, sent: 2, delivered: 3, read: 4 };
const STATUS_INTEGRACAO: Record<EstadoSessaoWa, string> = { conectado: 'connected', desconectado: 'disconnected', erro: 'error', iniciando: 'connecting', aguardando_qr: 'connecting' };

const texto = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const digitos = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '');

/**
 * Processa os eventos do wa-gateway (open-wa, ADR-0058). Mesmo caminho da
 * Stevo para mensagem ao vivo (receiveInbound / receberHumano: IA, automações,
 * atribuição e tempo real), e o importador para o histórico.
 */
@Injectable()
export class OpenWaEventosService {
  private readonly log = new Logger('OpenWaEventos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensagens: MessagesService,
    private readonly provider: OpenWaProvider,
    private readonly historico: OpenWaHistoricoService,
    @Optional() private readonly stevoEventos?: StevoApiEventosService,
    @Optional() private readonly avatares?: AvatarContatoService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async processar(tenantId: string, ev: EventoOpenWa): Promise<string> {
    switch (ev.tipo) {
      case 'sessao.estado':
        return this.estado(tenantId, ev);
      case 'mensagem':
        return this.mensagem(tenantId, ev.dados);
      case 'mensagem.status':
        return this.status(tenantId, ev.dados);
      case 'historico.lote':
        return this.lote(tenantId, ev.dados);
      case 'contato.foto':
        return this.foto(tenantId, digitos(ev.dados.numero), texto(ev.dados.fotoUrl, 2000));
      default:
        return 'ignorado';
    }
  }

  private async estado(tenantId: string, ev: EventoOpenWa): Promise<string> {
    const estado = ev.dados.estado as EstadoSessaoWa;
    if (!(estado in STATUS_INTEGRACAO)) return 'ignorado';
    const numero = digitos(ev.dados.numero) || null;
    const motivo = texto(ev.dados.motivo, 300) || null;
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const integ = await tx.integration.findFirst({ where: { tenantId, provider: 'openwa', externalBusinessId: ev.sessionId, status: { not: 'revoked' } }, select: { id: true, status: true, lastSyncAt: true } });
      if (!integ) return null;
      await tx.integration.update({
        where: { id: integ.id },
        data: {
          status: STATUS_INTEGRACAO[estado],
          health: estado === 'conectado' ? 'ok' : estado === 'erro' ? 'error' : 'unknown',
          erro: estado === 'conectado' ? null : motivo,
          ...(estado === 'conectado' && integ.status !== 'connected' ? { connectedAt: new Date() } : {}),
          updatedAt: new Date(),
        },
      });
      if (estado === 'conectado') {
        // O link usado (ainda válido) fica marcado como "conectado" com o número.
        await tx.$executeRaw`UPDATE whatsapp_links_conexao SET conectado_em = now(), numero = ${numero}
          WHERE conectado_em IS NULL AND revogado_em IS NULL AND expira_em > now()`;
      }
      const jaTemHistorico = await tx.message.findFirst({ where: { deliveryStatus: 'historico' }, select: { id: true } });
      return { pedirHistorico: estado === 'conectado' && !integ.lastSyncAt && !jaTemHistorico };
    });
    if (!r) return 'ignorado';
    this.realtime?.publicar(tenantId, 'whatsapp.estado', { estado, numero });
    // Primeira conexão: o histórico vem sozinho (o cliente não precisa pedir).
    if (r.pedirHistorico) {
      void this.provider.pedirHistorico(ev.sessionId, { dias: 90 }).catch((e: Error) => this.log.warn(`pedido de histórico falhou: ${e.message.slice(0, 120)}`));
    }
    return 'instancia';
  }

  private async mensagem(tenantId: string, d: Record<string, unknown>): Promise<string> {
    const numero = digitos(d.numero);
    const waId = texto(d.id, 200);
    if (numero.length < 8 || !waId) return 'ignorado';
    const tipo = texto(d.tipo, 20);
    const corpo = corpoDaMensagem({ texto: texto(d.texto), tipo });
    if (!corpo) return 'ignorado';
    const providerMessageId = `openwa:${waId}`;
    // Mensagem chegando = sessão viva (auto-cura se um "desconectado" ficou para trás).
    void this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.updateMany({ where: { provider: 'openwa', externalBusinessId: sessaoDoTenant(tenantId), status: 'disconnected' }, data: { status: 'connected', health: 'ok', erro: null, updatedAt: new Date() } }),
    ).catch(() => undefined);

    if (d.deMim === true) {
      await this.mensagens.receberHumano({ tenantId, numeroContato: numero, texto: corpo, providerMessageId });
      return 'entrada';
    }
    const r = await this.mensagens.receiveInbound({ tenantId, fromNumber: numero, fromName: texto(d.nomeContato, 120) || undefined, text: corpo, providerMessageId });
    if ('conversationId' in r && r.conversationId) {
      const midiaBruta = d.midia && typeof d.midia === 'object' ? (d.midia as Record<string, unknown>) : null;
      const midia: MidiaEntrada | null = midiaBruta && TIPOS_MIDIA.includes(tipo as TipoEntrada) && typeof midiaBruta.base64 === 'string'
        ? { tipo: tipo as TipoEntrada, url: null, base64: midiaBruta.base64, mime: texto(midiaBruta.mime, 120) || null, nome: texto(midiaBruta.nome, 200) || null, legenda: texto(d.texto) || null }
        : null;
      const fotoUrl = texto(d.fotoUrl, 2000);
      void (async () => {
        await this.stevoEventos?.depoisDaEntrada(tenantId, r.conversationId!, corpo, midia, null);
        await this.foto(tenantId, numero, fotoUrl, true);
      })().catch((e: Error) => this.log.warn(`pós-entrada falhou: ${e.message.slice(0, 160)}`));
    }
    return 'entrada';
  }

  private async status(tenantId: string, d: Record<string, unknown>): Promise<string> {
    const ids = Array.isArray(d.ids) ? d.ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
    if (!ids.length) return 'ignorado';
    if (d.estado === 'falhou') {
      await this.prisma.withTenant(tenantId, (tx) => tx.message.updateMany({ where: { providerId: { in: ids }, deliveryStatus: { notIn: ['delivered', 'read'] } }, data: { deliveryStatus: 'failed', deliveryError: 'openwa: falhou' } }));
      return 'status';
    }
    const novo = STATUS_ENTREGA[String(d.estado)];
    if (!novo) return 'ignorado';
    const avancaveis = Object.entries(ORDEM).filter(([, n]) => n < ORDEM[novo]).map(([s]) => s);
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.message.updateMany({ where: { providerId: { in: ids }, deliveryStatus: { in: avancaveis } }, data: { deliveryStatus: novo, ...(novo === 'sent' ? { sentAt: new Date() } : {}) } }),
    );
    return r.count ? 'status' : 'ignorado';
  }

  private async lote(tenantId: string, d: Record<string, unknown>): Promise<string> {
    const chats = Array.isArray(d.chats) ? (d.chats as ChatHistorico[]).slice(0, 50) : [];
    await this.historico.importarLote(tenantId, chats);
    const ultimo = d.ultimo === true;
    if (ultimo) {
      await this.prisma.withTenant(tenantId, (tx) => tx.integration.updateMany({ where: { tenantId, provider: 'openwa', status: { not: 'revoked' } }, data: { lastSyncAt: new Date() } }));
    }
    const resumo = await this.historico.resumo(tenantId);
    this.realtime?.publicar(tenantId, 'whatsapp.estado', { estado: 'conectado', historico: { ...resumo, concluido: ultimo } });
    return 'historico';
  }

  /** Foto de perfil: a URL que veio no evento ou, se o contato está sem foto, a do gateway. */
  private async foto(tenantId: string, numero: string, url: string, soSeFaltar = false): Promise<string> {
    if (numero.length < 8 || !this.avatares) return 'ignorado';
    const contato = await this.prisma.withTenant(tenantId, async (tx) => {
      const id = await acharContatoPorTelefone(tx, numero);
      return id ? tx.contact.findUnique({ where: { id }, select: { id: true, fotoUrl: true, fotoEm: true } }) : null;
    });
    if (!contato) return 'ignorado';
    const temFoto = !!contato.fotoUrl?.startsWith('/api/fotos/') && !!contato.fotoEm && Date.now() - contato.fotoEm.getTime() < 3 * 24 * 3600_000;
    if (soSeFaltar && temFoto) return 'ignorado';
    const alvo = url || (await this.provider.foto(sessaoDoTenant(tenantId), numero));
    if (!alvo) return 'ignorado';
    return (await this.avatares.guardarDeUrl(tenantId, contato.id, alvo, 'whatsapp')) ? 'foto' : 'ignorado';
  }
}
