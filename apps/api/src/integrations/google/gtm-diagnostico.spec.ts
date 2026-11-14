import { diagnosticarGtm, ehGa4, ehPixelMeta, parseAlteracao, parseTag, valoresDe, type TagGtm } from './gtm-diagnostico';

const tag = (p: Partial<{ name: string; type: string; paused: boolean; firingTriggerId: string[]; parameter: unknown[] }>): TagGtm =>
  parseTag({ path: `accounts/1/containers/2/workspaces/3/tags/${Math.random()}`, tagId: '1', firingTriggerId: ['2147479553'], ...p });

const ga4 = tag({ name: 'GA4', type: 'googtag', parameter: [{ type: 'template', key: 'tagId', value: 'G-ABC123' }] });
const pixel = tag({ name: 'Pixel', type: 'html', parameter: [{ type: 'template', key: 'html', value: "<script>!function(f,b,e,v,n,t,s){};fbq('init','123');</script>" }] });
const conversao = tag({ name: 'Conv Ads', type: 'awct' });
const linker = tag({ name: 'Linker', type: 'gclidw' });

describe('parse de tags do Tag Manager', () => {
  it('lê campos da referência v2 e tolera ausências', () => {
    const t = parseTag({ path: 'p', tagId: '9', name: 'X', type: 'html', paused: true, parameter: [{ type: 'list', key: 'k', list: [{ type: 'template', value: 'a' }] }] });
    expect(t).toMatchObject({ tagId: '9', nome: 'X', tipo: 'html', pausada: true, acionadores: [] });
    expect(valoresDe(t.parametros)).toEqual(['a']);
    expect(parseTag(null)).toMatchObject({ nome: '(sem nome)', tipo: '', acionadores: [] });
  });

  it('Google tag com ID "AW-" não conta como GA4; com "G-" ou variável conta', () => {
    expect(ehGa4(ga4)).toBe(true);
    expect(ehGa4(tag({ type: 'googtag', parameter: [{ key: 'tagId', type: 'template', value: 'AW-999' }] }))).toBe(false);
    expect(ehGa4(tag({ type: 'googtag', parameter: [{ key: 'tagId', type: 'template', value: '{{GA4 ID}}' }] }))).toBe(true);
    expect(ehGa4(tag({ type: 'gaawc' }))).toBe(true);
  });

  it('pixel da Meta por código (html) ou modelo da comunidade pelo nome', () => {
    expect(ehPixelMeta(pixel)).toBe(true);
    expect(ehPixelMeta(tag({ type: 'cvt_12345', name: 'Meta Pixel' }))).toBe(true);
    expect(ehPixelMeta(tag({ type: 'cvt_12345', name: 'Hotjar' }))).toBe(false);
    expect(ehPixelMeta(tag({ type: 'html', parameter: [{ key: 'html', type: 'template', value: '<script>hj()</script>' }] }))).toBe(false);
  });

  it('alteração do espaço de trabalho identifica a entidade', () => {
    expect(parseAlteracao({ changeStatus: 'added', tag: { name: 'Nova' } })).toEqual({ status: 'added', entidade: 'tag', nome: 'Nova' });
    expect(parseAlteracao({ changeStatus: 'updated', trigger: { name: 'Clique' } })).toMatchObject({ entidade: 'trigger' });
  });
});

describe('diagnóstico do contêiner', () => {
  it('contêiner completo e publicado não tem problemas', () => {
    const d = diagnosticarGtm({ tags: [ga4, pixel, conversao, linker], alteracoes: [], publicado: true });
    expect(d.problemas).toEqual([]);
    expect(d.resumo).toMatchObject({ ga4: true, pixelMeta: true, conversao: true, totalTags: 4 });
  });

  it('aponta falta de GA4, pixel, conversão e contêiner nunca publicado', () => {
    const d = diagnosticarGtm({ tags: [], alteracoes: [], publicado: false });
    expect(d.problemas.map((p) => p.codigo)).toEqual(['nunca_publicado', 'sem_ga4', 'sem_pixel_meta', 'sem_conversao']);
  });

  it('tag pausada não conta; alterações pendentes, tag sem acionador e conversão sem vinculador aparecem', () => {
    const ga4Pausada = tag({ type: 'googtag', paused: true, parameter: [{ key: 'tagId', type: 'template', value: 'G-1' }] });
    const semAcionador = tag({ name: 'Solta', type: 'html', firingTriggerId: [] });
    const d = diagnosticarGtm({
      tags: [ga4Pausada, pixel, conversao, semAcionador],
      alteracoes: [parseAlteracao({ changeStatus: 'added', tag: { name: 'x' } }), parseAlteracao({ changeStatus: 'none', tag: { name: 'y' } })],
      publicado: null,
    });
    const codigos = d.problemas.map((p) => p.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['sem_ga4', 'sem_vinculador', 'tag_sem_acionador', 'alteracoes_pendentes', 'tags_pausadas']));
    expect(codigos).not.toContain('nunca_publicado');
    expect(d.resumo.alteracoesPendentes).toBe(1);
  });
});
