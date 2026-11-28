import { describe, expect, it } from 'vitest';
import { ehCelularPor, rotaDesktopDe } from './dispositivo';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

describe('ehCelularPor', () => {
  it('PC (Mac e Windows) com mouse não é celular, mesmo com a janela estreita', () => {
    expect(ehCelularPor({ userAgent: MAC, toques: 0, ponteiroGrosso: false, larguraTela: 1440 })).toBe(false);
    expect(ehCelularPor({ userAgent: WIN, toques: 0, ponteiroGrosso: false, larguraTela: 1920 })).toBe(false);
  });
  it('notebook com tela de toque segue sendo computador', () => {
    expect(ehCelularPor({ userAgent: WIN, toques: 10, ponteiroGrosso: false, larguraTela: 1920 })).toBe(false);
  });
  it('Android e iPhone são celular', () => {
    expect(ehCelularPor({ userAgent: ANDROID, toques: 5, ponteiroGrosso: true, larguraTela: 412 })).toBe(true);
    expect(ehCelularPor({ userAgent: IPHONE, toques: 5, ponteiroGrosso: true, larguraTela: 393 })).toBe(true);
  });
  it('iPad (se apresenta como Mac) é reconhecido pelo toque', () => {
    expect(ehCelularPor({ userAgent: MAC, toques: 5, ponteiroGrosso: true, larguraTela: 1024 })).toBe(true);
  });
});

describe('rotaDesktopDe', () => {
  it('leva cada aba do app para a tela equivalente do KHUB', () => {
    expect(rotaDesktopDe('/m/aprovacoes/abc')).toBe('/aprovacoes');
    expect(rotaDesktopDe('/m/agenda')).toBe('/agenda');
    expect(rotaDesktopDe('/m/perfil')).toBe('/configuracoes');
    expect(rotaDesktopDe('/m')).toBeNull();
  });
});
