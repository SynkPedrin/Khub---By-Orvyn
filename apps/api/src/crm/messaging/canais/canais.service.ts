import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService, type Provider } from '../../../config/config.service';
import { CryptoService } from '../../../integrations/crypto.service';
import { DomainEventsService } from '../../../events/domain-events.service';
import { AtendimentoService, type EstadoAtendimento } from '../atendimento.service';
import type { AutorEnvio } from '../messages.service';
import { CanaisIngestaoService } from './canais-ingestao.service';
import { ErroCanal, MetaCanaisHttp, YoutubeHttp } from './canais.http';
import { CANAL_POR_REDE, DOC, ESCOPOS_META_CONVERSAS, ESCOPO_YOUTUBE, type CredencialCanal, type ProvedorCanal, type Rede } from './canais.tipos';

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                      */
/* ------------------------------------------------------------------ */

export type EstadoCartao = 'conectado' | 'nao_conectado' | 'precisa_credencial' | 'indisponivel';

export interface RecursoCanal {
  rotulo: string;
  disponivel: boolean;
  motivo?: string;
}

export interface CartaoCanal {
  rede: 'whatsapp' | Rede;
  titulo: string;
  descricao: string;
  estado: EstadoCartao;
  /** Provedor do gate e variáveis que faltam (estado `precisa_credencial`). */
  gate: { provider: string; missing: string[] } | null;
  /** Por onde conectar: o fluxo do WhatsApp (QR/vínculo) ou o OAuth da rede. */
  conectarVia: 'whatsapp' | ProvedorCanal | null;
  recursos: RecursoCanal[];
  contas: { id: string; nome: string; externalId: string; status: string; erro: string | null; ultimaSyncAt: string | null }[];
  motivo?: string;
  docs: string[];
}

interface Estado {
  tenantId: string;
  identityId: string;
  provedor: ProvedorCanal;
  nonce: string;
  ts: number;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Por que o TikTok fica fora (honesto, com a doc). */
export const MOTIVO_TIKTOK =
  'A TikTok só oferece mensagens diretas pela Business Messaging API, com aprovação da própria TikTok e restrição por região, e os endpoints de mensagens e comentários ficam no portal de desenvolvedores, que exige cadastro para ler. Sem documentação pública verificável, o KHUB não conecta o TikTok por enquanto.';

/** Rede de `channel_connections` por canal da conversa (Facebook = comentário da página = conexão Messenger). */
const REDE_DO_CANAL: Record<string, Rede> = { Instagram: 'instagram', Messenger: 'messenger', Facebook: 'messenger', YouTube: 'youtube', TikTok: 'tiktok' };
const PROVEDOR_DA_REDE: Record<Rede, Provider> = { instagram: 'meta', messenger: 'meta', youtube: 'youtube', tiktok: 'tiktok' };

/**
 * Canais conectados por rede, de dentro de Conversas (db/063).
 *
 * - Instagram (DM + comentários) e Messenger (DM) + comentários da página do
 *   Facebook: um único OAuth da Meta com os escopos de Conversas; cada página
 *   vira uma conexão Messenger e, se tiver conta profissional do Instagram
 *   vinculada, uma conexão Instagram. O webhook da página é assinado na hora.
 * - YouTube: OAuth do Google; comentários dos vídeos por sincronização
 *   (`commentThreads.list`) e resposta por `comments.insert`. Não há DM.
 * - TikTok: gated (ver MOTIVO_TIKTOK).
 * - WhatsApp: NÃO passa por aqui; o cartão só reflete `integrations` e a tela
 *   usa o fluxo existente (`/integrations/whatsapp`).
 *
 * Tokens só cifrados (CryptoService); nunca voltam para a tela.
 */
@Injectable()
export class CanaisService {
  private readonly log = new Logger('Canais');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly meta: MetaCanaisHttp,
    private readonly youtube: YoutubeHttp,
    private readonly ingestao: CanaisIngestaoService,
    private readonly atendimento: AtendimentoService,
    private readonly eventos: DomainEventsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Cartões                                                             */
  /* ------------------------------------------------------------------ */

  /** Variáveis que faltam para conectar pelo provedor (app + cifra dos tokens). */
  faltando(p: ProvedorCanal): string[] {
    return [...new Set([...this.config.missingVars(p), ...this.config.missingVars('integrations_crypto')])];
  }

