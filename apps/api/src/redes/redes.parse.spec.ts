import {
  num,
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
} from './redes.parse';

// Formatos das respostas conforme os exemplos da documentação oficial (DOC_REDES).

describe('Instagram', () => {
  it('conta: campos da IG User', () => {
    expect(parseIgConta({ id: '1784', username: 'clinica', name: 'Clínica', profile_picture_url: 'https://x/p.jpg', followers_count: 1520, follows_count: 80, media_count: 210 })).toEqual({
      id: '1784', usuario: 'clinica', nome: 'Clínica', foto: 'https://x/p.jpg', seguidores: 1520, seguindo: 80, publicacoes: 210,
    });
  });

  it('mídias: curtida escondida vira null, vídeo usa thumbnail_url, imagem usa media_url, cursor só com próxima página', () => {
    const r = parseIgMidias({
      data: [
        { id: 'm1', media_type: 'IMAGE', media_product_type: 'FEED', media_url: 'https://x/1.jpg', permalink: 'https://instagram.com/p/1', timestamp: '2026-11-10T12:00:00+0000', caption: 'oi', comments_count: 3 },
        { id: 'm2', media_type: 'VIDEO', media_product_type: 'REELS', media_url: 'https://x/2.mp4', thumbnail_url: 'https://x/2.jpg', like_count: 40, comments_count: 2 },
        { media_type: 'IMAGE' },
      ],
      paging: { cursors: { before: 'B', after: 'A' }, next: 'https://graph.facebook.com/...' },
    });
    expect(r.itens).toHaveLength(2);
    expect(r.itens[0]).toMatchObject({ id: 'm1', curtidas: null, comentarios: 3, miniatura: 'https://x/1.jpg', legenda: 'oi' });
    expect(r.itens[1]).toMatchObject({ id: 'm2', produto: 'REELS', curtidas: 40, miniatura: 'https://x/2.jpg' });
    expect(r.depois).toBe('A');
    expect(parseIgMidias({ data: [], paging: { cursors: { after: 'A' } } }).depois).toBeNull();
  });

  it('insights: aceita values[] e total_value', () => {
    const ins = parseIgInsights({
      data: [
        { name: 'reach', period: 'lifetime', values: [{ value: 900 }] },
        { name: 'views', total_value: { value: 1500 } },
        { name: 'saved', values: [{ value: 12 }] },
        { name: 'shares', values: [] },
      ],
    });
    expect(ins).toEqual({ reach: 900, views: 1500, saved: 12 });
  });

  it('série diária de alcance', () => {
    const s = parseIgSerie({ data: [{ name: 'reach', period: 'day', values: [{ value: 20, end_time: '2026-11-02T08:00:00+0000' }, { value: 10, end_time: '2026-11-01T08:00:00+0000' }] }] }, 'reach');
    expect(s).toEqual([{ dia: '2026-11-01', valor: 10 }, { dia: '2026-11-02', valor: 20 }]);
    expect(parseIgSerie({ data: [] }, 'reach')).toEqual([]);
  });

  it('post: insights têm prioridade; sem insights usa like_count/comments_count e calcula engajamento só com base real', () => {
    const m = parseIgMidias({ data: [{ id: 'm', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', like_count: 10, comments_count: 1 }] }).itens[0];
    const sem = postDeIg(m, null);
    expect(sem.tipo).toBe('carrossel');
    expect(sem.metricas).toMatchObject({ curtidas: 10, comentarios: 1, alcance: null, engajamento: null });
    const com = postDeIg(m, { reach: 200, views: 400, likes: 12, comments: 2, shares: 4, saved: 2 });
    expect(com.metricas).toMatchObject({ curtidas: 12, alcance: 200, visualizacoes: 400, engajamento: 10 });
  });
});

describe('TikTok', () => {
  it('user/info: data.user', () => {
    expect(parseTiktokUsuario({ data: { user: { open_id: 'o1', display_name: 'Loja', username: 'loja', avatar_url: 'https://t/a.jpg', follower_count: 300, following_count: 3, likes_count: 9000, video_count: 41 } }, error: { code: 'ok', message: '', log_id: 'x' } })).toEqual({
      openId: 'o1', nome: 'Loja', usuario: 'loja', foto: 'https://t/a.jpg', seguidores: 300, seguindo: 3, curtidas: 9000, videos: 41,
    });
  });
  it('sem user.info.stats os números ficam null', () => {
    expect(parseTiktokUsuario({ data: { user: { open_id: 'o1', display_name: 'Loja' } } }).seguidores).toBeNull();
  });
  it('video/list: create_time em segundos, engajamento sobre views, cursor e has_more', () => {
    const r = parseTiktokVideos({
      data: {
        videos: [{ id: 'v1', create_time: 1762000000, cover_image_url: 'https://t/c.jpg', share_url: 'https://tiktok.com/v1', video_description: 'desc', duration: 15, like_count: 90, comment_count: 5, share_count: 5, view_count: 2000 }],
        cursor: 1761999999000,
        has_more: true,
      },
      error: { code: 'ok' },
    });
    expect(r.posts[0]).toMatchObject({ id: 'v1', legenda: 'desc', duracaoSeg: 15, publicadoEm: new Date(1762000000 * 1000).toISOString() });
    expect(r.posts[0].metricas).toMatchObject({ visualizacoes: 2000, compartilhamentos: 5, salvamentos: null, engajamento: 5 });
    expect(r).toMatchObject({ cursor: 1761999999000, temMais: true });
  });
});

describe('YouTube', () => {
  it('canal: contagens em string, inscritos escondidos viram null, playlist de uploads', () => {
    const base = { items: [{ id: 'UC1', snippet: { title: 'Canal', customUrl: '@canal', thumbnails: { default: { url: 'https://y/d.jpg' }, medium: { url: 'https://y/m.jpg' } } }, statistics: { viewCount: '12345', subscriberCount: '1200', hiddenSubscriberCount: false, videoCount: '33' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] };
    expect(parseYtCanal(base)).toEqual({ id: 'UC1', titulo: 'Canal', usuario: '@canal', foto: 'https://y/m.jpg', inscritos: 1200, visualizacoes: 12345, videos: 33, uploads: 'UU1' });
    const escondido = JSON.parse(JSON.stringify(base));
    escondido.items[0].statistics.hiddenSubscriberCount = true;
    expect(parseYtCanal(escondido).inscritos).toBeNull();
  });
  it('playlistItems: videoId de contentDetails ou snippet.resourceId', () => {
    expect(parseYtPlaylist({ items: [{ contentDetails: { videoId: 'a' } }, { snippet: { resourceId: { videoId: 'b' } } }, {}], nextPageToken: 'N' })).toEqual({ ids: ['a', 'b'], proximo: 'N' });
  });
  it('videos: estatísticas, duração ISO e link', () => {
    const [v] = parseYtVideos({ items: [{ id: 'vid', snippet: { title: 'Aula', publishedAt: '2026-11-01T00:00:00Z', thumbnails: { high: { url: 'https://y/h.jpg' } } }, statistics: { viewCount: '1000', likeCount: '40', commentCount: '10' }, contentDetails: { duration: 'PT10M' } }] });
    expect(v).toMatchObject({ id: 'vid', legenda: 'Aula', duracaoSeg: 600, link: 'https://www.youtube.com/watch?v=vid', miniatura: 'https://y/h.jpg' });
    expect(v.metricas).toMatchObject({ visualizacoes: 1000, curtidas: 40, comentarios: 10, compartilhamentos: null, engajamento: 5 });
  });
  it('relatório do Analytics: columnHeaders + rows', () => {
    const r = parseYtRelatorio({ columnHeaders: [{ name: 'day', columnType: 'DIMENSION' }, { name: 'views', columnType: 'METRIC' }, { name: 'subscribersGained', columnType: 'METRIC' }], rows: [['2026-11-01', 120, 3]] });
    expect(r).toEqual([{ day: '2026-11-01', views: 120, subscribersGained: 3 }]);
    expect(parseYtRelatorio({ columnHeaders: [{ name: 'views' }] })).toEqual([]);
  });
});

describe('num', () => {
  it('aceita número e string numérica, recusa o resto', () => {
    expect(num(5)).toBe(5);
    expect(num('42')).toBe(42);
    expect(num('4a')).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
});
