import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErroRede, secaoDeErro } from './redes.erros';
import { RedesHttp } from './redes.http';
import { RedesConexaoService, type ConexaoAtiva } from './redes-conexao.service';
import { crescimento, diaUtc, engajamentoMedio, noPeriodo, rankear, serieAcumulada, serieDeSnapshots, somar, variacao } from './redes.metricas';
import {
  CAMPOS_IG_CONTA,
  CAMPOS_IG_MIDIA,
  CAMPOS_TIKTOK_USUARIO,
  CAMPOS_TIKTOK_VIDEO,
  METRICAS_IG_MIDIA,
  parseIgConta,
  parseIgInsights,
  parseIgMidias,
  parseIgSerie,
  parseTiktokUsuario,
  parseTiktokVideos,
  parseYtCanal,
  parseYtPlaylist,
  parseYtRelatorio,
  parseYtVideos,
  postDeIg,
  type IgMidia,
} from './redes.parse';
import {
  DOC_REDES,
  ESCOPOS_GOOGLE_REDES,
  ESCOPO_YT_ANALYTICS,
  PERMISSOES_IG,
  REDES_SOCIAIS,
  type ContaRedeResumo,
  type Kpi,
  type PainelRede,
  type PontoSerie,
  type PostRede,
  type RedeSocial,
  type SecaoStatus,
} from './redes.tipos';

const OK: SecaoStatus = { status: 'ok' };
const YT_DATA = 'https://www.googleapis.com/youtube/v3/';
const YT_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
/** A Meta limita a janela since/until dos insights da conta: o painel usa até 28 dias. */
export const DIAS_MAX = 28;

/** Executa em lotes (não martela a API com N chamadas simultâneas). */
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return out;
}

const kpi = (chave: string, rotulo: string, valor: number | null, variacaoPct: number | null = null, formato: Kpi['formato'] = 'numero'): Kpi => ({ chave, rotulo, valor, variacao: variacaoPct, formato });

interface Foto {
  seguidores: number | null;
  publicacoes: number | null;
  visualizacoes: number | null;
  curtidas: number | null;
}

/**
 * Painel de redes sociais por subconta. Cada seção (KPIs, posts, métricas por
 * post, crescimento) falha SOZINHA e diz o motivo (permissão que falta, token
 * vencido, limite): o resto do painel continua com dado real.
 */
@Injectable()
export class RedesService {
  private readonly log = new Logger('Redes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: RedesHttp,
    private readonly conexoes: RedesConexaoService,
  ) {}

  /** Estado das três redes (aba da tela e cartões de Integrações). */
  async estado(tenantId: string) {
    return Promise.all(
      REDES_SOCIAIS.map(async (rede) => {
        const contas = await this.conexoes.contas(tenantId, rede);
        const missing = this.conexoes.faltando(rede);
        return {
          rede,
          conectado: contas.some((c) => c.status === 'conectado'),
          gate: missing.length ? { provider: rede === 'instagram' ? 'meta' : rede, missing } : null,
          contas: contas.map((c) => ({ id: c.id, nome: c.nome, status: c.status, erro: c.erro })),
        };
      }),
    );
  }

  async painel(tenantId: string, rede: RedeSocial, conexaoId: string | undefined, diasPedidos: number): Promise<PainelRede> {
    const dias = Math.min(Math.max(Math.round(diasPedidos) || DIAS_MAX, 7), DIAS_MAX);
    const contas = await this.conexoes.contas(tenantId, rede);
    const conectadas = contas.filter((c) => c.status === 'conectado');
    const missing = this.conexoes.faltando(rede);
    const vazio: PainelRede = {
      rede,
      conectado: false,
      gate: missing.length ? { provider: rede === 'instagram' ? 'meta' : rede, missing } : null,
      contas: contas.map((c) => ({ id: c.id, nome: c.nome, status: c.status, erro: c.erro })),
      conta: null,
      periodoDias: dias,
      kpis: [],
      kpisStatus: { status: 'sem_dados' },
      posts: [],
      postsStatus: { status: 'sem_dados' },
      metricasPostStatus: { status: 'sem_dados' },
      ranking: [],
      crescimento: { seguidores: [], alcance: [], fonteSeguidores: 'snapshots', status: { status: 'sem_dados' } },
      publicacao: { disponivel: false, formatos: [], doc: this.docPublicacao(rede) },
      docs: this.docs(rede),
    };
    if (!conectadas.length) return vazio;
    const escolhida = conectadas.find((c) => c.id === conexaoId) ?? conectadas[0];
    const painel: PainelRede = { ...vazio, conectado: true, gate: null };
    let ativa: ConexaoAtiva;
    try {
      ativa = await this.conexoes.ativa(tenantId, rede, escolhida.id);
    } catch (err) {
      const s = secaoDeErro(err);
      return { ...painel, kpisStatus: s, postsStatus: s, metricasPostStatus: s, crescimento: { ...painel.crescimento, status: s } };
    }
    painel.publicacao = this.capacidadePublicacao(rede, ativa.scopes);
    if (rede === 'instagram') return this.painelInstagram(tenantId, ativa, painel, dias);
    if (rede === 'tiktok') return this.painelTiktok(tenantId, ativa, painel, dias);
    return this.painelYoutube(tenantId, ativa, painel, dias);
  }