  async cartoes(tenantId: string): Promise<CartaoCanal[]> {
    const { conexoes, whats } = await this.prisma.withTenant(tenantId, async (tx) => ({
      conexoes: await tx.channelConnection.findMany({
        where: { status: { not: 'desconectado' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, rede: true, nome: true, externalId: true, status: true, erro: true, ultimaSyncAt: true },
      }),
      whats: await tx.integration.findMany({ where: { provider: { in: ['stevo_api', 'evolution'] } }, select: { provider: true, status: true, externalBusinessId: true } }),
    }));
    const contas = (rede: Rede) =>
      conexoes.filter((c) => c.rede === rede).map((c) => ({ id: c.id, nome: c.nome, externalId: c.externalId, status: c.status, erro: c.erro, ultimaSyncAt: c.ultimaSyncAt?.toISOString() ?? null }));
    const estadoRede = (rede: Rede, p: ProvedorCanal): { estado: EstadoCartao; gate: CartaoCanal['gate'] } => {
      if (contas(rede).some((c) => c.status === 'conectado')) return { estado: 'conectado', gate: null };
      const missing = this.faltando(p);
      return missing.length ? { estado: 'precisa_credencial', gate: { provider: p, missing } } : { estado: 'nao_conectado', gate: null };
    };

    const whatsConectado = whats.some((w) => w.status === 'connected');
    const temStevo = whats.some((w) => w.provider === 'stevo_api' && w.status !== 'revoked');
    const faltaEvolution = this.config.missingVars('evolution');
    const whatsGate = !whatsConectado && !temStevo && faltaEvolution.length ? { provider: 'evolution', missing: faltaEvolution } : null;

    const tiktokMissing = this.faltando('tiktok');
    return [
      {
        rede: 'whatsapp',
        titulo: 'WhatsApp',
        descricao: 'Mensagens do seu número, com envio de arquivos e atendimento pela IA.',
        estado: whatsConectado ? 'conectado' : whatsGate ? 'precisa_credencial' : 'nao_conectado',
        gate: whatsGate,
        conectarVia: 'whatsapp',
        recursos: [
          { rotulo: 'Mensagens diretas', disponivel: true },
          { rotulo: 'Arquivos e áudios', disponivel: true },
        ],
        contas: whats.filter((w) => w.status === 'connected').map((w) => ({ id: w.provider, nome: w.externalBusinessId ?? 'WhatsApp', externalId: w.externalBusinessId ?? '', status: 'conectado', erro: null, ultimaSyncAt: null })),
        docs: [],
      },
      {
        rede: 'instagram',
        titulo: 'Instagram',
        descricao: 'Direct e comentários da conta profissional vinculada a uma página do Facebook.',
        ...estadoRede('instagram', 'meta'),
        conectarVia: 'meta',
        recursos: [
          { rotulo: 'Mensagens diretas (Direct)', disponivel: true },
          { rotulo: 'Comentários de posts e anúncios', disponivel: true, motivo: 'Comentários em anúncios chegam quando a Meta os entrega pelo mesmo webhook de comentários.' },
        ],
        contas: contas('instagram'),
        docs: [DOC.instagramEnvio, DOC.instagramWebhook, DOC.instagramResposta],
      },
      {
        rede: 'messenger',
        titulo: 'Messenger e Facebook',
        descricao: 'Mensagens da página no Messenger e comentários nos posts da página.',
        ...estadoRede('messenger', 'meta'),
        conectarVia: 'meta',
        recursos: [
          { rotulo: 'Mensagens do Messenger', disponivel: true, motivo: 'A Meta só permite responder dentro de 24 h da última mensagem do cliente.' },
          { rotulo: 'Comentários da página', disponivel: true },
        ],
        contas: contas('messenger'),
        docs: [DOC.messengerEnvio, DOC.messengerWebhook, DOC.paginaResposta],
      },
      {
        rede: 'youtube',
        titulo: 'YouTube',
        descricao: 'Comentários dos seus vídeos. O YouTube não tem mensagens diretas.',
        ...estadoRede('youtube', 'youtube'),
        conectarVia: 'youtube',
        recursos: [
          { rotulo: 'Comentários dos vídeos', disponivel: true, motivo: 'O YouTube não avisa comentário novo: o KHUB busca ao sincronizar.' },
          { rotulo: 'Mensagens diretas', disponivel: false, motivo: 'O YouTube não tem mensagens diretas.' },
        ],
        contas: contas('youtube'),
        docs: [DOC.youtubeLista, DOC.youtubeResposta],
      },
      {
        rede: 'tiktok',
        titulo: 'TikTok',
        descricao: 'Mensagens e comentários de conta comercial.',
        estado: tiktokMissing.length ? 'precisa_credencial' : 'indisponivel',
        gate: tiktokMissing.length ? { provider: 'tiktok', missing: tiktokMissing } : null,
        conectarVia: null,
        recursos: [
          { rotulo: 'Mensagens diretas', disponivel: false, motivo: 'Business Messaging API: exige aprovação da TikTok e não vale em todas as regiões.' },
          { rotulo: 'Comentários', disponivel: false, motivo: 'Endpoints não verificáveis na documentação pública.' },
        ],
        contas: contas('tiktok'),
        motivo: MOTIVO_TIKTOK,
        docs: [DOC.tiktok],
      },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* OAuth                                                               */
  /* ------------------------------------------------------------------ */

  private redirectUri(p: ProvedorCanal): string {
    return `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/integrations/canais/${p}/callback`;
  }

  private assinar(e: Estado): string {
    const corpo = Buffer.from(JSON.stringify(e)).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET ?? '').update(corpo).digest('base64url');
    return `${corpo}.${sig}`;
  }

  /** State do OAuth: HMAC com JWT_SECRET, válido por 10 min, amarrado ao provedor. */
  verificarEstado(state: string, provedor: ProvedorCanal): Estado {
    const [corpo, sig] = state.split('.');
    if (!corpo || !sig) throw new BadRequestException('state inválido');
    const esperado = createHmac('sha256', process.env.JWT_SECRET ?? '').update(corpo).digest('base64url');
    if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) throw new BadRequestException('state adulterado');
    let e: Estado;
    try {
      e = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Estado;
    } catch {
      throw new BadRequestException('state inválido');
    }
    if (e.provedor !== provedor) throw new BadRequestException('provedor divergente do state');
    if (Date.now() - e.ts > 10 * 60_000) throw new BadRequestException('state expirado; comece a conexão de novo');
    return e;
  }

  private exigir(p: ProvedorCanal): void {
    const missing = this.faltando(p);
    if (missing.length) throw new HttpException({ status: 'config_required', provider: p, missing, title: `Configuração pendente: ${p}` }, 501);
  }

  urlConexao(tenantId: string, identityId: string, provedor: string): { url: string } {
    if (provedor === 'tiktok') {
      this.exigir('tiktok');
      throw new HttpException({ status: 'indisponivel', provider: 'tiktok', title: 'TikTok indisponível', detail: MOTIVO_TIKTOK, doc: DOC.tiktok }, 501);
    }
    if (provedor !== 'meta' && provedor !== 'youtube') throw new NotFoundException('rede sem conexão por aqui');
    this.exigir(provedor);
    const state = this.assinar({ tenantId, identityId, provedor, nonce: randomBytes(8).toString('hex'), ts: Date.now() });
    if (provedor === 'meta') {
      const p = new URLSearchParams({
        client_id: this.config.get('META_APP_ID')!,
        redirect_uri: this.redirectUri('meta'),
        state,
        response_type: 'code',
        scope: ESCOPOS_META_CONVERSAS.join(','),
      });
      return { url: `https://www.facebook.com/${this.meta.versao()}/dialog/oauth?${p.toString()}` };
    }
    const p = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID')!,
      redirect_uri: this.redirectUri('youtube'),
      response_type: 'code',
      scope: ESCOPO_YOUTUBE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` };
  }

  /** Callback (rota pública, chamada pelo web depois do redirect). */
  async callback(provedor: string, code: string, state: string): Promise<{ conectadas: number; avisos: string[] }> {
    if (provedor !== 'meta' && provedor !== 'youtube') throw new NotFoundException('rede sem conexão por aqui');
    const e = this.verificarEstado(state, provedor);
    this.exigir(provedor);
    return provedor === 'meta' ? this.conectarMeta(e, code) : this.conectarYoutube(e, code);
  }

  private async conectarMeta(e: Estado, code: string) {
    const t = await this.meta.get('oauth/access_token', {
      client_id: this.config.get('META_APP_ID'),
      client_secret: this.config.get('META_APP_SECRET'),
      redirect_uri: this.redirectUri('meta'),
      code,
    });
    const userToken = str(t.access_token);
    if (!userToken) throw new BadRequestException('a Meta não devolveu o token');
    const perms = await this.meta.get('me/permissions', {}, userToken).catch(() => ({ data: [] }));
    const concedidos = (Array.isArray(perms.data) ? perms.data : [])
      .map(obj)
      .filter((p) => p.status === 'granted')
      .map((p) => String(p.permission));
    const paginas = await this.meta.get('me/accounts', { fields: 'id,name,access_token,tasks,instagram_business_account{id,username,name}', limit: 100 }, userToken);
    const avisos: string[] = [];
    let conectadas = 0;
    for (const raw of Array.isArray(paginas.data) ? paginas.data : []) {
      const pg = obj(raw);
      const pageId = str(pg.id);
      const pageToken = str(pg.access_token);
      if (!pageId || !pageToken) continue;
      const nome = str(pg.name) ?? pageId;
      const cred: CredencialCanal = { accessToken: pageToken, userAccessToken: userToken };
      // Assina o webhook da página (mensagens + feed de comentários). Falha
      // não derruba a conexão: fica registrada na conta, visível no cartão.
      let erro: string | null = null;
      try {
        await this.meta.post(`${pageId}/subscribed_apps`, {}, pageToken, { subscribed_fields: 'messages,feed' });
      } catch (err) {
        erro = `não consegui assinar o webhook da página: ${(err as Error).message}`;
      }
      if (await this.gravarConexao(e, 'messenger', pageId, pageId, nome, cred, concedidos, erro, avisos)) conectadas++;
      const ig = obj(pg.instagram_business_account);
      const igId = str(ig.id);
      if (igId) {
        const igNome = str(ig.username) ? `@${String(ig.username)}` : str(ig.name) ?? igId;
        if (await this.gravarConexao(e, 'instagram', igId, pageId, igNome, cred, concedidos, erro, avisos)) conectadas++;
      }
    }
    if (!conectadas && !avisos.length) avisos.push('Nenhuma página do Facebook foi autorizada. Escolha ao menos uma página no diálogo da Meta.');
    return { conectadas, avisos };
  }

  private async conectarYoutube(e: Estado, code: string) {
    const t = await this.youtube.token({
      code,
      client_id: this.config.get('GOOGLE_CLIENT_ID')!,
      client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!,
      redirect_uri: this.redirectUri('youtube'),
      grant_type: 'authorization_code',
    });
    const accessToken = str(t.access_token);
    if (!accessToken) throw new BadRequestException('o Google não devolveu o token');
    const cred: CredencialCanal = {
      accessToken,
      refreshToken: str(t.refresh_token),
      expiresAt: typeof t.expires_in === 'number' ? new Date(Date.now() + t.expires_in * 1000).toISOString() : undefined,
    };
    const canais = await this.youtube.get('channels', { part: 'id,snippet', mine: 'true' }, accessToken);
    const avisos: string[] = [];
    let conectadas = 0;
    const escopos = str(t.scope)?.split(' ') ?? [ESCOPO_YOUTUBE];
    for (const raw of Array.isArray(canais.items) ? canais.items : []) {
      const c = obj(raw);
      const id = str(c.id);
      if (!id) continue;
      const nome = str(obj(c.snippet).title) ?? id;
      const conexaoId = await this.gravarConexao(e, 'youtube', id, null, nome, cred, escopos, null, avisos);
      if (conexaoId) {
        conectadas++;
        await this.sincronizarYoutube(e.tenantId, conexaoId).catch((err) => avisos.push(`Conectado, mas a primeira busca de comentários falhou: ${(err as Error).message}`));
      }
    }
    if (!conectadas && !avisos.length) avisos.push('Esta conta Google não tem canal no YouTube.');
    return { conectadas, avisos };
  }

  /**
   * Upsert da conexão do tenant. A mesma conta de rede em OUTRO tenant é
   * recusada pelo banco (UNIQUE + RLS) e vira aviso, nunca sequestro.
   */
  private async gravarConexao(e: Estado, rede: Rede, externalId: string, pageId: string | null, nome: string, cred: CredencialCanal, scopes: string[], erro: string | null, avisos: string[]): Promise<string | null> {
    try {
      return await this.prisma.withTenant(e.tenantId, async (tx) => {
        const dados = { pageId, nome: nome.slice(0, 200), status: 'conectado', credentialsEncrypted: this.crypto.encryptJson(cred), scopes, connectedBy: e.identityId, erro, updatedAt: new Date() };
        const atual = await tx.channelConnection.findFirst({ where: { rede, externalId }, select: { id: true } });
        const id = atual
          ? (await tx.channelConnection.update({ where: { id: atual.id }, data: dados, select: { id: true } })).id
          : (await tx.channelConnection.create({ data: { tenantId: e.tenantId, rede, externalId, ...dados }, select: { id: true } })).id;
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
          VALUES (${e.tenantId}::uuid, 'humano', ${e.identityId}, 'canal.conectado', 'channel_connection', ${id}, ${JSON.stringify({ rede, nome })}::jsonb)`;
        return id;
      });
    } catch (err) {
      this.log.warn(`conexão ${rede}:${externalId} recusada para o tenant ${e.tenantId}: ${(err as Error).message}`);
      avisos.push(`${CANAL_POR_REDE[rede]} ${nome}: esta conta já está conectada em outra conta do KHUB.`);
      return null;
    }
  }

  async desconectar(tenantId: string, identityId: string, id: string) {
    const conexao = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id } }));
    if (!conexao) throw new NotFoundException('conexão inexistente');
    if (conexao.rede === 'youtube' && conexao.credentialsEncrypted && this.crypto.configured()) {
      const cred = this.crypto.decryptJson<CredencialCanal>(conexao.credentialsEncrypted);
      await this.youtube.revogar(cred.refreshToken ?? cred.accessToken);
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.channelConnection.update({ where: { id }, data: { status: 'desconectado', credentialsEncrypted: null, erro: null, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'canal.desconectado', 'channel_connection', ${id}, ${JSON.stringify({ rede: conexao.rede })}::jsonb)`;
    });
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* YouTube: sincronização de comentários                               */
  /* ------------------------------------------------------------------ */

  /** Token válido do Google (renova com o refresh token se faltar < 1 min). */
  private async tokenYoutube(tenantId: string, conexaoId: string, cred: CredencialCanal): Promise<string> {
    const vence = cred.expiresAt ? new Date(cred.expiresAt).getTime() : 0;
    if (vence - Date.now() > 60_000 || !cred.refreshToken) return cred.accessToken;
    const t = await this.youtube.token({
      client_id: this.config.get('GOOGLE_CLIENT_ID')!,
      client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: cred.refreshToken,
      grant_type: 'refresh_token',
    });
    const novo: CredencialCanal = {
      ...cred,
      accessToken: str(t.access_token) ?? cred.accessToken,
      expiresAt: typeof t.expires_in === 'number' ? new Date(Date.now() + t.expires_in * 1000).toISOString() : cred.expiresAt,
    };
    await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.update({ where: { id: conexaoId }, data: { credentialsEncrypted: this.crypto.encryptJson(novo) } }));
    return novo.accessToken;
  }

  /**
   * Busca os comentários recentes do canal (`commentThreads.list`,
   * `allThreadsRelatedToChannelId`, 50 por vez, mais novos primeiro) e entra
   * cada um como conversa de comentário. Idempotente: o id do comentário
   * reserva `webhook_events`, então sincronizar de novo não duplica.
   */
  async sincronizarYoutube(tenantId: string, conexaoId: string): Promise<{ novos: number; lidos: number }> {
    this.exigir('youtube');
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id: conexaoId } }));
    if (!c || c.rede !== 'youtube') throw new NotFoundException('conexão do YouTube inexistente');
    if (c.status !== 'conectado' || !c.credentialsEncrypted) throw new ConflictException('o canal do YouTube está desconectado; conecte de novo');
    const cred = this.crypto.decryptJson<CredencialCanal>(c.credentialsEncrypted);
    let novos = 0;
    let lidos = 0;
    try {
      const token = await this.tokenYoutube(tenantId, c.id, cred);
      const r = await this.youtube.get('commentThreads', { part: 'snippet', allThreadsRelatedToChannelId: c.externalId, maxResults: 50, order: 'time', textFormat: 'plainText' }, token);
      for (const raw of Array.isArray(r.items) ? r.items : []) {
        const th = obj(obj(raw).snippet);
        const topo = obj(th.topLevelComment);
        const s = obj(topo.snippet);
        const id = str(topo.id);
        const autorId = str(obj(s.authorChannelId).value);
        const texto = str(s.textOriginal) ?? str(s.textDisplay);
        if (!id || !texto || !autorId || autorId === c.externalId) continue;
        lidos++;
        const res = await this.ingestao.receber({
          tenantId, rede: 'youtube', canal: 'YouTube', tipo: 'comentario', conexaoId: c.id,
          autorId, autorNome: str(s.authorDisplayName), texto, idExterno: id, fioId: id,
          origem: { videoId: str(th.videoId) },
          recebidoEm: str(s.publishedAt) ? new Date(String(s.publishedAt)) : undefined,
        });
        if (!res.duplicada) novos++;
      }
      await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.update({ where: { id: c.id }, data: { ultimaSyncAt: new Date(), erro: null } }));
    } catch (err) {
      const msg = err instanceof ErroCanal ? err.message : (err as Error).message;
      await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.update({ where: { id: c.id }, data: { erro: msg.slice(0, 300) } }));
      throw err instanceof ErroCanal ? new ConflictException(`o YouTube recusou a sincronização: ${msg}`) : err;
    }
    return { novos, lidos };
  }

  /* ------------------------------------------------------------------ */
  /* Envio (DM e resposta a comentário)                                  */
  /* ------------------------------------------------------------------ */

  /** A conversa é de uma rede atendida aqui (tem conta e id na rede)? */
  atende(conv: { canal: string; externoId: string | null }): boolean {
    return !!conv.externoId && conv.canal in REDE_DO_CANAL;
  }

  /**
   * Mesmo contrato de `MessagesService.send`: reserva com idempotência,
   * grava, tenta a rede e devolve `{ id, hora, status, erro, missing, provider? }`.
   * Gates, na ordem: arquivo (não suportado), conta desconectada,
   * credencial do app, trava de dev.
   */
  async enviar(tenantId: string, conversationId: string, texto: string, idempotencyKey: string = randomUUID(), autor: AutorEnvio = { tipo: 'humano' }, comMidia = false) {
    let assumiu: EstadoAtendimento | null = null;
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + idempotencyKey}, 0))`;
      const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
      if (!conv) throw new NotFoundException('conversa inexistente');
      const anterior = await tx.message.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
      if (anterior && (anterior.corpo !== texto || anterior.conversationId !== conversationId)) throw new ConflictException('chave de idempotência já usada com outro conteúdo');
      const rede = REDE_DO_CANAL[conv.canal];
      const conexao = conv.canalConexaoId ? await tx.channelConnection.findUnique({ where: { id: conv.canalConexaoId } }) : null;
      if (anterior && anterior.deliveryStatus !== 'pending') return { msg: anterior, enviar: false as const, conv, conexao, rede, gate: null };
      let status = 'sending';
      let gate: { provider: string; missing: string[] } | null = null;
      if (comMidia) status = 'midia_nao_suportada';
      else if (!rede || !conexao || conexao.status !== 'conectado' || !conexao.credentialsEncrypted) status = 'canal_desconectado';
      else {
        const p = PROVEDOR_DA_REDE[rede];
        const missing = [...new Set([...this.config.missingVars(p), ...this.config.missingVars('integrations_crypto')])];
        if (missing.length) { status = 'config_required'; gate = { provider: p, missing }; }
        else if (process.env.NODE_ENV !== 'production' && this.config.get('CANAIS_ENVIO_DEV') !== 'true') status = 'bloqueado_dev';
      }
      const autoria = autor.tipo === 'ia' ? { autorTipo: 'ia', agentId: autor.agentId }
        : autor.tipo === 'automacao' ? { autorTipo: 'automacao', workflowId: autor.workflowId }
        : { autorTipo: 'humano', enviadoPorId: autor.identityId };
      const erro = status === 'bloqueado_dev' ? 'envio externo bloqueado fora de produção: defina CANAIS_ENVIO_DEV=true'
        : status === 'canal_desconectado' ? `a conta do ${conv.canal} está desconectada` : null;
      const data = { deliveryStatus: status, deliveryError: erro };
      const msg = anterior
        ? await tx.message.update({ where: { id: anterior.id }, data })
        : await tx.message.create({ data: { tenantId, conversationId, ...autoria, corpo: texto, hora, idempotencyKey, ...data } });
      await tx.conversation.update({ where: { id: conversationId }, data: { ultimaPrevia: texto.slice(0, 140), ultimaHora: hora, updatedAt: new Date() } });
      if (autor.tipo === 'humano' && autor.identityId) assumiu = await this.atendimento.aoHumanoEnviar(tx, tenantId, conversationId, autor.identityId);
      const actorType = autor.tipo === 'ia' ? 'nyro' : autor.tipo === 'automacao' ? 'sistema' : 'humano';
      const actorId = autor.tipo === 'ia' ? autor.agentId : autor.tipo === 'automacao' ? autor.workflowId : autor.identityId ?? null;
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id) VALUES (${tenantId}::uuid, ${actorType}, ${actorId}, 'message.reserve', 'message', ${msg.id})`;
      return { msg, enviar: status === 'sending', conv, conexao, rede, gate };
    });

    let status = ctx.msg.deliveryStatus;
    let erro = ctx.msg.deliveryError;
    if (ctx.enviar && ctx.conexao && ctx.rede) {
      try {
        const providerId = await this.chamarRede(tenantId, ctx.rede, ctx.conv, ctx.conexao, texto);
        await this.prisma.withTenant(tenantId, (tx) => tx.message.update({ where: { id: ctx.msg.id }, data: { deliveryStatus: 'sent', providerId, sentAt: new Date() } }));
        status = 'sent';
        erro = null;
      } catch (e) {
        // Timeout/5xx: a rede pode ter aceitado. Não repete (duplicaria para o cliente).
        status = e instanceof ErroCanal ? (e.incerto ? 'unknown' : 'failed') : 'unknown';
        erro = e instanceof ErroCanal ? e.message.slice(0, 300) : 'provider_acceptance_unknown';
        await this.prisma.withTenant(tenantId, (tx) => tx.message.update({ where: { id: ctx.msg.id }, data: { deliveryStatus: status, deliveryError: erro } }));
      }
    }
    this.eventos.publicar(tenantId, 'message.created', { conversationId, id: ctx.msg.id, de: autor.tipo === 'ia' ? 'ia' : 'humano', texto, hora: ctx.msg.hora ?? hora, agentId: autor.tipo === 'ia' ? autor.agentId : null });
    this.eventos.publicar(tenantId, 'conversation.updated', { id: conversationId, ultimaPrevia: texto.slice(0, 140), ultimaHora: ctx.msg.hora ?? hora, naoLidas: 0 });
    if (assumiu) this.atendimento.publicar(tenantId, assumiu);
    return { id: ctx.msg.id, hora: ctx.msg.hora ?? hora, status, erro, missing: ctx.gate?.missing ?? [], ...(ctx.gate ? { provider: ctx.gate.provider } : {}) };
  }

  /** Chamada à rede certa. Devolve o id da mensagem/comentário criado. */
  private async chamarRede(
    tenantId: string,
    rede: Rede,
    conv: { canal: string; tipo: string; externoId: string | null },
    conexao: { id: string; externalId: string; pageId: string | null; credentialsEncrypted: string | null },
    texto: string,
  ): Promise<string | undefined> {
    const cred = this.crypto.decryptJson<CredencialCanal>(conexao.credentialsEncrypted!);
    const alvo = (conv.externoId ?? '').replace(/^(dm|c):/, '');
    if (rede === 'youtube') {
      // DOC.youtubeResposta: POST /comments?part=snippet { snippet: { parentId, textOriginal } }
      const token = await this.tokenYoutube(tenantId, conexao.id, cred);
      const r = await this.youtube.post('comments', { part: 'snippet' }, { snippet: { parentId: alvo, textOriginal: texto } }, token);
      return str(r.id);
    }
    if (conv.tipo === 'dm') {
      // DOC.messengerEnvio / DOC.instagramEnvio: POST /{PAGE-ID}/messages com token da página.
      const r = await this.meta.post(`${conexao.pageId ?? conexao.externalId}/messages`, { recipient: { id: alvo }, messaging_type: 'RESPONSE', message: { text: texto } }, cred.accessToken);
      return str(r.message_id);
    }
    if (conv.canal === 'Instagram') {
      // DOC.instagramResposta: POST /{ig-comment-id}/replies?message= (token de usuário, segundo a doc).
      const r = await this.meta.post(`${alvo}/replies`, {}, cred.userAccessToken ?? cred.accessToken, { message: texto });
      return str(r.id);
    }
    // DOC.paginaResposta: POST /{comment-id}/comments com token da página.
    const r = await this.meta.post(`${alvo}/comments`, {}, cred.accessToken, { message: texto });
    return str(r.id);
  }
}
