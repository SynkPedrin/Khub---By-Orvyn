import { ErroRede, mapearErroMeta, mapearErroTiktok } from './redes.erros';
import { RedesService } from './redes.service';

/** Prisma falso: withTenant executa com um tx mínimo (fotos diárias em memória). */
function prismaFalso() {
  const fotos: { conexaoId: string; dia: Date; seguidores: bigint | null }[] = [];
  const tx = {
    redesSnapshot: {
      upsert: jest.fn(async (a: { where: { conexaoId_dia: { conexaoId: string; dia: Date } }; create: { seguidores: bigint | null } }) => {
        fotos.push({ conexaoId: a.where.conexaoId_dia.conexaoId, dia: a.where.conexaoId_dia.dia, seguidores: a.create.seguidores });
      }),
      findMany: jest.fn(async () => fotos.map((f) => ({ dia: f.dia, seguidores: f.seguidores }))),
    },
  };
  return { withTenant: jest.fn(async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx)), fotos };
}

const conexoesFalsas = (rede: string, scopes: string[], missing: string[] = []) => ({
  contas: jest.fn(async () => [{ id: 'c1', nome: '@loja', externalId: 'EXT', status: 'conectado', erro: null, scopes }]),
  faltando: jest.fn(() => missing),
  ativa: jest.fn(async () => ({ id: 'c1', rede, externalId: 'EXT', pageId: 'PG', nome: '@loja', scopes, token: 'tok' })),
});

const TENANT = '00000000-0000-4000-8000-0000000000aa';

describe('RedesService.painel', () => {
  it('sem conta conectada: só o estado, com o gate da credencial e nenhum número', async () => {
    const conexoes = { contas: jest.fn(async () => []), faltando: jest.fn(() => ['META_APP_ID']), ativa: jest.fn() };
    const s = new RedesService(prismaFalso() as never, {} as never, conexoes as never);
    const p = await s.painel(TENANT, 'instagram', undefined, 28);
    expect(p.conectado).toBe(false);
    expect(p.gate).toEqual({ provider: 'meta', missing: ['META_APP_ID'] });
    expect(p.kpis).toEqual([]);
    expect(p.posts).toEqual([]);
    expect(conexoes.ativa).not.toHaveBeenCalled();
  });

  it('Instagram sem instagram_manage_insights: posts aparecem, métricas por post dizem a permissão que falta', async () => {
    const semInsights = new ErroRede('instagram', mapearErroMeta(403, { error: { message: '(#10) Application does not have permission for this action', code: 10 } }, ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement']));
    const http = {
      metaGet: jest.fn(async (caminho: string) => {
        if (caminho === 'EXT') return { id: 'EXT', username: 'loja', followers_count: 500, media_count: 2 };
        if (caminho === 'EXT/media') return { data: [{ id: 'm1', media_type: 'IMAGE', media_product_type: 'FEED', like_count: 20, comments_count: 2, timestamp: new Date().toISOString() }] };
        throw semInsights;
      }),
    };
    const prisma = prismaFalso();
    const s = new RedesService(prisma as never, http as never, conexoesFalsas('instagram', ['instagram_basic']) as never);
    const p = await s.painel(TENANT, 'instagram', undefined, 28);
    expect(p.conectado).toBe(true);
    expect(p.postsStatus.status).toBe('ok');
    expect(p.posts[0].metricas).toMatchObject({ curtidas: 20, comentarios: 2, alcance: null, engajamento: null });
    expect(p.metricasPostStatus).toMatchObject({ status: 'sem_permissao' });
    expect(p.metricasPostStatus.faltando).toContain('instagram_manage_insights');
    expect(p.kpisStatus.status).toBe('sem_permissao');
    expect(p.kpis.find((k) => k.chave === 'seguidores')?.valor).toBe(500);
    expect(p.kpis.find((k) => k.chave === 'alcance')?.valor).toBeNull();
    expect(p.publicacao).toMatchObject({ disponivel: false, faltando: ['instagram_content_publish'] });
    expect(prisma.fotos).toHaveLength(1);
  });

  it('TikTok sem user.info.stats: cai para o básico, KPIs sem número e com o escopo que falta', async () => {
    const semStats = new ErroRede('tiktok', mapearErroTiktok(401, { error: { code: 'scope_not_authorized' } }, ['user.info.basic', 'user.info.profile', 'user.info.stats']));
    const http = {
      tiktokGet: jest.fn(async (_c: string, p: { fields: string }) => {
        if (p.fields.includes('follower_count')) throw semStats;
        return { data: { user: { open_id: 'o', display_name: 'Loja' } }, error: { code: 'ok' } };
      }),
      tiktokPost: jest.fn(async () => ({ data: { videos: [{ id: 'v', create_time: Math.floor(Date.now() / 1000), view_count: 100, like_count: 10, comment_count: 0, share_count: 0 }], has_more: false }, error: { code: 'ok' } })),
    };
    const s = new RedesService(prismaFalso() as never, http as never, conexoesFalsas('tiktok', ['user.info.basic', 'video.list']) as never);
    const p = await s.painel(TENANT, 'tiktok', undefined, 28);
    expect(p.kpisStatus).toMatchObject({ status: 'sem_permissao' });
    expect(p.kpisStatus.faltando).toContain('user.info.stats');
    expect(p.conta?.usuario).toBe('Loja');
    expect(p.kpis.find((k) => k.chave === 'seguidores')?.valor).toBeNull();
    expect(p.posts[0].metricas.engajamento).toBe(10);
    expect(p.crescimento.status.status).toBe('sem_dados');
  });

  it('YouTube conectado por Conversas (sem yt-analytics): painel diz qual escopo falta e não chama o Analytics', async () => {
    const http = {
      googleGet: jest.fn(async (url: string) => {
        if (url.endsWith('channels')) return { items: [{ id: 'EXT', snippet: { title: 'Canal' }, statistics: { subscriberCount: '10', viewCount: '100', videoCount: '1' }, contentDetails: { relatedPlaylists: { uploads: 'UU' } } }] };
        if (url.endsWith('playlistItems')) return { items: [{ contentDetails: { videoId: 'v1' } }] };
        if (url.endsWith('videos')) return { items: [{ id: 'v1', snippet: { title: 'A' }, statistics: { viewCount: '50', likeCount: '5', commentCount: '0' } }] };
        throw new Error(`chamada inesperada ${url}`);
      }),
    };
    const s = new RedesService(prismaFalso() as never, http as never, conexoesFalsas('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl']) as never);
    const p = await s.painel(TENANT, 'youtube', undefined, 28);
    expect(p.kpisStatus).toMatchObject({ status: 'sem_permissao', faltando: ['https://www.googleapis.com/auth/yt-analytics.readonly'] });
    expect(http.googleGet.mock.calls.some(([u]) => String(u).includes('youtubeanalytics'))).toBe(false);
    expect(p.posts[0].metricas).toMatchObject({ visualizacoes: 50, engajamento: 10 });
    expect(p.publicacao.disponivel).toBe(true);
  });
});