  /* ------------------------------ Instagram ------------------------------ */

  private async painelInstagram(tenantId: string, c: ConexaoAtiva, p: PainelRede, dias: number): Promise<PainelRede> {
    const desde = new Date(Date.now() - dias * 86_400_000);
    // DOC_REDES.igUsuario
    let conta;
    try {
      conta = parseIgConta(await this.http.metaGet(c.externalId, { fields: CAMPOS_IG_CONTA }, c.token, PERMISSOES_IG.midias));
    } catch (err) {
      const s = secaoDeErro(err);
      return { ...p, kpisStatus: s, postsStatus: s, metricasPostStatus: s, crescimento: { ...p.crescimento, status: s } };
    }
    p.conta = this.resumo(c, conta.usuario ? `@${conta.usuario}` : null, conta.foto, conta.seguidores, conta.publicacoes);

    // DOC_REDES.igMidiaLista: as 25 mais recentes (paginação por cursor da Graph API).
    let midias: IgMidia[] = [];
    try {
      midias = parseIgMidias(await this.http.metaGet(`${c.externalId}/media`, { fields: CAMPOS_IG_MIDIA, limit: 25 }, c.token, PERMISSOES_IG.midias)).itens;
      p.postsStatus = OK;
    } catch (err) {
      p.postsStatus = secaoDeErro(err);
    }

    // DOC_REDES.igInsightsMidia: só FEED e REELS (story e anúncio ficam de fora).
    let bloqueio: SecaoStatus | null = null;
    let semInsight = 0;
    const insights = await emLotes(midias, 5, async (m) => {
      if (bloqueio || (m.produto && !['FEED', 'REELS'].includes(m.produto))) return null;
      try {
        return parseIgInsights(await this.http.metaGet(`${m.id}/insights`, { metric: METRICAS_IG_MIDIA.join(',') }, c.token, PERMISSOES_IG.insights));
      } catch (err) {
        if (err instanceof ErroRede && ['permissao', 'token', 'config', 'limite'].includes(err.info.tipo)) bloqueio ??= secaoDeErro(err);
        else semInsight++;
        return null;
      }
    });
    p.posts = midias.map((m, i) => postDeIg(m, insights[i]));
    p.metricasPostStatus = bloqueio ?? (semInsight ? { status: 'ok', mensagem: `${semInsight} post(s) sem insights (ex.: publicados antes da conta virar profissional).` } : OK);
    p.ranking = rankear(p.posts);

    // DOC_REDES.igInsightsConta: alcance diário (time_series) + totais do período (total_value).
    const since = Math.floor(desde.getTime() / 1000);
    const until = Math.floor(Date.now() / 1000);
    let alcance: PontoSerie[] = [];
    let totais: Record<string, number> = {};
    try {
      alcance = parseIgSerie(await this.http.metaGet(`${c.externalId}/insights`, { metric: 'reach', period: 'day', since, until }, c.token, PERMISSOES_IG.insights), 'reach');
      totais = parseIgInsights(
        await this.http.metaGet(`${c.externalId}/insights`, { metric: 'reach,views,accounts_engaged,total_interactions', period: 'day', metric_type: 'total_value', since, until }, c.token, PERMISSOES_IG.insights),
      );
      p.kpisStatus = OK;
    } catch (err) {
      p.kpisStatus = secaoDeErro(err);
    }

    const foto = await this.fotografar(tenantId, c, { seguidores: conta.seguidores, publicacoes: conta.publicacoes, visualizacoes: null, curtidas: null });
    const seguidores = await this.serieSeguidores(tenantId, c.id, dias);
    const posPeriodo = noPeriodo(p.posts, desde);
    p.kpis = [
      kpi('seguidores', 'Seguidores', conta.seguidores, this.variacaoSerie(seguidores)),
      kpi('alcance', `Alcance (${dias} dias)`, totais.reach ?? null),
      kpi('visualizacoes', `Visualizações (${dias} dias)`, totais.views ?? null),
      kpi('engajadas', 'Contas engajadas', totais.accounts_engaged ?? null),
      kpi('interacoes', 'Interações', totais.total_interactions ?? null),
      kpi('engajamento', 'Engajamento médio dos posts', engajamentoMedio(posPeriodo.length ? posPeriodo : p.posts), null, 'percentual'),
    ];
    p.crescimento = {
      seguidores,
      alcance,
      fonteSeguidores: 'snapshots',
      status: p.kpisStatus.status !== 'ok' ? p.kpisStatus : seguidores.length < 2 ? { status: 'sem_dados', mensagem: foto ? 'O KHUB registra os seguidores uma vez por dia; a curva aparece a partir do segundo dia.' : undefined } : OK,
    };
    return p;
  }

