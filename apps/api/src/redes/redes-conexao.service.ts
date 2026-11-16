import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService, type Provider } from '../config/config.service';
import { CryptoService } from '../integrations/crypto.service';
import { ESCOPOS_META_CONVERSAS } from '../crm/messaging/canais/canais.tipos';
import { ErroRede } from './redes.erros';
import { RedesHttp } from './redes.http';
import { parseTiktokUsuario, parseYtCanal } from './redes.parse';
import { ESCOPOS_GOOGLE_REDES, ESCOPOS_META_REDES, ESCOPOS_TIKTOK, ehRedeSocial, type CredencialRede, type RedeSocial } from './redes.tipos';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const validade = (seg: unknown): string | undefined => (typeof seg === 'number' && seg > 0 ? new Date(Date.now() + seg * 1000).toISOString() : undefined);

interface Estado {
  tenantId: string;
  identityId: string;
  rede: RedeSocial;
  nonce: string;
  ts: number;
}

export const PROVEDOR_REDE: Record<RedeSocial, Provider> = { instagram: 'meta', youtube: 'youtube', tiktok: 'tiktok' };

/** Escopos pedidos na Meta: os de Conversas + os de redes (a linha de `channel_connections` é a mesma nos dois módulos). */
export const ESCOPOS_META_PEDIDOS = [...new Set<string>([...ESCOPOS_META_CONVERSAS, ...ESCOPOS_META_REDES])];

export interface ConexaoAtiva {
  id: string;
  rede: RedeSocial;
  externalId: string;
  pageId: string | null;
  nome: string;
  scopes: string[];
  token: string;
}

/**
 * Conexão das contas de rede social (OAuth) e tokens válidos para o painel e
 * para o worker. As contas vivem em `channel_connections` (db/063), as mesmas
 * de Conversas; tokens só CIFRADOS (CryptoService) e nunca devolvidos à tela.
 *
 * - Instagram: login do Facebook; o token do usuário vira token LONGO
 *   (DOC_REDES.metaTokenLongo) e o token de página derivado não expira.
 * - YouTube: OAuth do Google (offline), com o escopo do YouTube Analytics.
 * - TikTok: Login Kit v2 (DOC_REDES.tiktokLogin), refresh token rotativo.
 */
@Injectable()
export class RedesConexaoService {
  private readonly log = new Logger('RedesConexao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly http: RedesHttp,
  ) {}

  /** Variáveis que faltam para conectar a rede (app + cifra dos tokens). */
  faltando(rede: RedeSocial): string[] {
    return [...new Set([...this.config.missingVars(PROVEDOR_REDE[rede]), ...this.config.missingVars('integrations_crypto')])];
  }

  exigir(rede: RedeSocial): void {
    const missing = this.faltando(rede);
    if (missing.length) throw new HttpException({ status: 'config_required', provider: PROVEDOR_REDE[rede], missing, title: `Configuração pendente: ${PROVEDOR_REDE[rede]}` }, 501);
  }

  redirectUri(rede: RedeSocial): string {
    return `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/integrations/redes/${rede}/callback`;
  }

  /* ------------------------------ state ------------------------------ */

  private segredo(): string {
    const s = this.config.get('JWT_SECRET');
    if (!s) throw new HttpException({ status: 'config_required', provider: 'auth', missing: ['JWT_SECRET'], title: 'Configuração pendente: JWT_SECRET' }, 501);
    return s;
  }

  assinar(e: Estado): string {
    const corpo = Buffer.from(JSON.stringify(e)).toString('base64url');
    return `${corpo}.${createHmac('sha256', this.segredo()).update(`redes:${corpo}`).digest('base64url')}`;
  }

