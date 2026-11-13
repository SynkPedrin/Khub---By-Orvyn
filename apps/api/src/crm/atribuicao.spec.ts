import { mesclarAtribuicao, toqueDeReferralMeta, toqueDeReferralWhatsApp, toqueDeUtm, toqueInferido, lerAtribuicao, origemAtualizada, type Atribuicao } from './atribuicao';
import { eventosDeConversa } from './messaging/canais/meta-canais.parse';
import { extrairReferralWhatsApp } from './messaging/midia-entrada';
import { mimeDaImagem } from './messaging/avatar-contato.service';

const EM = new Date('2026-11-13T12:00:00Z');

describe('Atribuição de origem do lead (db/066)', () => {
  it('DM do Instagram vinda de anúncio: Meta Ads confirmada com o ad_id', () => {
    const t = toqueDeReferralMeta('Instagram', { adId: '120210000000000001', titulo: 'Progressiva 30% off', ref: 'promo' }, EM);
    expect(t).toMatchObject({ fonte: 'meta_ads', canal: 'Instagram', confianca: 'confirmada', adId: '120210000000000001', anuncio: 'Progressiva 30% off' });
  });

  it('DM sem anúncio: direto, confiança desconhecida (nunca chuta Meta Ads)', () => {
    expect(toqueDeReferralMeta('Instagram', null, EM)).toMatchObject({ fonte: 'instagram_direto', confianca: 'desconhecida' });
    expect(toqueDeReferralWhatsApp(null, EM)).toMatchObject({ fonte: 'whatsapp_direto', confianca: 'desconhecida' });
  });

  it('clique para WhatsApp: com source_id é confirmada; só ctwa_clid é provável', () => {
    expect(toqueDeReferralWhatsApp({ adId: '120210000000000002', cliqueId: 'abc' }, EM)).toMatchObject({ fonte: 'meta_ads', confianca: 'confirmada', cliqueId: 'abc' });
    expect(toqueDeReferralWhatsApp({ cliqueId: 'abc' }, EM)).toMatchObject({ fonte: 'meta_ads', confianca: 'provavel' });
  });

  it('formulário: gclid = Google Ads confirmado; utm google sem gclid = provável; fbclid = Meta', () => {
    expect(toqueDeUtm({ gclid: 'Cj0K', utm_campaign: 'botox-sp' }, EM)).toMatchObject({ fonte: 'google_ads', confianca: 'confirmada', cliqueId: 'Cj0K', campanha: 'botox-sp' });
    expect(toqueDeUtm({ utm_source: 'google' }, EM)).toMatchObject({ fonte: 'google_ads', confianca: 'provavel' });
    expect(toqueDeUtm({ fbclid: 'IwAR' }, EM)).toMatchObject({ fonte: 'meta_ads', confianca: 'confirmada' });
    expect(toqueDeUtm({ ttclid: 'x' }, EM)).toMatchObject({ fonte: 'tiktok_ads' });
    expect(toqueDeUtm({}, EM)).toMatchObject({ fonte: 'formulario', confianca: 'desconhecida' });
  });

  it('primeiro toque é preservado; o novo vai para ultimoToque', () => {
    const a = mesclarAtribuicao(null, toqueDeReferralMeta('Instagram', { adId: '111111' }, EM));
    const b = mesclarAtribuicao(a, toqueDeUtm({ gclid: 'g' }, new Date('2026-11-20T00:00:00Z')));
    expect(b).toMatchObject({ fonte: 'meta_ads', adId: '111111', toques: 2, ultimoToque: { fonte: 'google_ads' } });
  });

  it('contato que chegou direto e depois clica num anúncio é promovido (origem desconhecida não trava)', () => {
    const a = mesclarAtribuicao(null, toqueDeReferralWhatsApp(null, EM));
    const b = mesclarAtribuicao(a, toqueDeReferralWhatsApp({ adId: '120210000000000003' }, EM));
    expect(b).toMatchObject({ fonte: 'meta_ads', confianca: 'confirmada', primeiroToqueEm: EM.toISOString() });
  });

  it('backfill: tag importada do GHL vira provável; sem sinal fica direto/desconhecida', () => {
    const base = { origem: null, adCampaignId: null, canal: 'WhatsApp', criadoEm: EM };
    expect(toqueInferido({ ...base, tags: ['Lead', 'kroma-ads'] })).toMatchObject({ fonte: 'meta_ads', confianca: 'provavel', sinal: 'tag importada' });
    expect(toqueInferido({ ...base, tags: ['googleads'] })).toMatchObject({ fonte: 'google_ads', confianca: 'provavel' });
    expect(toqueInferido({ ...base, tags: [], origem: 'Meta Lead Ads' })).toMatchObject({ fonte: 'meta_ads', confianca: 'confirmada' });
    expect(toqueInferido({ ...base, tags: [], canal: 'Instagram' })).toMatchObject({ fonte: 'instagram_direto', confianca: 'desconhecida' });
  });

  it('lerAtribuicao ignora objeto vazio (contato sem registro)', () => {
    expect(lerAtribuicao({})).toBeNull();
  });

  it('campo origem: placeholder de canal é promovido pela atribuição; origem específica é preservada', () => {
    const anuncio: Atribuicao = { fonte: 'meta_ads', canal: 'WhatsApp', confianca: 'confirmada', em: EM.toISOString(), primeiroToqueEm: EM.toISOString() };
    expect(origemAtualizada(null, anuncio)).toBe('Meta Ads');
    expect(origemAtualizada('WhatsApp', anuncio)).toBe('Meta Ads');
    expect(origemAtualizada('WhatsApp direto', anuncio)).toBe('Meta Ads');
    expect(origemAtualizada('Meta Ads', anuncio)).toBeUndefined();
    expect(origemAtualizada('Indicação', anuncio)).toBeUndefined();
    const direto: Atribuicao = { fonte: 'whatsapp_direto', canal: 'WhatsApp', confianca: 'desconhecida', em: EM.toISOString(), primeiroToqueEm: EM.toISOString() };
    expect(origemAtualizada('WhatsApp', direto)).toBeUndefined();
  });
});