  /* ------------------------------ TikTok ------------------------------ */

  private async painelTiktok(tenantId: string, c: ConexaoAtiva, p: PainelRede, dias: number): Promise<PainelRede> {
    const desde = new Date(Date.now() - dias * 86_400_000);
    // DOC_REDES.tiktokUsuario: estatísticas exigem user.info.stats; sem ele, cai para o básico e avisa.
    let u = parseTiktokUsuario({});
    try {
      u = parseTiktokUsuario(await this.http.tiktokGet('user/info/', { fields: CAMPOS_TIKTOK_USUARIO }, c.token, ['user.info.basic', 'user.info.profile', 'user.info.stats']));
      p.kpisStatus = OK;
    } catch (err) {
      p.kpisStatus = secaoDeErro(err);
      if (err instanceof ErroRede && err.info.tipo === 'permissao') {
        u = parseTiktokUsuario(await this.http.tiktokGet('user/info/', { fields: 'open_id,avatar_url,display_name' }, c.token, ['user.info.basic']).catch(() => ({})));
      }
    }
    p.conta = this.resumo(c, u.usuario ? `@${u.usuario}` : u.nome, u.foto, u.seguidores, u.videos);

    // DOC_REDES.tiktokVideos: até 20 por página; duas páginas (40 vídeos mais recentes).
    const posts: PostRede[] = [];
    try {
      let cursor: number | null = null;
      for (let pagina = 0; pagina < 2; pagina++) {
        const corpo: Record<string, unknown> = { max_count: 20, ...(cursor != null ? { cursor } : {}) };
        const r = parseTiktokVideos(await this.http.tiktokPost('video/list/', { fields: CAMPOS_TIKTOK_VIDEO }, corpo, c.token, ['video.list']));
        posts.push(...r.posts);
        if (!r.temMais || r.cursor == null) break;
        cursor = r.cursor;
      }
      p.postsStatus = OK;
      p.metricasPostStatus = OK;
    } catch (err) {
      p.postsStatus = secaoDeErro(err);
      p.metricasPostStatus = p.postsStatus;
    }
    p.posts = posts;
    p.ranking = rankear(posts);

    await this.fotografar(tenantId, c, { seguidores: u.seguidores, publicacoes: u.videos, visualizacoes: null, curtidas: u.curtidas });
    const seguidores = await this.serieSeguidores(tenantId, c.id, dias);
    const doPeriodo = noPeriodo(posts, desde);
    p.kpis = [
      kpi('seguidores', 'Seguidores', u.seguidores, this.variacaoSerie(seguidores)),
      kpi('curtidas_total', 'Curtidas no perfil', u.curtidas),
      kpi('videos', 'Vídeos', u.videos),
      kpi('visualizacoes', `Visualizações dos vídeos de ${dias} dias`, somar(doPeriodo, 'visualizacoes')),
      kpi('compartilhamentos', `Compartilhamentos (${dias} dias)`, somar(doPeriodo, 'compartilhamentos')),
      kpi('engajamento', 'Engajamento médio dos vídeos', engajamentoMedio(doPeriodo.length ? doPeriodo : posts), null, 'percentual'),
    ];
    p.crescimento = {
      seguidores,
      alcance: [],
      fonteSeguidores: 'snapshots',
      status: seguidores.length < 2 ? { status: 'sem_dados', mensagem: 'A API do TikTok não tem histórico de seguidores: o KHUB registra uma foto por dia e a curva aparece a partir do segundo dia.' } : OK,
    };
    return p;
  }

