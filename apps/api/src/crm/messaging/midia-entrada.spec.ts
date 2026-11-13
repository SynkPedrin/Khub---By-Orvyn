import { extrairMidia, tipoDeEntrada, chavesDaMidia } from './midia-entrada';

describe('midia-entrada — mídia recebida pelo WhatsApp', () => {
  it('tipos da Stevo viram tipos do KHUB', () => {
    expect(tipoDeEntrada('sticker')).toBe('figurinha');
    expect(tipoDeEntrada('imageMessage')).toBe('imagem');
    expect(tipoDeEntrada('ptt')).toBe('audio');
    expect(tipoDeEntrada('text')).toBeNull();
  });
  it('acha a URL dentro de media ou na raiz, com grafias diferentes', () => {
    expect(extrairMidia({ type: 'image', media: { url: 'https://x/y.jpg', mimetype: 'image/jpeg', caption: 'olha' } })).toMatchObject({ tipo: 'imagem', url: 'https://x/y.jpg', mime: 'image/jpeg', legenda: 'olha' });
    expect(extrairMidia({ type: 'document', media_url: 'https://x/a.pdf', file_name: 'a.pdf', mime_type: 'application/pdf' })).toMatchObject({ url: 'https://x/a.pdf', nome: 'a.pdf', mime: 'application/pdf' });
  });
  it('URL não https é descartada (sem SSRF por http interno)', () => {
    expect(extrairMidia({ type: 'sticker', media: { url: 'http://127.0.0.1/x' } })?.url).toBeNull();
  });
  it('diagnóstico mostra só os nomes das chaves, nunca valores', () => {
    const d = chavesDaMidia({ type: 'sticker', from: '5511999', media: { url: 'https://segredo', mimetype: 'image/webp' } });
    expect(d).toBe('data:[from,media,type] media:[mimetype,url]');
    expect(d).not.toContain('segredo');
  });
});