describe('Parser da Meta: mídia e anúncio na DM', () => {
  const corpo = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    object: 'instagram',
    entry: [{ id: '17841400000000000', time: 1, messaging: [{ sender: { id: '999' }, recipient: { id: '17841400000000000' }, timestamp: 1763035200000, message: { mid: 'm1', ...message }, ...extra }] }],
  });

  it('DM só com imagem vira linha "📎 url" (antes era descartada)', () => {
    const [ev] = eventosDeConversa(corpo({ attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } }] }));
    expect(ev).toMatchObject({ tipo: 'dm', texto: '📎 https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1', anexos: [{ tipo: 'image' }] });
  });

  it('referral do anúncio (message.referral, doc oficial) entra no evento', () => {
    const [ev] = eventosDeConversa(corpo({ text: 'Quero saber o preço', referral: { ad_id: '120210000000000009', ref: 'x', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: 'Botox', post_id: 'p1' } } }));
    expect(ev.anuncio).toEqual({ adId: '120210000000000009', ref: 'x', titulo: 'Botox', postId: 'p1' });
  });

  it('eco da própria conta continua ignorado', () => {
    expect(eventosDeConversa(corpo({ text: 'oi', is_echo: true }))).toHaveLength(0);
  });
});

describe('WhatsApp: anúncio de origem (Click-to-WhatsApp)', () => {
  it('nomes da Cloud API em referral na raiz', () => {
    expect(extrairReferralWhatsApp({ referral: { source_id: '120210000000000005', source_type: 'ad', headline: 'Promo', ctwa_clid: 'c1' } })).toEqual({ adId: '120210000000000005', cliqueId: 'c1', titulo: 'Promo', url: undefined });
  });
  it('post orgânico (source_type post) não vira id de anúncio', () => {
    expect(extrairReferralWhatsApp({ referral: { source_id: '120210000000000005', source_type: 'post', source_url: 'https://fb.me/x' } })).toMatchObject({ adId: undefined, url: 'https://fb.me/x' });
  });
  it('sem referral: null', () => {
    expect(extrairReferralWhatsApp({ text: 'oi' })).toBeNull();
  });
});

describe('Foto de perfil: tipo pela assinatura dos bytes', () => {
  it('jpeg, png, webp e recusa o resto', () => {
    expect(mimeDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(mimeDaImagem(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(mimeDaImagem(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(mimeDaImagem(Buffer.from('<html>'))).toBeNull();
  });
});