  /** State do OAuth: HMAC, 10 min de validade, amarrado à rede. */
  verificarEstado(state: string, rede: RedeSocial): Estado {
    const [corpo, sig] = state.split('.');
    if (!corpo || !sig) throw new BadRequestException('state inválido');
    const esperado = createHmac('sha256', this.segredo()).update(`redes:${corpo}`).digest('base64url');
    if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) throw new BadRequestException('state adulterado');
    let e: Estado;
    try {
      e = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Estado;
    } catch {
      throw new BadRequestException('state inválido');
    }
    if (e.rede !== rede) throw new BadRequestException('rede divergente do state');
    if (Date.now() - e.ts > 10 * 60_000) throw new BadRequestException('state expirado; comece a conexão de novo');
    return e;
  }

  /* ------------------------------ OAuth ------------------------------ */

  urlConexao(tenantId: string, identityId: string, rede: string): { url: string } {
    if (!ehRedeSocial(rede)) throw new NotFoundException('rede desconhecida');
    this.exigir(rede);
    const state = this.assinar({ tenantId, identityId, rede, nonce: randomBytes(8).toString('hex'), ts: Date.now() });
    if (rede === 'instagram') {
      const p = new URLSearchParams({ client_id: this.config.get('META_APP_ID')!, redirect_uri: this.redirectUri(rede), state, response_type: 'code', scope: ESCOPOS_META_PEDIDOS.join(',') });
      return { url: `https://www.facebook.com/${this.http.versaoMeta()}/dialog/oauth?${p.toString()}` };
    }
    if (rede === 'youtube') {
      const p = new URLSearchParams({
        client_id: this.config.get('GOOGLE_CLIENT_ID')!,
        redirect_uri: this.redirectUri(rede),
        response_type: 'code',
        scope: ESCOPOS_GOOGLE_REDES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return { url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` };
    }
    // DOC_REDES.tiktokLogin: escopos separados por vírgula; redirect_uri igual ao cadastrado no portal.
    const p = new URLSearchParams({ client_key: this.config.get('TIKTOK_APP_ID')!, scope: ESCOPOS_TIKTOK.join(','), response_type: 'code', redirect_uri: this.redirectUri(rede), state });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}` };
  }

  /** Callback (rota pública, chamada pelo web depois do redirect). */
  async callback(rede: string, code: string, state: string): Promise<{ conectadas: number; avisos: string[] }> {
    if (!ehRedeSocial(rede)) throw new NotFoundException('rede desconhecida');
    const e = this.verificarEstado(state, rede);
    this.exigir(rede);
    try {
      if (rede === 'instagram') return await this.conectarInstagram(e, code);
      if (rede === 'youtube') return await this.conectarYoutube(e, code);
      return await this.conectarTiktok(e, code);
    } catch (err) {
      if (err instanceof ErroRede) throw new ConflictException(err.info.mensagem);
      throw err;
    }
  }

  private async conectarInstagram(e: Estado, code: string) {
    const curto = await this.http.metaGet('oauth/access_token', { client_id: this.config.get('META_APP_ID'), client_secret: this.config.get('META_APP_SECRET'), redirect_uri: this.redirectUri('instagram'), code }, null);
    const tokenCurto = str(curto.access_token);
    if (!tokenCurto) throw new BadRequestException('a Meta não devolveu o token');
    // DOC_REDES.metaTokenLongo: token longo do usuário → token de página sem expiração.
    const longo = await this.http.metaGet('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: this.config.get('META_APP_ID'), client_secret: this.config.get('META_APP_SECRET'), fb_exchange_token: tokenCurto }, null);
    const userToken = str(longo.access_token) ?? tokenCurto;
    const perms = await this.http.metaGet('me/permissions', {}, userToken).catch(() => ({ data: [] }) as Json);
    const concedidas = (Array.isArray(perms.data) ? perms.data : []).map(obj).filter((p) => p.status === 'granted').map((p) => String(p.permission));
    const paginas = await this.http.metaGet('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: 100 }, userToken);
    const avisos: string[] = [];
    const negadas = ESCOPOS_META_REDES.filter((p) => !concedidas.includes(p));
    if (negadas.length) avisos.push(`Permissões não concedidas: ${negadas.join(', ')}. Partes do painel ficarão bloqueadas até você reconectar aceitando todas.`);
    let conectadas = 0;
    for (const raw of Array.isArray(paginas.data) ? paginas.data : []) {
      const pg = obj(raw);
      const pageId = str(pg.id);
      const pageToken = str(pg.access_token);
      const ig = obj(pg.instagram_business_account);
      const igId = str(ig.id);
      if (!pageId || !pageToken || !igId) continue;
      // Mesma assinatura de webhook que Conversas faz (a conta é compartilhada): DM e comentários continuam chegando.
      let erro: string | null = null;
      await this.http.metaPost(`${pageId}/subscribed_apps`, { subscribed_fields: 'messages,feed' }, pageToken).catch((err: Error) => {
        erro = `não consegui assinar o webhook da página: ${err.message}`;
      });
      const nome = str(ig.username) ? `@${String(ig.username)}` : str(ig.name) ?? igId;
      const cred: CredencialRede = { accessToken: pageToken, userAccessToken: userToken, expiresAt: validade(longo.expires_in) };
      if (await this.gravar(e, 'instagram', igId, pageId, nome, cred, concedidas, erro, avisos)) conectadas++;
    }
    if (!conectadas && !avisos.some((a) => a.includes('outra conta'))) avisos.push('Nenhuma conta profissional do Instagram vinculada às páginas autorizadas. No Instagram, mude para conta profissional e vincule a uma página do Facebook.');
    return { conectadas, avisos };
  }

  private async conectarYoutube(e: Estado, code: string) {
    const t = await this.http.googleToken({ code, client_id: this.config.get('GOOGLE_CLIENT_ID')!, client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!, redirect_uri: this.redirectUri('youtube'), grant_type: 'authorization_code' });
    const accessToken = str(t.access_token);
    if (!accessToken) throw new BadRequestException('o Google não devolveu o token');
    const escopos = str(t.scope)?.split(' ') ?? [...ESCOPOS_GOOGLE_REDES];
    const canal = parseYtCanal(await this.http.googleGet('https://www.googleapis.com/youtube/v3/channels', { part: 'id,snippet', mine: 'true' }, accessToken, [...ESCOPOS_GOOGLE_REDES]));
    const avisos: string[] = [];
    if (!canal.id) return { conectadas: 0, avisos: ['Esta conta Google não tem canal no YouTube.'] };
    // Sem refresh_token novo (consentimento já dado antes): mantém o que já estava guardado.
    let refreshToken = str(t.refresh_token);
    if (!refreshToken) {
      const atual = await this.prisma.withTenant(e.tenantId, (tx) => tx.channelConnection.findFirst({ where: { rede: 'youtube', externalId: canal.id! }, select: { credentialsEncrypted: true } }));
      if (atual?.credentialsEncrypted) refreshToken = this.crypto.decryptJson<CredencialRede>(atual.credentialsEncrypted).refreshToken;
    }
    const cred: CredencialRede = { accessToken, refreshToken, expiresAt: validade(t.expires_in) };
    const id = await this.gravar(e, 'youtube', canal.id, null, canal.titulo ?? canal.id, cred, escopos, null, avisos);
    return { conectadas: id ? 1 : 0, avisos };
  }

  private async conectarTiktok(e: Estado, code: string) {
    const t = await this.http.tiktokOauth('token', {
      client_key: this.config.get('TIKTOK_APP_ID')!,
      client_secret: this.config.get('TIKTOK_APP_SECRET')!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri('tiktok'),
    });
    const accessToken = str(t.access_token);
    const openId = str(t.open_id);
    if (!accessToken || !openId) throw new BadRequestException('o TikTok não devolveu o token');
    const escopos = (str(t.scope) ?? '').split(',').filter(Boolean);
    const avisos: string[] = [];
    const negados = ESCOPOS_TIKTOK.filter((s) => !escopos.includes(s));
    if (negados.length) avisos.push(`Escopos não concedidos no TikTok: ${negados.join(', ')}.`);
    const u = parseTiktokUsuario(await this.http.tiktokGet('user/info/', { fields: 'open_id,display_name' }, accessToken, ['user.info.basic']).catch(() => ({})));
    const cred: CredencialRede = { accessToken, refreshToken: str(t.refresh_token), expiresAt: validade(t.expires_in), refreshExpiresAt: validade(t.refresh_expires_in), openId };
    const id = await this.gravar(e, 'tiktok', openId, null, u.nome ?? 'TikTok', cred, escopos, null, avisos);
    return { conectadas: id ? 1 : 0, avisos };
  }

  /** Upsert da conexão; a mesma conta em OUTRO tenant é recusada pelo banco (UNIQUE + RLS) e vira aviso. */
  private async gravar(e: Estado, rede: RedeSocial, externalId: string, pageId: string | null, nome: string, cred: CredencialRede, scopes: string[], erro: string | null, avisos: string[]): Promise<string | null> {
    try {
      return await this.prisma.withTenant(e.tenantId, async (tx) => {
        const dados = { pageId, nome: nome.slice(0, 200), status: 'conectado', credentialsEncrypted: this.crypto.encryptJson(cred), scopes, connectedBy: e.identityId, erro, updatedAt: new Date() };
        const atual = await tx.channelConnection.findFirst({ where: { rede, externalId }, select: { id: true } });
        const id = atual
          ? (await tx.channelConnection.update({ where: { id: atual.id }, data: dados, select: { id: true } })).id
          : (await tx.channelConnection.create({ data: { tenantId: e.tenantId, rede, externalId, ...dados }, select: { id: true } })).id;
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
          VALUES (${e.tenantId}::uuid, 'humano', ${e.identityId}, 'rede.conectada', 'channel_connection', ${id}, ${JSON.stringify({ rede, nome, scopes })}::jsonb)`;
        return id;
      });
    } catch (err) {
      this.log.warn(`conexão ${rede}:${externalId} recusada para o tenant ${e.tenantId}: ${(err as Error).message}`);
      avisos.push(`${nome}: esta conta já está conectada em outra conta do KHUB.`);
      return null;
    }
  }

  /** Desconecta (revoga no Google/TikTok, melhor esforço). Vale também para Conversas: a conta é a mesma. */
  async desconectar(tenantId: string, identityId: string, id: string): Promise<{ ok: true }> {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id } }));
    if (!c || !ehRedeSocial(c.rede)) throw new NotFoundException('conexão inexistente');
    if (c.credentialsEncrypted && this.crypto.configured()) {
      const cred = this.crypto.decryptJson<CredencialRede>(c.credentialsEncrypted);
      if (c.rede === 'tiktok' && !this.faltando('tiktok').length) {
        await this.http.tiktokOauth('revoke', { client_key: this.config.get('TIKTOK_APP_ID')!, client_secret: this.config.get('TIKTOK_APP_SECRET')!, token: cred.accessToken }).catch(() => undefined);
      }
      if (c.rede === 'youtube') {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cred.refreshToken ?? cred.accessToken)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      }
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.channelConnection.update({ where: { id }, data: { status: 'desconectado', credentialsEncrypted: null, erro: null, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'rede.desconectada', 'channel_connection', ${id}, ${JSON.stringify({ rede: c.rede })}::jsonb)`;
    });
    return { ok: true };
  }

  /* ------------------------------ tokens ------------------------------ */

  /**
   * Conexão conectada da rede com token VÁLIDO (renova Google/TikTok quando
   * falta menos de 1 min). Renovação sob advisory lock: o refresh token do
   * TikTok rotaciona e duas renovações paralelas invalidariam uma à outra.
   */
  async ativa(tenantId: string, rede: RedeSocial, conexaoId: string): Promise<ConexaoAtiva> {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id: conexaoId } }));
    if (!c || c.rede !== rede) throw new NotFoundException('conta da rede inexistente');
    if (c.status !== 'conectado' || !c.credentialsEncrypted) throw new ConflictException('a conta está desconectada; conecte de novo');
    this.exigir(rede);
    const base = { id: c.id, rede, externalId: c.externalId, pageId: c.pageId, nome: c.nome, scopes: c.scopes };
    const cred = this.crypto.decryptJson<CredencialRede>(c.credentialsEncrypted);
    if (rede === 'instagram' || !cred.refreshToken) return { ...base, token: cred.accessToken };
    const vence = cred.expiresAt ? new Date(cred.expiresAt).getTime() : 0;
    if (vence - Date.now() > 60_000) return { ...base, token: cred.accessToken };
    const token = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'redes-token:' + c.id}, 0))`;
      const atual = await tx.channelConnection.findUnique({ where: { id: c.id }, select: { credentialsEncrypted: true } });
      if (!atual?.credentialsEncrypted) throw new ConflictException('a conta está desconectada; conecte de novo');
      const agora = this.crypto.decryptJson<CredencialRede>(atual.credentialsEncrypted);
      if (agora.expiresAt && new Date(agora.expiresAt).getTime() - Date.now() > 60_000) return agora.accessToken;
      const t = rede === 'youtube'
        ? await this.http.googleToken({ client_id: this.config.get('GOOGLE_CLIENT_ID')!, client_secret: this.config.get('GOOGLE_CLIENT_SECRET')!, refresh_token: agora.refreshToken!, grant_type: 'refresh_token' })
        : await this.http.tiktokOauth('token', { client_key: this.config.get('TIKTOK_APP_ID')!, client_secret: this.config.get('TIKTOK_APP_SECRET')!, grant_type: 'refresh_token', refresh_token: agora.refreshToken! });
      const novo: CredencialRede = {
        ...agora,
        accessToken: str(t.access_token) ?? agora.accessToken,
        refreshToken: str(t.refresh_token) ?? agora.refreshToken,
        expiresAt: validade(t.expires_in) ?? agora.expiresAt,
        refreshExpiresAt: validade(t.refresh_expires_in) ?? agora.refreshExpiresAt,
      };
      await tx.channelConnection.update({ where: { id: c.id }, data: { credentialsEncrypted: this.crypto.encryptJson(novo), erro: null } });
      return novo.accessToken;
    }).catch(async (err: unknown) => {
      if (err instanceof ErroRede && err.info.tipo === 'token') {
        await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.update({ where: { id: c.id }, data: { erro: err.info.mensagem.slice(0, 300) } }));
      }
      throw err;
    });
    return { ...base, token };
  }

  /** Contas (não desconectadas) da rede no tenant, para o seletor da tela. */
  async contas(tenantId: string, rede: RedeSocial) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.channelConnection.findMany({ where: { rede, status: { not: 'desconectado' } }, orderBy: { createdAt: 'asc' }, select: { id: true, nome: true, externalId: true, status: true, erro: true, scopes: true } }),
    );
  }
}