  /* ------------------------------ YouTube ------------------------------ */

  private async painelYoutube(tenantId: string, c: ConexaoAtiva, p: PainelRede, dias: number): Promise<PainelRede> {
    const escopos = [...ESCOPOS_GOOGLE_REDES];
    let canal;
    try {
      // DOC_REDES.ytCanais (id do canal conectado).
      canal = parseYtCanal(await this.http.googleGet(`${YT_DATA}channels`, { part: 'snippet,statistics,contentDetails', id: c.externalId }, c.token, escopos));
    } catch (err) {
      const s = secaoDeErro(err);
      return { ...p, kpisStatus: s, postsStatus: s, metricasPostStatus: s, crescimento: { ...p.crescimento, status: s } };
    }
    p.conta = this.resumo(c, canal.usuario, canal.foto, canal.inscritos, canal.videos);

    // DOC_REDES.ytPlaylistItems + ytVideos: 25 uploads mais recentes com estatísticas.
    try {
      if (canal.uploads) {
        const lista = parseYtPlaylist(await this.http.googleGet(`${YT_DATA}playlistItems`, { part: 'contentDetails', playlistId: canal.uploads, maxResults: 25 }, c.token, escopos));
        p.posts = lista.ids.length ? parseYtVideos(await this.http.googleGet(`${YT_DATA}videos`, { part: 'snippet,statistics,contentDetails', id: lista.ids.join(',') }, c.token, escopos)) : [];
      }
      p.postsStatus = OK;
      p.metricasPostStatus = OK;
    } catch (err) {
      p.postsStatus = secaoDeErro(err);
      p.metricasPostStatus = p.postsStatus;
    }
    p.ranking = rankear(p.posts);

    await this.fotografar(tenantId, c, { seguidores: canal.inscritos, publicacoes: canal.videos, visualizacoes: canal.visualizacoes, curtidas: null });

    // DOC_REDES.ytAnalytics: série diária do período e o período anterior (variação real).
    const hoje = new Date();
    const ini = new Date(hoje.getTime() - (dias - 1) * 86_400_000);
    const iniAnt = new Date(ini.getTime() - dias * 86_400_000);
    const fimAnt = new Date(ini.getTime() - 86_400_000);
    const metricas = 'views,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost';
    let atual: Record<string, string | number>[] = [];
    let anterior: Record<string, string | number>[] = [];
    let analytics: SecaoStatus = OK;
    if (!c.scopes.includes(ESCOPO_YT_ANALYTICS)) {
      analytics = { status: 'sem_permissao', mensagem: 'Esta conexão do YouTube não tem o acesso ao YouTube Analytics. Reconecte o YouTube por aqui para liberar o crescimento e os totais do período.', faltando: [ESCOPO_YT_ANALYTICS], doc: DOC_REDES.ytAnalytics };
    } else {
      try {
        atual = parseYtRelatorio(await this.http.googleGet(YT_ANALYTICS, { ids: 'channel==MINE', startDate: diaUtc(ini), endDate: diaUtc(hoje), metrics: metricas, dimensions: 'day', sort: 'day' }, c.token, [ESCOPO_YT_ANALYTICS]));
        anterior = parseYtRelatorio(await this.http.googleGet(YT_ANALYTICS, { ids: 'channel==MINE', startDate: diaUtc(iniAnt), endDate: diaUtc(fimAnt), metrics: metricas }, c.token, [ESCOPO_YT_ANALYTICS]));
      } catch (err) {
        analytics = secaoDeErro(err);
      }
    }
    const soma = (linhas: Record<string, string | number>[], m: string): number | null => {
      const v = linhas.map((l) => l[m]).filter((x): x is number => typeof x === 'number');
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const liquido = (l: Record<string, string | number>[]) => {
      const g = soma(l, 'subscribersGained');
      const s = soma(l, 'subscribersLost');
      return g == null || s == null ? null : g - s;
    };
    const diario = atual
      .filter((l) => typeof l.day === 'string')
      .map((l) => ({ dia: String(l.day), ganho: Number(l.subscribersGained ?? 0), perda: Number(l.subscribersLost ?? 0), views: Number(l.views ?? 0) }));
    const snaps = await this.serieSeguidores(tenantId, c.id, dias);
    const daRede = serieAcumulada(diario, canal.inscritos);
    const seguidores = daRede.length ? daRede : snaps;
    p.kpisStatus = analytics;
    p.kpis = [
      kpi('seguidores', 'Inscritos', canal.inscritos, this.variacaoSerie(seguidores)),
      kpi('visualizacoes', `Visualizações (${dias} dias)`, soma(atual, 'views'), variacao(soma(atual, 'views'), soma(anterior, 'views'))),
      kpi('minutos', `Minutos assistidos (${dias} dias)`, soma(atual, 'estimatedMinutesWatched'), variacao(soma(atual, 'estimatedMinutesWatched'), soma(anterior, 'estimatedMinutesWatched')), 'minutos'),
      kpi('inscritos_liquidos', `Novos inscritos (${dias} dias)`, liquido(atual), variacao(liquido(atual), liquido(anterior))),
      kpi('visualizacoes_total', 'Visualizações do canal', canal.visualizacoes),
      kpi('engajamento', 'Engajamento médio dos vídeos', engajamentoMedio(p.posts), null, 'percentual'),
    ];
    p.crescimento = {
      seguidores,
      alcance: diario.map((d) => ({ dia: d.dia, valor: d.views })),
      fonteSeguidores: daRede.length ? 'rede' : 'snapshots',
      status: analytics.status !== 'ok' ? analytics : seguidores.length < 2 ? { status: 'sem_dados', mensagem: canal.inscritos == null ? 'O canal esconde o número de inscritos.' : undefined } : OK,
    };
    return p;
  }

  /* ------------------------------ fotos diárias ------------------------------ */

  /** Grava (ou atualiza) a foto de hoje da conta. Devolve false se falhar (não derruba o painel). */
  private async fotografar(tenantId: string, c: { id: string; rede: RedeSocial }, f: Foto): Promise<boolean> {
    const dia = new Date(`${diaUtc(new Date())}T00:00:00.000Z`);
    const big = (v: number | null) => (v == null ? null : BigInt(Math.round(v)));
    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.redesSnapshot.upsert({
          where: { conexaoId_dia: { conexaoId: c.id, dia } },
          create: { tenantId, conexaoId: c.id, rede: c.rede, dia, seguidores: big(f.seguidores), publicacoes: big(f.publicacoes), visualizacoes: big(f.visualizacoes), curtidas: big(f.curtidas) },
          update: { seguidores: big(f.seguidores), publicacoes: big(f.publicacoes), visualizacoes: big(f.visualizacoes), curtidas: big(f.curtidas), updatedAt: new Date() },
        }),
      );
      return true;
    } catch (err) {
      this.log.warn(`foto diária ${c.rede}:${c.id} falhou (tenant ${tenantId}): ${(err as Error).message}`);
      return false;
    }
  }

  /** Foto do dia pelo worker (sem ninguém abrir a tela): só o número da conta. */
  async fotografarConta(tenantId: string, conexaoId: string): Promise<void> {
    const c = await this.prisma.withTenant(tenantId, (tx) => tx.channelConnection.findUnique({ where: { id: conexaoId }, select: { rede: true } }));
    if (!c || !REDES_SOCIAIS.includes(c.rede as RedeSocial)) throw new NotFoundException('conta inexistente');
    const rede = c.rede as RedeSocial;
    const a = await this.conexoes.ativa(tenantId, rede, conexaoId);
    if (rede === 'instagram') {
      const conta = parseIgConta(await this.http.metaGet(a.externalId, { fields: CAMPOS_IG_CONTA }, a.token, PERMISSOES_IG.midias));
      await this.fotografar(tenantId, a, { seguidores: conta.seguidores, publicacoes: conta.publicacoes, visualizacoes: null, curtidas: null });
    } else if (rede === 'tiktok') {
      const u = parseTiktokUsuario(await this.http.tiktokGet('user/info/', { fields: CAMPOS_TIKTOK_USUARIO }, a.token, ['user.info.stats']));
      await this.fotografar(tenantId, a, { seguidores: u.seguidores, publicacoes: u.videos, visualizacoes: null, curtidas: u.curtidas });
    } else {
      const canal = parseYtCanal(await this.http.googleGet(`${YT_DATA}channels`, { part: 'statistics', id: a.externalId }, a.token, [...ESCOPOS_GOOGLE_REDES]));
      await this.fotografar(tenantId, a, { seguidores: canal.inscritos, publicacoes: canal.videos, visualizacoes: canal.visualizacoes, curtidas: null });
    }
  }

  private async serieSeguidores(tenantId: string, conexaoId: string, dias: number): Promise<PontoSerie[]> {
    const desde = new Date(`${diaUtc(new Date(Date.now() - dias * 86_400_000))}T00:00:00.000Z`);
    const linhas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.redesSnapshot.findMany({ where: { conexaoId, dia: { gte: desde } }, orderBy: { dia: 'asc' }, select: { dia: true, seguidores: true } }),
    );
    return serieDeSnapshots(linhas.map((l) => ({ dia: diaUtc(l.dia), seguidores: l.seguidores == null ? null : Number(l.seguidores) })));
  }

  private variacaoSerie(serie: PontoSerie[]): number | null {
    return crescimento(serie).percentual;
  }

  private resumo(c: ConexaoAtiva, usuario: string | null, foto: string | null, seguidores: number | null, publicacoes: number | null): ContaRedeResumo {
    return { conexaoId: c.id, nome: c.nome, externalId: c.externalId, usuario, foto, seguidores, publicacoes };
  }

  /* ------------------------------ publicação ------------------------------ */

  capacidadePublicacao(rede: RedeSocial, scopes: string[]): PainelRede['publicacao'] {
    const doc = this.docPublicacao(rede);
    if (rede === 'instagram') {
      return scopes.includes('instagram_content_publish')
        ? { disponivel: true, formatos: ['imagem', 'reels'], doc }
        : { disponivel: false, formatos: [], motivo: 'A conexão do Instagram não tem a permissão de publicação.', faltando: ['instagram_content_publish'], doc };
    }
    if (rede === 'tiktok') {
      return scopes.includes('video.publish')
        ? { disponivel: true, formatos: ['video'], motivo: 'Enquanto o app não passar na auditoria do TikTok, os vídeos saem como privados (Somente eu).', doc }
        : { disponivel: false, formatos: [], motivo: 'A conexão do TikTok não tem o escopo de publicação.', faltando: ['video.publish'], doc };
    }
    const pode = ['https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube'].some((s) => scopes.includes(s));
    return pode ? { disponivel: true, formatos: ['video'], doc } : { disponivel: false, formatos: [], motivo: 'A conexão do YouTube não tem escopo de envio de vídeo.', faltando: ['https://www.googleapis.com/auth/youtube.upload'], doc };
  }

  private docPublicacao(rede: RedeSocial): string {
    return rede === 'instagram' ? DOC_REDES.igPublicacao : rede === 'tiktok' ? DOC_REDES.tiktokPublicar : DOC_REDES.ytInsert;
  }

  private docs(rede: RedeSocial): string[] {
    if (rede === 'instagram') return [DOC_REDES.igMidiaLista, DOC_REDES.igInsightsMidia, DOC_REDES.igInsightsConta, DOC_REDES.igPublicacao];
    if (rede === 'tiktok') return [DOC_REDES.tiktokUsuario, DOC_REDES.tiktokVideos, DOC_REDES.tiktokPublicar];
    return [DOC_REDES.ytCanais, DOC_REDES.ytVideos, DOC_REDES.ytAnalytics, DOC_REDES.ytInsert];
  }
}
