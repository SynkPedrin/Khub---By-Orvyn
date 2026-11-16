import { BadRequestException } from '@nestjs/common';
import { validarNovaPublicacao, type NovaPublicacao } from './redes-publicacao.service';
import { RedesService } from './redes.service';

const base: NovaPublicacao = {
  rede: 'instagram',
  conexaoId: '00000000-0000-4000-8000-000000000001',
  formato: 'imagem',
  legenda: 'Novidade',
  midiaUrl: 'https://cdn.exemplo.com/foto.jpg',
  confirmado: true,
};
const agora = new Date('2026-11-13T12:00:00Z');

describe('validarNovaPublicacao', () => {
  it('exige confirmação explícita', () => {
    expect(() => validarNovaPublicacao({ ...base, confirmado: false }, agora)).toThrow(BadRequestException);
  });
  it('sem data publica agora; com data agenda', () => {
    expect(validarNovaPublicacao(base, agora)).toEqual(agora);
    expect(validarNovaPublicacao({ ...base, agendarPara: '2026-11-20T09:00:00-03:00' }, agora).toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });
  it('recusa data no passado, além de 1 ano e inválida', () => {
    expect(() => validarNovaPublicacao({ ...base, agendarPara: '2026-11-13T11:00:00Z' }, agora)).toThrow('já passou');
    expect(() => validarNovaPublicacao({ ...base, agendarPara: '2028-01-01T00:00:00Z' }, agora)).toThrow('1 ano');
    expect(() => validarNovaPublicacao({ ...base, agendarPara: 'amanhã' }, agora)).toThrow('inválida');
  });
  it('formato por rede', () => {
    expect(() => validarNovaPublicacao({ ...base, formato: 'video' }, agora)).toThrow('formato');
    expect(() => validarNovaPublicacao({ ...base, rede: 'tiktok', formato: 'imagem', privacidade: 'SELF_ONLY' }, agora)).toThrow('formato');
  });
  it('só URL https', () => {
    expect(() => validarNovaPublicacao({ ...base, midiaUrl: 'http://cdn.exemplo.com/foto.jpg' }, agora)).toThrow('https');
  });
  it('TikTok exige privacidade escolhida (sem padrão)', () => {
    const tt: NovaPublicacao = { ...base, rede: 'tiktok', formato: 'video' };
    expect(() => validarNovaPublicacao(tt, agora)).toThrow('privacidade');
    expect(validarNovaPublicacao({ ...tt, privacidade: 'SELF_ONLY' }, agora)).toEqual(agora);
  });
  it('YouTube exige título até 100 e visibilidade', () => {
    const yt: NovaPublicacao = { ...base, rede: 'youtube', formato: 'video', privacidade: 'unlisted' };
    expect(() => validarNovaPublicacao(yt, agora)).toThrow('título');
    expect(() => validarNovaPublicacao({ ...yt, titulo: 'x'.repeat(101) }, agora)).toThrow('título');
    expect(() => validarNovaPublicacao({ ...yt, titulo: 'Aula 1', privacidade: 'PUBLIC_TO_EVERYONE' }, agora)).toThrow('visibilidade');
    expect(validarNovaPublicacao({ ...yt, titulo: 'Aula 1' }, agora)).toEqual(agora);
  });
  it('legenda do Instagram até 2.200 caracteres', () => {
    expect(() => validarNovaPublicacao({ ...base, legenda: 'a'.repeat(2201) }, agora)).toThrow('2.200');
  });
});

describe('capacidadePublicacao', () => {
  const s = new RedesService({} as never, {} as never, {} as never);
  it('Instagram sem instagram_content_publish: indisponível e diz a permissão', () => {
    expect(s.capacidadePublicacao('instagram', ['instagram_basic'])).toMatchObject({ disponivel: false, faltando: ['instagram_content_publish'] });
    expect(s.capacidadePublicacao('instagram', ['instagram_content_publish']).formatos).toEqual(['imagem', 'reels']);
  });
  it('TikTok depende de video.publish e avisa da auditoria', () => {
    expect(s.capacidadePublicacao('tiktok', ['video.list'])).toMatchObject({ disponivel: false, faltando: ['video.publish'] });
    expect(s.capacidadePublicacao('tiktok', ['video.publish']).motivo).toContain('auditoria');
  });
  it('YouTube aceita force-ssl (videos.insert)', () => {
    expect(s.capacidadePublicacao('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl']).disponivel).toBe(true);
    expect(s.capacidadePublicacao('youtube', ['https://www.googleapis.com/auth/youtube.readonly']).disponivel).toBe(false);
  });
});
