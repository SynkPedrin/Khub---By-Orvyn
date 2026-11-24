import { describe, expect, it } from 'vitest';
import {
  FONTES_LINK,
  FORMULARIO_VAZIO,
  ROTULO_FONTE_LINK,
  montarDadosLink,
  periodoDias,
  rotuloFonte,
  validarFormularioLink,
} from './links-rastreados';

describe('ROTULO_FONTE_LINK', () => {
  it('cobre toda fonte aceita pelo backend', () => {
    for (const f of FONTES_LINK) expect(ROTULO_FONTE_LINK[f]).toBeTruthy();
  });
});

describe('rotuloFonte (métricas de atribuição)', () => {
  it.each([
    ['meta_ads', 'Meta Ads'],
    ['google_ads', 'Google Ads'],
    ['tiktok_ads', 'TikTok Ads'],
    ['organico', 'Orgânico'],
    ['whatsapp_direto', 'WhatsApp direto'],
    ['formulario', 'Formulário'],
    ['manual', 'Cadastro manual'],
  ])('%s → %s', (fonte, rotulo) => {
    expect(rotuloFonte(fonte)).toBe(rotulo);
  });

  it('fonte fora do mapa, nula ou vazia → "Desconhecida" (nunca chute)', () => {
    expect(rotuloFonte('radio')).toBe('Desconhecida');
    expect(rotuloFonte(null)).toBe('Desconhecida');
    expect(rotuloFonte(undefined)).toBe('Desconhecida');
    expect(rotuloFonte('')).toBe('Desconhecida');
  });
});

describe('validarFormularioLink', () => {
  const ok = { ...FORMULARIO_VAZIO, campanha: 'Black November', textoInicial: 'Olá! Vi o anúncio e quero agendar' };

  it('formulário válido não tem erros', () => {
    expect(validarFormularioLink(ok)).toEqual({});
  });

  it('campanha é obrigatória (mesmo só com espaços)', () => {
    expect(validarFormularioLink({ ...ok, campanha: '   ' }).campanha).toMatch(/obrigatória/);
  });

  it('campanha respeita o máximo de 160', () => {
    expect(validarFormularioLink({ ...ok, campanha: 'a'.repeat(161) }).campanha).toMatch(/160/);
    expect(validarFormularioLink({ ...ok, campanha: 'a'.repeat(160) })).toEqual({});
  });

  it('texto inicial exige 3 caracteres e no máximo 400', () => {
    expect(validarFormularioLink({ ...ok, textoInicial: 'oi' }).textoInicial).toMatch(/3 caracteres/);
    expect(validarFormularioLink({ ...ok, textoInicial: '  oi  ' }).textoInicial).toMatch(/3 caracteres/);
    expect(validarFormularioLink({ ...ok, textoInicial: 'a'.repeat(401) }).textoInicial).toMatch(/400/);
    expect(validarFormularioLink({ ...ok, textoInicial: 'a'.repeat(400) })).toEqual({});
  });

  it('conjunto e criativo são opcionais, mas limitados a 160', () => {
    expect(validarFormularioLink({ ...ok, conjunto: '', criativo: '' })).toEqual({});
    expect(validarFormularioLink({ ...ok, conjunto: 'a'.repeat(161) }).conjunto).toMatch(/160/);
    expect(validarFormularioLink({ ...ok, criativo: 'a'.repeat(161) }).criativo).toMatch(/160/);
  });

  it('fonte fora da lista é recusada', () => {
    expect(validarFormularioLink({ ...ok, fonte: 'radio' }).fonte).toMatch(/fonte/i);
  });
});

describe('montarDadosLink', () => {
  it('apara campos e transforma opcionais vazios em null', () => {
    const d = montarDadosLink({ campanha: '  Black   November ', fonte: 'google_ads', conjunto: '  ', criativo: ' Vídeo 1 ', textoInicial: '  Olá! ' });
    expect(d).toEqual({ campanha: 'Black November', fonte: 'google_ads', conjunto: null, criativo: 'Vídeo 1', textoInicial: 'Olá!' });
  });
});

describe('periodoDias', () => {
  it('30 dias termina hoje e começa 29 dias atrás (fuso de São Paulo)', () => {
    // 2026-11-24 02:00 UTC = 2026-11-23 23:00 em São Paulo (UTC-3).
    const { de, ate } = periodoDias(30, new Date('2026-11-24T02:00:00Z'));
    expect(ate).toBe('2026-11-23');
    expect(de).toBe('2026-10-25');
  });

  it.each([
    [7, '2026-11-17'],
    [90, '2026-08-26'],
  ] as const)('%d dias → de %s (ate 2026-11-23)', (dias, esperado) => {
    expect(periodoDias(dias, new Date('2026-11-24T02:00:00Z')).de).toBe(esperado);
  });
});
